//! Job orchestration: the pipe from an aggregated (action, files) job through
//! plan building (webview) and plan execution (runners) to outputs moved next
//! to the source + events for the progress window (§2, §5.2 temp lifecycle).
//!
//! All intermediates live in `%TEMP%\zapit\<job-id>\`; finished outputs
//! are MOVED into place so a half-written file never sits next to user data.
//! Cancel kills the running child and the whole temp dir goes away.

use crate::config::{self, OutputPolicy};
use crate::error::{AppError, AppResult, ErrorPayload};
use crate::naming;
use crate::plan::{substitute, EnginePlan, PlanStep};
use crate::sidecar::{self, CancelFlag};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const PLAN_TIMEOUT: Duration = Duration::from_secs(20);
const WEBVIEW_READY_TIMEOUT: Duration = Duration::from_secs(20);

static JOB_COUNTER: AtomicU64 = AtomicU64::new(1);

/// How the webview answers a plan://request.
pub enum PlanResponse {
    Plan(EnginePlan),
    /// The action needs user input first; the string names the window (e.g. "trim").
    NeedsOptions(String),
    /// The action rejected the input (UserError with this message).
    Failed(String),
}

/// What an options window sends back; None = the user closed it (cancel).
pub type OptionsReply = Option<BTreeMap<String, String>>;

/// How a webview JS-engine step reports back; Some(msg) = user-facing failure.
pub type JsReply = Option<String>;

/// Cross-thread app state managed by Tauri.
#[derive(Default)]
pub struct JobState {
    pub webview_ready: Arc<(Mutex<bool>, Condvar)>,
    pub pending_plans: Mutex<HashMap<String, mpsc::Sender<PlanResponse>>>,
    pub pending_options: Mutex<HashMap<String, mpsc::Sender<OptionsReply>>>,
    pub pending_js: Mutex<HashMap<String, mpsc::Sender<JsReply>>>,
    pub cancel_flags: Mutex<HashMap<String, CancelFlag>>,
    /// Separate from `cancel_flags`: a Trim window can abandon its proxy build
    /// without cancelling the job that opened it (ADR 005).
    pub preview_cancels: Mutex<HashMap<String, CancelFlag>>,
    /// Deny-by-default allow-list for `zapitmedia://`. A window may only stream
    /// files it was explicitly handed.
    pub allowed_media: Mutex<std::collections::HashSet<PathBuf>>,
    /// `install-menu` waits here for the webview to hand over the action list.
    pub pending_menu: Mutex<Option<mpsc::Sender<Vec<crate::registry_menu::MenuAction>>>>,
}

/// Block until the webview signals it is ready to answer requests.
pub fn await_webview(app: &AppHandle) -> AppResult<()> {
    let state = app.state::<JobState>();
    wait_for_webview(&state)
}

pub fn next_job_id() -> String {
    let n = JOB_COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("job-{}-{n}", std::process::id())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileInfoPayload {
    pub path: String,
    pub size_bytes: u64,
    /// Probe result for media files; None for non-media or when probing failed.
    pub media: Option<crate::probe::MediaInfo>,
}

/// Extensions worth an ffprobe pass before planning (video + audio catalog).
const PROBE_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "mov", "avi", "webm", "wmv", "flv", "ts", "m4v", "mts", "3gp", "gif", "mp3",
    "wav", "flac", "m4a", "aac", "ogg", "opus", "wma",
];

