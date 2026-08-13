//! Preview assets for the Trim timeline window (ADR 005).
//!
//! Three cheap FFmpeg passes, none of which touch the user's files:
//!   * **filmstrip** — a fixed 40-tile strip, so cost does not grow with duration
//!   * **waveform**  — one `showwavespic` PNG, for audio files and video sound
//!   * **proxy**     — a 360p/24fps MP4 for containers WebView2 cannot decode
//!
//! Everything lands inside the job's own temp dir, which `jobs::execute` removes
//! when the job ends and `jobs::sweep_stale_temp` collects after a hard kill.

use crate::error::{AppError, AppResult};
use crate::sidecar::{run_step, CancelFlag};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Enough tiles to scrub by, few enough that a 3-hour film costs the same as a
/// 30-second clip.
const FILMSTRIP_TILES: u32 = 40;
const FILMSTRIP_HEIGHT: u32 = 64;
const WAVEFORM_SIZE: &str = "1600x64";
const WAVEFORM_COLOR: &str = "#5b9dff";
/// Above this the proxy downscales; below it, upscaling would only waste time.
const PROXY_HEIGHT: u32 = 360;
const PROXY_FPS: &str = "24";

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PreviewAssets {
    /// Absolute path to the filmstrip PNG; None when the source has no video.
    pub filmstrip: Option<String>,
    /// Absolute path to the waveform PNG; None when the source has no audio.
    pub waveform: Option<String>,
}

/// Scratch space for one window, inside the job dir so it is cleaned with it.
pub fn preview_dir(job_id: &str) -> PathBuf {
    std::env::temp_dir()
        .join("zapit")
        .join(job_id)
        .join("preview")
}

fn ffmpeg(sidecars: &Path) -> PathBuf {
    sidecars.join("ffmpeg.exe")
}

fn text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// 40 frames spread evenly across the source, tiled into a single row — the
/// same `fps=N/duration,tile=` trick V9's contact sheet uses.
pub fn filmstrip(sidecars: &Path, src: &Path, out: &Path, duration_s: f64) -> AppResult<()> {
    if !duration_s.is_finite() || duration_s <= 0.0 {
        return Err(AppError::system(
            "cannot build a filmstrip without a duration",
        ));
    }
    let rate = f64::from(FILMSTRIP_TILES) / duration_s;
    let args = vec![
        "-i".to_string(),
        text(src),
        "-vf".to_string(),
        format!("fps={rate:.6},scale=-2:{FILMSTRIP_HEIGHT},tile={FILMSTRIP_TILES}x1"),
        "-frames:v".to_string(),
        "1".to_string(),
        text(out),
    ];
    run_step(
        &ffmpeg(sidecars),
        &args,
        None,
        &[],
        &CancelFlag::default(),
        |_| {},
    )
    .map(|_| ())
}

/// Mono peak envelope across the whole file, drawn once at a fixed width.
pub fn waveform(sidecars: &Path, src: &Path, out: &Path) -> AppResult<()> {
    let args = vec![
        "-i".to_string(),
        text(src),
        "-filter_complex".to_string(),
        format!(
            "aformat=channel_layouts=mono,showwavespic=s={WAVEFORM_SIZE}:colors={WAVEFORM_COLOR}"
        ),
        "-frames:v".to_string(),
        "1".to_string(),
        text(out),
    ];
    run_step(
        &ffmpeg(sidecars),
        &args,
        None,
        &[],
        &CancelFlag::default(),
        |_| {},
    )
    .map(|_| ())
}

/// A small, universally playable stand-in for containers the webview refuses.
/// Deliberately cheap: the user is scrubbing it, not watching it.
pub struct ProxySpec<'a> {
    pub src: &'a Path,
    pub out: &'a Path,
    pub has_video: bool,
    /// None when unknown; the proxy then assumes the source is large.
    pub source_height: Option<u32>,
    /// Total duration for the progress bar; None disables the percentage.
    pub total_us: Option<u64>,
}

pub fn proxy(
    sidecars: &Path,
    spec: &ProxySpec<'_>,
    cancel: &CancelFlag,
    on_progress: impl FnMut(u8),
) -> AppResult<()> {
    let mut args = vec!["-i".to_string(), text(spec.src)];
    if spec.has_video {
        // Only ever shrink; upscaling a 240p clip to 360p costs time and buys
        // nothing. An unknown height is assumed large.
        let shrink = match spec.source_height {
            Some(height) => height > PROXY_HEIGHT,
            None => true,
        };
        if shrink {
            args.push("-vf".to_string());
            args.push(format!("scale=-2:{PROXY_HEIGHT}"));
        }
        args.extend([
            "-r".to_string(),
            PROXY_FPS.to_string(),
            "-c:v".to_string(),
            "libopenh264".to_string(),
            "-b:v".to_string(),
            "700k".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
        ]);
    } else {
        args.push("-vn".to_string());
    }
    args.extend([
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        "96k".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        text(spec.out),
    ]);
    run_step(
        &ffmpeg(sidecars),
        &args,
        spec.total_us,
        &[],
        cancel,
        on_progress,
    )
    .map(|_| ())
}

/// `.m4a` for audio-only sources so the asset protocol serves `audio/mp4`.
pub fn proxy_name(has_video: bool) -> &'static str {
    if has_video {
        "proxy.mp4"
    } else {
        "proxy.m4a"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_dir_sits_inside_the_job_dir() {
        let dir = preview_dir("job-1-2");
        assert!(dir.ends_with("preview"));
        assert!(dir.parent().is_some_and(|p| p.ends_with("job-1-2")));
    }

    #[test]
    fn proxy_name_matches_the_stream_kind() {
        assert_eq!(proxy_name(true), "proxy.mp4");
        assert_eq!(proxy_name(false), "proxy.m4a");
    }

    #[test]
    fn filmstrip_without_a_duration_is_an_error() {
        let err = filmstrip(
            Path::new("nowhere"),
            Path::new("a.mp4"),
            Path::new("out.png"),
            0.0,
        );
        assert!(err.is_err(), "a zero duration cannot be divided into tiles");
    }
}
