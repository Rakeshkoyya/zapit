//! SidecarRunner (§5.2): spawn ffmpeg/ffprobe/qpdf with `CREATE_NO_WINDOW`,
//! argv arrays only (never a shell), FFmpeg progress parsing, a 50-line stderr
//! ring buffer for error reporting, kill-on-cancel, and stderr-driven retry.

use crate::error::{AppError, AppResult};
use crate::plan::RetryRule;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const STDERR_RING_LINES: usize = 50;

fn command(exe: &Path, args: &[String]) -> Command {
    let mut cmd = Command::new(exe);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// Quick capture runner for short commands (ffprobe). Returns stdout.
pub fn run_capture(exe: &Path, args: &[String]) -> AppResult<String> {
    let output = command(exe, args)
        .output()
        .map_err(|e| AppError::system(format!("could not start {}: {e}", exe.display())))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: Vec<&str> = stderr.lines().rev().take(STDERR_RING_LINES).collect();
        return Err(AppError::Engine {
            context: format!("{} failed", exe.display()),
            stderr_tail: tail.into_iter().rev().collect::<Vec<_>>().join("\n"),
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Cancellation handle shared between a running job and the IPC cancel command.
#[derive(Clone, Default)]
pub struct CancelFlag(Arc<AtomicBool>);

impl CancelFlag {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

pub struct StepOutcome {
    pub retried: bool,
}

/// Run one sidecar step to completion. `on_progress` receives 0..=100 driven by
/// FFmpeg `out_time_us` lines when `total_us` is known.
pub fn run_step(
    exe: &Path,
    args: &[String],
    total_us: Option<u64>,
    retry: &[RetryRule],
    cancel: &CancelFlag,
    mut on_progress: impl FnMut(u8),
) -> AppResult<StepOutcome> {
    let is_ffmpeg = exe
        .file_name()
        .is_some_and(|n| n.eq_ignore_ascii_case("ffmpeg.exe"));

    let effective = |extra: Option<&[String]>| -> Vec<String> {
        // Progress/quiet flags are runner concerns, not plan concerns, so plans
        // (and golden tests) stay free of boilerplate.
        let mut v: Vec<String> = Vec::new();
        if is_ffmpeg {
            v.extend(
                ["-hide_banner", "-nostats", "-progress", "pipe:1", "-y"]
                    .iter()
                    .map(|s| s.to_string()),
            );
        }
        match extra {
            None => v.extend(args.iter().cloned()),
            Some(extra_args) => {
                // Retry inserts the fix-up args just before the output path
                // (FFmpeg convention: last argument).
                let (head, tail) = args.split_at(args.len().saturating_sub(1));
                v.extend(head.iter().cloned());
                v.extend(extra_args.iter().cloned());
                v.extend(tail.iter().cloned());
            }
        }
        v
    };

    match run_once(exe, &effective(None), total_us, cancel, &mut on_progress) {
        Ok(()) => Ok(StepOutcome { retried: false }),
        Err(AppError::Engine {
            context,
            stderr_tail,
        }) => {
            if cancel.is_cancelled() {
                return Err(AppError::user("Cancelled"));
            }
            let rule = retry
                .iter()
                .find(|r| stderr_tail.contains(&r.stderr_contains));
            match rule {
                Some(rule) => {
                    log::info!(
                        "retrying after '{}' with {:?}",
                        rule.stderr_contains,
                        rule.extra_args
                    );
                    run_once(
                        exe,
                        &effective(Some(&rule.extra_args)),
                        total_us,
                        cancel,
                        &mut on_progress,
                    )
                    .map(|()| StepOutcome { retried: true })
                }
                None => Err(AppError::Engine {
                    context,
                    stderr_tail,
                }),
            }
        }
        Err(other) => Err(other),
    }
}

fn run_once(
    exe: &Path,
    args: &[String],
    total_us: Option<u64>,
    cancel: &CancelFlag,
    on_progress: &mut impl FnMut(u8),
) -> AppResult<()> {
    let mut child = command(exe, args)
        .spawn()
        .map_err(|e| AppError::system(format!("could not start {}: {e}", exe.display())))?;

    // stderr ring buffer on its own thread; stdout progress parsed here.
    let stderr_handle = child.stderr.take().map(|stderr| {
        std::thread::spawn(move || {
            let mut ring: VecDeque<String> = VecDeque::with_capacity(STDERR_RING_LINES);
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if ring.len() == STDERR_RING_LINES {
                    ring.pop_front();
                }
                ring.push_back(line);
            }
            ring.into_iter().collect::<Vec<_>>().join("\n")
        })
    });

    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if cancel.is_cancelled() {
                kill(&mut child);
                break;
            }
            if let (Some(total), Some(value)) = (total_us, line.strip_prefix("out_time_us=")) {
                if let Ok(us) = value.trim().parse::<u64>() {
                    let percent = ((us.saturating_mul(100)) / total.max(1)).min(100);
                    // Truncation is safe: the value was just clamped to <= 100.
                    #[allow(clippy::cast_possible_truncation)]
                    on_progress(percent as u8);
                }
            }
        }
    }

    if cancel.is_cancelled() {
        kill(&mut child);
        let _ = child.wait();
        if let Some(h) = stderr_handle {
            let _ = h.join();
        }
        return Err(AppError::user("Cancelled"));
    }

    let status = child
        .wait()
        .map_err(|e| AppError::system(format!("waiting for {} failed: {e}", exe.display())))?;
    let stderr_tail = stderr_handle
        .and_then(|h| h.join().ok())
        .unwrap_or_default();

    if status.success() {
        on_progress(100);
        Ok(())
    } else {
        Err(AppError::Engine {
            context: format!("{} exited with {status}", exe.display()),
            stderr_tail,
        })
    }
}

fn kill(child: &mut Child) {
    let _ = child.kill();
}