fn should_probe(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| PROBE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PlanRequest<'a> {
    job_id: &'a str,
    action_id: &'a str,
    inputs: &'a [FileInfoPayload],
    options: &'a BTreeMap<String, String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent<'a> {
    pub job_id: &'a str,
    pub percent: u8,
    pub label: &'a str,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DoneEvent<'a> {
    pub job_id: &'a str,
    pub outputs: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ErrorEvent<'a> {
    pub job_id: &'a str,
    pub error: ErrorPayload,
}

/// Where the sidecar exes live: bundled resources in production, the repo's
/// `src-tauri/sidecars/` during development.
pub fn sidecar_dir(app: &AppHandle) -> AppResult<PathBuf> {
    if let Ok(resources) = app.path().resource_dir() {
        let bundled = resources.join("sidecars");
        if bundled.join("ffmpeg.exe").exists() {
            return Ok(bundled);
        }
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("sidecars");
    if dev.join("ffmpeg.exe").exists() {
        return Ok(dev);
    }
    Err(AppError::system(
        "Sidecar binaries not found — run scripts/fetch-sidecars.ps1",
    ))
}

fn temp_root() -> PathBuf {
    std::env::temp_dir().join("zapit")
}

/// Job dirs are removed when a job ends, but a hard kill (Task Manager, power
/// loss) skips that. Sweep anything older than an hour at startup so debris
/// cannot accumulate; an hour is far longer than any job we run.
pub fn sweep_stale_temp() {
    const MAX_AGE: Duration = Duration::from_secs(60 * 60);
    let Ok(entries) = std::fs::read_dir(temp_root()) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_dir() {
            continue;
        }
        let stale = meta
            .modified()
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age > MAX_AGE);
        if stale {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

fn wait_for_webview(state: &JobState) -> AppResult<()> {
    let (lock, cvar) = &*state.webview_ready;
    let Ok(guard) = lock.lock() else {
        return Err(AppError::system("internal state poisoned"));
    };
    let Ok((guard, timeout)) =
        cvar.wait_timeout_while(guard, WEBVIEW_READY_TIMEOUT, |ready| !*ready)
    else {
        return Err(AppError::system("internal state poisoned"));
    };
    if timeout.timed_out() && !*guard {
        return Err(AppError::system("the app's engine did not start in time"));
    }
    Ok(())
}

fn request_plan(
    app: &AppHandle,
    state: &JobState,
    job_id: &str,
    action_id: &str,
    inputs: &[FileInfoPayload],
    options: &BTreeMap<String, String>,
) -> AppResult<PlanResponse> {
    let (tx, rx) = mpsc::channel();
    if let Ok(mut pending) = state.pending_plans.lock() {
        pending.insert(job_id.to_string(), tx);
    }
    app.emit(
        "plan://request",
        PlanRequest {
            job_id,
            action_id,
            inputs,
            options,
        },
    )
    .map_err(|e| AppError::system(format!("could not reach the engine: {e}")))?;
    let response = rx
        .recv_timeout(PLAN_TIMEOUT)
        .map_err(|_| AppError::system("the engine did not produce a plan in time"));
    if let Ok(mut pending) = state.pending_plans.lock() {
        pending.remove(job_id);
    }
    response
}

/// Open an options window (e.g. Trim) and block until it submits or closes.
/// The window label encodes the job id so close events can cancel cleanly.
fn gather_options(
    app: &AppHandle,
    state: &JobState,
    job_id: &str,
    window: &str,
    inputs: &[FileInfoPayload],
) -> AppResult<BTreeMap<String, String>> {
    let (tx, rx) = mpsc::channel();
    if let Ok(mut pending) = state.pending_options.lock() {
        pending.insert(job_id.to_string(), tx);
    }

    let media = inputs.first().and_then(|i| i.media.as_ref());
    let duration = media.and_then(|m| m.duration_s).unwrap_or(0.0);
    // The Trim window branches on these: filmstrip needs video, waveform needs
    // audio, and an audio-only proxy skips the encoder entirely (ADR 005).
    let has_video = media.is_some_and(crate::probe::MediaInfo::has_video);
    let has_audio = media.is_some_and(crate::probe::MediaInfo::has_audio);
    let file = inputs.first().map(|i| i.path.as_str()).unwrap_or("");
    let file_name = file.rsplit(['\\', '/']).next().unwrap_or(file);
    // Reorder-style windows need every file name, not just the first.
    let all_names: Vec<&str> = inputs
        .iter()
        .map(|i| i.path.rsplit(['\\', '/']).next().unwrap_or(&i.path))
        .collect();
    let files_json = serde_json::to_string(&all_names).unwrap_or_else(|_| "[]".into());
    let label = format!("options-{job_id}");
    // `path` lets a window fetch its own data (I6 reads EXIF directly).
    let url = format!(
        "{window}.html?job={job_id}&duration={duration}&hasVideo={}&hasAudio={}&name={}&files={}&path={}",
        u8::from(has_video),
        u8::from(has_audio),
        urlencoded(file_name),
        urlencoded(&files_json),
        urlencoded(file)
    );
    let size = window_size(window);
    let app_on_main = app.clone();
    let label_on_main = label.clone();
    let _ = app.run_on_main_thread(move || {
        let mut builder = tauri::WebviewWindowBuilder::new(
            &app_on_main,
            &label_on_main,
            tauri::WebviewUrl::App(url.into()),
        )
        .title("Zapit")
        .inner_size(size.width, size.height)
        .resizable(size.resizable)
        .maximizable(size.resizable);
        if size.resizable {
            builder = builder.min_inner_size(720.0, 520.0);
        }
        let _ = builder.build();
    });

    // No timeout: the user may be thinking. Closing the window sends None.
    let received = rx
        .recv()
        .map_err(|_| AppError::user("Cancelled"))
        .and_then(|opt| opt.ok_or_else(|| AppError::user("Cancelled")));
    if let Ok(mut pending) = state.pending_options.lock() {
        pending.remove(job_id);
    }
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.close();
    }
    received
}

struct WindowSize {
    width: f64,
    height: f64,
    resizable: bool,
}

/// Prompt windows are fixed-size dialogs. Trim is a real editor — a player, a
/// filmstrip and a segment list do not fit in a 420×240 box (ADR 005).
///
/// The rest are sized to their content: a title, the question, presets and an
/// action bar. Windows carrying an explanation or a list need more room than
/// the plain one-field prompts.
fn window_size(window: &str) -> WindowSize {
    match window {
        "trim" => WindowSize {
            width: 900.0,
            height: 660.0,
            resizable: true,
        },
        // A scrolling EXIF table.
        "metadata" => WindowSize {
            width: 520.0,
            height: 520.0,
            resizable: true,
        },
        // A scrolling file list with move buttons.
        "reorder" => WindowSize {
            width: 480.0,
            height: 440.0,
            resizable: true,
        },
        // Two fields plus a "don't lose this password" warning.
        "prompt-password-set" => WindowSize {
            width: 460.0,
            height: 340.0,
            resizable: false,
        },
        // One field plus an explanatory note.
        "prompt-video-size" | "prompt-ranges" | "prompt-password" => WindowSize {
            width: 470.0,
            height: 310.0,
            resizable: false,
        },
        _ => WindowSize {
            width: 450.0,
            height: 260.0,
            resizable: false,
        },
    }
}

/// Result windows (G1 hash) display data and stay open until dismissed; the
/// leader's idle-exit check keeps the app alive while any window lives.
fn open_result_window(app: &AppHandle, job_id: &str, params: &[(&str, &str)]) {
    let query: Vec<String> = params
        .iter()
        .map(|(k, v)| format!("{k}={}", urlencoded(v)))
        .collect();
    let url = format!("result.html?{}", query.join("&"));
    let label = format!("result-{job_id}");
    let app_on_main = app.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = tauri::WebviewWindowBuilder::new(
            &app_on_main,
            &label,
            tauri::WebviewUrl::App(url.into()),
        )
        .title("Zapit")
        .inner_size(520.0, 220.0)
        .resizable(false)
        .maximizable(false)
        .build();
    });
}

fn urlencoded(text: &str) -> String {
    let mut out = String::new();
    for byte in text.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(char::from(*byte));
            }
            other => {
                out.push('%');
                out.push_str(&format!("{other:02X}"));
            }
        }
    }
    out
}

