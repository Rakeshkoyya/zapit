//! A3 two-pass EBU R128 loudness normalization (§6). Pass 1 measures and
//! prints JSON to stderr; pass 2 feeds those numbers back — a loop a static
//! plan cannot express, so it lives here.

use crate::error::{AppError, AppResult};
use crate::sidecar::CancelFlag;
use std::path::Path;

const TARGET_I: &str = "-16";
const TARGET_TP: &str = "-1.5";
const TARGET_LRA: &str = "11";

pub struct Measured {
    pub input_i: String,
    pub input_tp: String,
    pub input_lra: String,
    pub input_thresh: String,
    pub target_offset: String,
}

/// Pull the loudnorm JSON block out of FFmpeg's stderr tail.
pub fn parse_measurements(stderr: &str) -> Option<Measured> {
    let start = stderr.rfind('{')?;
    let end = stderr[start..].find('}')? + start + 1;
    let json: serde_json::Value = serde_json::from_str(&stderr[start..end]).ok()?;
    let get = |key: &str| json.get(key)?.as_str().map(str::to_string);
    Some(Measured {
        input_i: get("input_i")?,
        input_tp: get("input_tp")?,
        input_lra: get("input_lra")?,
        input_thresh: get("input_thresh")?,
        target_offset: get("target_offset")?,
    })
}

pub fn normalize(
    sidecar_dir: &Path,
    input: &Path,
    out: &Path,
    cancel: &CancelFlag,
) -> AppResult<()> {
    let ffmpeg = sidecar_dir.join("ffmpeg.exe");
    let filter = format!("loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}:print_format=json");
    // Pass 1 fails by design? No — it succeeds and prints JSON to stderr, which
    // run_capture only surfaces on failure, so measure with a direct call.
    let measure = std::process::Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-nostats",
            "-i",
            &input.to_string_lossy(),
            "-af",
            &filter,
            "-f",
            "null",
            "NUL",
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| AppError::system(format!("could not start ffmpeg: {e}")))?;
    if cancel.is_cancelled() {
        return Err(AppError::user("Cancelled"));
    }
    let stderr = String::from_utf8_lossy(&measure.stderr);
    let measured = parse_measurements(&stderr).ok_or_else(|| AppError::Engine {
        context: "loudness measurement failed".into(),
        stderr_tail: stderr.lines().rev().take(20).collect::<Vec<_>>().join("\n"),
    })?;

    let pass2 = format!(
        "loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}\
         :measured_I={}:measured_TP={}:measured_LRA={}:measured_thresh={}\
         :offset={}:linear=true",
        measured.input_i,
        measured.input_tp,
        measured.input_lra,
        measured.input_thresh,
        measured.target_offset
    );
    crate::sidecar::run_capture(
        &ffmpeg,
        &[
            "-hide_banner".into(),
            "-y".into(),
            "-i".into(),
            input.to_string_lossy().into_owned(),
            "-af".into(),
            pass2,
            out.to_string_lossy().into_owned(),
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_measurements;

    #[test]
    fn parses_the_json_block_from_stderr_noise() {
        let stderr = "size=N/A time=00:00:02\n\
            [Parsed_loudnorm_0 @ 0000] \n\
            {\n\
                \"input_i\" : \"-27.36\",\n\
                \"input_tp\" : \"-9.32\",\n\
                \"input_lra\" : \"0.00\",\n\
                \"input_thresh\" : \"-37.55\",\n\
                \"output_i\" : \"-16.02\",\n\
                \"target_offset\" : \"0.02\"\n\
            }\n";
        let m = parse_measurements(stderr).expect("parses");
        assert_eq!(m.input_i, "-27.36");
        assert_eq!(m.target_offset, "0.02");
    }

    #[test]
    fn returns_none_without_a_json_block() {
        assert!(parse_measurements("no json here").is_none());
    }
}
