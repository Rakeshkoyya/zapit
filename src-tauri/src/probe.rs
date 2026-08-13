//! Probe service (§5.3): `ffprobe -print_format json` → typed `MediaInfo`.
//! Plans branch on this (stream-copy vs re-encode, VFR detection, …).

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamInfo {
    pub kind: String,
    pub codec: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// True when avg_frame_rate != r_frame_rate — the VFR heuristic from §5.3.
    pub vfr: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub duration_s: Option<f64>,
    pub streams: Vec<StreamInfo>,
}

impl MediaInfo {
    pub fn has_audio(&self) -> bool {
        self.streams.iter().any(|s| s.kind == "audio")
    }

    pub fn has_video(&self) -> bool {
        self.streams.iter().any(|s| s.kind == "video")
    }

    /// Height of the first video stream — the Trim proxy only ever downscales,
    /// so it needs to know whether there is anything to downscale (ADR 005).
    pub fn video_height(&self) -> Option<u32> {
        self.streams
            .iter()
            .find(|s| s.kind == "video")
            .and_then(|s| s.height)
    }
}

// ffprobe's raw JSON shape (only the fields we read).
#[derive(Deserialize)]
struct RawProbe {
    format: Option<RawFormat>,
    #[serde(default)]
    streams: Vec<RawStream>,
}

#[derive(Deserialize)]
struct RawFormat {
    duration: Option<String>,
}

#[derive(Deserialize)]
struct RawStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    avg_frame_rate: Option<String>,
    r_frame_rate: Option<String>,
}

/// Parse ffprobe JSON output. Split from the spawn so tests cover it directly.
pub fn parse_probe_json(json: &str) -> AppResult<MediaInfo> {
    let raw: RawProbe = serde_json::from_str(json)
        .map_err(|e| AppError::system(format!("could not read media info: {e}")))?;
    let duration_s = raw
        .format
        .and_then(|f| f.duration)
        .and_then(|d| d.parse::<f64>().ok());
    let streams = raw
        .streams
        .into_iter()
        .map(|s| {
            let vfr = match (&s.avg_frame_rate, &s.r_frame_rate) {
                (Some(a), Some(r)) => a != r && a != "0/0" && r != "0/0",
                _ => false,
            };
            StreamInfo {
                kind: s.codec_type.unwrap_or_default(),
                codec: s.codec_name.unwrap_or_default(),
                width: s.width,
                height: s.height,
                vfr,
            }
        })
        .collect();
    Ok(MediaInfo {
        duration_s,
        streams,
    })
}

/// Run ffprobe on a file. `sidecar_dir` comes from the resource resolver.
pub fn probe(sidecar_dir: &Path, file: &Path) -> AppResult<MediaInfo> {
    let output = crate::sidecar::run_capture(
        &sidecar_dir.join("ffprobe.exe"),
        &[
            "-v".into(),
            "quiet".into(),
            "-print_format".into(),
            "json".into(),
            "-show_format".into(),
            "-show_streams".into(),
            file.to_string_lossy().into_owned(),
        ],
    )?;
    parse_probe_json(&output)
}

#[cfg(test)]
mod tests {
    use super::parse_probe_json;

    #[test]
    fn parses_streams_duration_and_vfr() {
        let json = r#"{
            "format": {"duration": "5.024000"},
            "streams": [
                {"codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080,
                 "avg_frame_rate": "2997/100", "r_frame_rate": "30/1"},
                {"codec_type": "audio", "codec_name": "aac",
                 "avg_frame_rate": "0/0", "r_frame_rate": "0/0"}
            ]
        }"#;
        let info = parse_probe_json(json).expect("parses");
        assert_eq!(info.duration_s, Some(5.024));
        assert_eq!(info.streams.len(), 2);
        let video = &info.streams[0];
        assert!(video.vfr, "differing rates mean VFR");
        assert_eq!(video.codec, "h264");
        assert!(info.has_audio());
        assert!(!info.streams[1].vfr, "0/0 never counts as VFR");
    }

    #[test]
    fn empty_json_is_a_clean_error() {
        assert!(parse_probe_json("not json").is_err());
    }
}