/// Execute one job end to end. Returns final output paths.
pub fn execute(
    app: &AppHandle,
    job_id: &str,
    action_id: &str,
    files: &[PathBuf],
    options: &BTreeMap<String, String>,
    out_dir_override: Option<&Path>,
) -> AppResult<Vec<PathBuf>> {
    let state = app.state::<JobState>();
    wait_for_webview(&state)?;

    let probe_dir = sidecar_dir(app).ok();
    let mut inputs = Vec::new();
    for file in files {
        let meta = std::fs::metadata(file)
            .map_err(|_| AppError::user(format!("File not found: {}", file.display())))?;
        let media = match (&probe_dir, should_probe(file)) {
            (Some(dir), true) => crate::probe::probe(dir, file).ok(),
            _ => None,
        };
        inputs.push(FileInfoPayload {
            path: file.to_string_lossy().into_owned(),
            size_bytes: meta.len(),
            media,
        });
    }

    let tmp = temp_root().join(job_id);
    std::fs::create_dir_all(&tmp)?;
    let cancel = CancelFlag::default();
    if let Ok(mut flags) = state.cancel_flags.lock() {
        flags.insert(job_id.to_string(), cancel.clone());
    }

    // `smoke` supplies an output dir and has no interactive user, so an action
    // that wants a window must fail fast rather than block a script forever.
    let headless = out_dir_override.is_some();
    let result = run_plan(
        app,
        &state,
        job_id,
        action_id,
        files,
        &inputs,
        options,
        &tmp,
        &cancel,
        out_dir_override,
        headless,
    );

    // Temp lifecycle: success or failure, the job dir never outlives the job.
    let _ = std::fs::remove_dir_all(&tmp);
    if let Ok(mut flags) = state.cancel_flags.lock() {
        flags.remove(job_id);
    }
    result
}

#[allow(clippy::too_many_arguments)]
fn run_plan(
    app: &AppHandle,
    state: &JobState,
    job_id: &str,
    action_id: &str,
    files: &[PathBuf],
    inputs: &[FileInfoPayload],
    options: &BTreeMap<String, String>,
    tmp: &Path,
    cancel: &CancelFlag,
    out_dir_override: Option<&Path>,
    headless: bool,
) -> AppResult<Vec<PathBuf>> {
    // Plan loop: at most one options round-trip (window) then a real plan.
    let mut merged_options = options.clone();
    let mut plan: Option<EnginePlan> = None;
    for round in 0..2 {
        match request_plan(app, state, job_id, action_id, inputs, &merged_options)? {
            PlanResponse::Plan(p) => {
                plan = Some(p);
                break;
            }
            PlanResponse::Failed(message) => return Err(AppError::user(message)),
            PlanResponse::NeedsOptions(window) => {
                if round == 1 {
                    return Err(AppError::system(
                        "the action kept asking for options — planning bug",
                    ));
                }
                if headless {
                    // `smoke` has no user to answer a window; blocking here
                    // would hang a script forever.
                    return Err(AppError::user(
                        "This action needs options — pass them with --opt (e.g. --opt targetMb=25).",
                    ));
                }
                let received = gather_options(app, state, job_id, &window, inputs)?;
                merged_options.extend(received);
            }
        }
    }
    let Some(plan) = plan else {
        return Err(AppError::system("no plan produced"));
    };
    if plan.steps.is_empty() {
        return Err(AppError::system("the action produced an empty plan"));
    }
    // Resolved lazily: pure-JS/copy plans must work without sidecars installed.
    let mut sidecars: Option<PathBuf> = None;
    // Steps whose output count is only known at runtime (P4 pages) push here.
    let mut extra_outputs: Vec<(PathBuf, String, String)> = Vec::new();

    let step_count = plan.steps.len();
    for (idx, step) in plan.steps.iter().enumerate() {
        if cancel.is_cancelled() {
            return Err(AppError::user("Cancelled"));
        }
        match step {
            PlanStep::Sidecar {
                bin,
                args,
                retry,
                total_us,
            } => {
                let argv: Vec<String> = args.iter().map(|a| substitute(a, tmp, files)).collect();
                if sidecars.is_none() {
                    sidecars = Some(sidecar_dir(app)?);
                }
                let exe = match &sidecars {
                    Some(dir) => dir.join(bin.exe_name()),
                    None => return Err(AppError::system("sidecar dir unresolved")),
                };
                let app_for_progress = app.clone();
                let job_for_progress = job_id.to_string();
                sidecar::run_step(&exe, &argv, *total_us, retry, cancel, move |step_pct| {
                    // Overall percent: completed steps + progress within this one.
                    let overall = ((idx * 100) + usize::from(step_pct)) / step_count;
                    #[allow(clippy::cast_possible_truncation)]
                    let percent = overall.min(100) as u8;
                    let _ = app_for_progress.emit(
                        "job://progress",
                        ProgressEvent {
                            job_id: &job_for_progress,
                            percent,
                            label: "",
                        },
                    );
                })?;
            }
            PlanStep::Copy { from, to } => {
                let src = PathBuf::from(substitute(from, tmp, files));
                let dst = PathBuf::from(substitute(to, tmp, files));
                std::fs::copy(&src, &dst).map_err(|e| {
                    AppError::system(format!("could not copy {}: {e}", src.display()))
                })?;
            }
            PlanStep::Js { engine, params } => {
                let substituted = crate::plan::substitute_value(params, tmp, files);
                let (tx, rx) = mpsc::channel();
                if let Ok(mut pending) = state.pending_js.lock() {
                    pending.insert(job_id.to_string(), tx);
                }
                #[derive(Serialize, Clone)]
                #[serde(rename_all = "camelCase")]
                struct JsRequest<'a> {
                    job_id: &'a str,
                    engine: &'a str,
                    params: serde_json::Value,
                }
                app.emit(
                    "js://execute",
                    JsRequest {
                        job_id,
                        engine,
                        params: substituted,
                    },
                )
                .map_err(|e| AppError::system(format!("could not reach the engine: {e}")))?;
                // pdf-lib over big documents can take a while; no fixed timeout,
                // but cancellation still applies via polling.
                let outcome = loop {
                    match rx.recv_timeout(Duration::from_millis(500)) {
                        Ok(reply) => break Ok(reply),
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            if cancel.is_cancelled() {
                                break Err(AppError::user("Cancelled"));
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => {
                            break Err(AppError::system("the engine went away"));
                        }
                    }
                };
                if let Ok(mut pending) = state.pending_js.lock() {
                    pending.remove(job_id);
                }
                match outcome? {
                    None => {}
                    Some(message) => return Err(AppError::user(message)),
                }
            }
            PlanStep::WriteText { path, content } => {
                let dst = PathBuf::from(substitute(path, tmp, files));
                std::fs::write(&dst, substitute(content, tmp, files)).map_err(|e| {
                    AppError::system(format!("could not write {}: {e}", dst.display()))
                })?;
            }
            PlanStep::Checksum { input, algorithm } => {
                let algo = crate::hash::Algorithm::parse(algorithm)
                    .ok_or_else(|| AppError::user(format!("Unknown algorithm \"{algorithm}\".")))?;
                let src = PathBuf::from(substitute(input, tmp, files));
                let app_for_progress = app.clone();
                let job_for_progress = job_id.to_string();
                let digest = crate::hash::hash_file(&src, algo, cancel, move |percent| {
                    let _ = app_for_progress.emit(
                        "job://progress",
                        ProgressEvent {
                            job_id: &job_for_progress,
                            percent,
                            label: "",
                        },
                    );
                })?;
                open_result_window(
                    app,
                    job_id,
                    &[
                        ("algorithm", algo.label()),
                        ("hash", &digest),
                        (
                            "name",
                            &src.file_name().unwrap_or_default().to_string_lossy(),
                        ),
                    ],
                );
            }
            PlanStep::Loudnorm { input, out } => {
                if sidecars.is_none() {
                    sidecars = Some(sidecar_dir(app)?);
                }
                let dir = match &sidecars {
                    Some(dir) => dir.clone(),
                    None => return Err(AppError::system("sidecar dir unresolved")),
                };
                let src = PathBuf::from(substitute(input, tmp, files));
                let dst = PathBuf::from(substitute(out, tmp, files));
                crate::audio::normalize(&dir, &src, &dst, cancel)?;
            }
            PlanStep::PdfRender {
                input,
                out_pattern,
                dpi,
            } => {
                if sidecars.is_none() {
                    sidecars = Some(sidecar_dir(app)?);
                }
                let dir = match &sidecars {
                    Some(dir) => dir.clone(),
                    None => return Err(AppError::system("sidecar dir unresolved")),
                };
                let src = PathBuf::from(substitute(input, tmp, files));
                let pattern = substitute(out_pattern, tmp, files);
                let written = crate::pdf::render_to_pngs(&dir, &src, &pattern, *dpi, cancel)?;
                // Page count is only known now, so these outputs are appended
                // rather than declared in the plan.
                let base = src.file_stem().unwrap_or_default().to_string_lossy();
                for (i, path) in written.iter().enumerate() {
                    let number = if written.len() > 9 {
                        format!("{:02}", i + 1)
                    } else {
                        format!("{}", i + 1)
                    };
                    extra_outputs.push((
                        path.clone(),
                        format!("{base} (page {number})"),
                        "png".to_string(),
                    ));
                }
            }
            PlanStep::PdfText { input, out } => {
                if sidecars.is_none() {
                    sidecars = Some(sidecar_dir(app)?);
                }
                let dir = match &sidecars {
                    Some(dir) => dir.clone(),
                    None => return Err(AppError::system("sidecar dir unresolved")),
                };
                let src = PathBuf::from(substitute(input, tmp, files));
                let dst = PathBuf::from(substitute(out, tmp, files));
                crate::pdf::extract_text(&dir, &src, &dst)?;
            }
            PlanStep::PdfCompress {
                input,
                out,
                target_kb,
                quality,
            } => {
                if sidecars.is_none() {
                    sidecars = Some(sidecar_dir(app)?);
                }
                let dir = match &sidecars {
                    Some(dir) => dir.clone(),
                    None => return Err(AppError::system("sidecar dir unresolved")),
                };
                let src = PathBuf::from(substitute(input, tmp, files));
                let dst = PathBuf::from(substitute(out, tmp, files));
                let outcome = match (target_kb, quality) {
                    (Some(kb), _) => crate::pdf::compress_pdf(&dir, &src, &dst, *kb, tmp, cancel)?,
                    (None, Some(name)) => {
                        let level = crate::pdf::Quality::parse(name).ok_or_else(|| {
                            AppError::user(format!("Unknown quality \"{name}\"."))
                        })?;
                        crate::pdf::compress_pdf_quality(&dir, &src, &dst, level, tmp, cancel)?
                    }
                    (None, None) => {
                        return Err(AppError::system("pdf-compress needs a size or a quality"))
                    }
                };
                if outcome.rasterized {
                    log::info!("PDF pages were rasterized — text no longer selectable");
                }
            }
            PlanStep::SizeSearch {
                input,
                out,
                target_kb,
                format,
            } => {
                if sidecars.is_none() {
                    sidecars = Some(sidecar_dir(app)?);
                }
                let magick = match &sidecars {
                    Some(dir) => dir.join("magick.exe"),
                    None => return Err(AppError::system("sidecar dir unresolved")),
                };
                let original = substitute(input, tmp, files);
                let dst = PathBuf::from(substitute(out, tmp, files));
                let ext = if format == "webp" { "webp" } else { "jpg" };
                // Pre-cap huge sources (48 MP phone photos) once, so the search
                // doesn't re-decode the full-size original on every attempt.
                // `>` only shrinks; PNG intermediate keeps alpha for webp.
                let pre = tmp.join(if format == "webp" {
                    "search-src.png"
                } else {
                    "search-src.jpg"
                });
                let mut cap_args: Vec<String> = vec![
                    original.clone(),
                    "-auto-orient".into(),
                    "-resize".into(),
                    "4000x4000>".into(),
                ];
                if format != "webp" {
                    cap_args.push("-quality".into());
                    cap_args.push("98".into());
                }
                cap_args.push(pre.to_string_lossy().into_owned());
                crate::sidecar::run_capture(
                    &match &sidecars {
                        Some(dir) => dir.join("magick.exe"),
                        None => return Err(AppError::system("sidecar dir unresolved")),
                    },
                    &cap_args,
                )?;
                let src = pre.to_string_lossy().into_owned();
                let attempt = tmp.join(format!("attempt.{ext}"));
                let encode = |quality: u8, scale: u32| -> AppResult<u64> {
                    if cancel.is_cancelled() {
                        return Err(AppError::user("Cancelled"));
                    }
                    let mut args: Vec<String> =
                        vec![src.clone(), "-auto-orient".into(), "-strip".into()];
                    if scale != 100 {
                        args.push("-resize".into());
                        args.push(format!("{scale}%"));
                    }
                    args.push("-quality".into());
                    args.push(quality.to_string());
                    args.push(attempt.to_string_lossy().into_owned());
                    crate::sidecar::run_capture(&magick, &args)?;
                    Ok(std::fs::metadata(&attempt)?.len())
                };
                let (quality, scale) = crate::image::search_size(*target_kb, encode)?;
                // Re-encode once at the winning parameters, straight to `out`.
                let mut args: Vec<String> =
                    vec![src.clone(), "-auto-orient".into(), "-strip".into()];
                if scale != 100 {
                    args.push("-resize".into());
                    args.push(format!("{scale}%"));
                }
                args.push("-quality".into());
                args.push(quality.to_string());
                args.push(dst.to_string_lossy().into_owned());
                crate::sidecar::run_capture(&magick, &args)?;
            }
        }
    }

    if cancel.is_cancelled() {
        return Err(AppError::user("Cancelled"));
    }

    // Move outputs into place with collision-safe names (never overwrite).
    let cfg = config::load();
    let dest_dir: PathBuf = match out_dir_override {
        Some(dir) => dir.to_path_buf(),
        None => match (&cfg.output_policy, files.first().and_then(|f| f.parent())) {
            (OutputPolicy::Fixed, _) if cfg.fixed_dir.is_some() => {
                cfg.fixed_dir.clone().unwrap_or_default()
            }
            (_, Some(parent)) => parent.to_path_buf(),
            _ => temp_root(),
        },
    };
    std::fs::create_dir_all(&dest_dir)?;

    let mut finals = Vec::new();
    let declared = plan.outputs.iter().map(|o| {
        (
            PathBuf::from(substitute(&o.from, tmp, files)),
            o.base_name.clone(),
            o.ext.clone(),
        )
    });
    for (from, base_name, ext) in declared.chain(extra_outputs) {
        // A step can exit 0 yet write nothing (e.g. FFmpeg seeking past the end
        // of a clip). "File not found" would be baffling; say what happened.
        if !from.exists() {
            return Err(AppError::user(
                "That produced no output — the file may be in an unsupported format, \
                 or the settings may not suit it.",
            ));
        }
        let target = naming::resolve_output(&dest_dir, &base_name, &ext);
        if std::fs::rename(&from, &target).is_err() {
            // Cross-volume rename fails; copy+delete is the fallback.
            std::fs::copy(&from, &target).map_err(|e| {
                AppError::system(format!("could not place output {}: {e}", target.display()))
            })?;
            let _ = std::fs::remove_file(&from);
        }
        finals.push(target);
    }
    Ok(finals)
}
