//! Rust mirror of the TypeScript `EnginePlan` (src/core/plan.ts). Plans are
//! pure data built in the webview; this side only deserializes and executes.
//!
//! Paths inside plans use placeholder tokens so plan builders stay pure and
//! golden tests stay machine-independent:
//!   `{tmp}`    — the job's private temp dir
//!   `{inN}`    — absolute path of input N (0-based)
//!   `{srcdir}` — directory of input 0

use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SidecarBin {
    Ffmpeg,
    Ffprobe,
    Qpdf,
    Magick,
}

impl SidecarBin {
    pub fn exe_name(self) -> &'static str {
        match self {
            SidecarBin::Ffmpeg => "ffmpeg.exe",
            SidecarBin::Ffprobe => "ffprobe.exe",
            SidecarBin::Qpdf => "qpdf.exe",
            SidecarBin::Magick => "magick.exe",
        }
    }
}

/// Convert's stderr-driven auto-retry trick (§5.2): if the step fails and its
/// stderr contains `stderr_contains`, retry once with `extra_args` inserted
/// just before the final argument (FFmpeg's output path by convention).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryRule {
    pub stderr_contains: String,
    pub extra_args: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PlanStep {
    /// Spawn a sidecar with argv (never a shell string).
    #[serde(rename_all = "camelCase")]
    Sidecar {
        bin: SidecarBin,
        args: Vec<String>,
        #[serde(default)]
        retry: Vec<RetryRule>,
        /// Total duration in microseconds for FFmpeg `out_time_us` progress math.
        #[serde(default)]
        total_us: Option<u64>,
    },
    /// Byte-for-byte copy; the `noop` action and instant operations use this.
    Copy { from: String, to: String },
    /// Write a UTF-8 text file into the temp dir (FFmpeg concat lists).
    WriteText { path: String, content: String },
    /// I3's compress-to-target: iterative quality/scale search (§6) — runs in
    /// Rust because a static plan cannot express a feedback loop.
    #[serde(rename_all = "camelCase")]
    SizeSearch {
        input: String,
        out: String,
        target_kb: u64,
        /// "jpeg" (opaque images) or "webp" (transparency preserved).
        format: String,
    },
    /// A webview JS-engine call (pdf-lib, tesseract, …): delegated back to the
    /// hidden main window; string values inside `params` get token substitution.
    Js {
        engine: String,
        #[serde(default)]
        params: serde_json::Value,
    },
    /// P3's staged compression. Either aim at a size (`target_kb`, a feedback
    /// loop) or at a quality level (`quality`: high/medium/low) for users who
    /// just want "smaller" without naming a number.
    #[serde(rename_all = "camelCase")]
    PdfCompress {
        input: String,
        out: String,
        #[serde(default)]
        target_kb: Option<u64>,
        #[serde(default)]
        quality: Option<String>,
    },
    /// G1: streaming hash, result shown in a window rather than written to disk.
    Checksum { input: String, algorithm: String },
    /// A3: two-pass EBU R128 — pass 1's JSON measurements feed pass 2, so the
    /// loop lives in Rust (§6).
    Loudnorm { input: String, out: String },
    /// P4: pdfium renders each page to PNG at `dpi`; `out_pattern` gets `{n}`
    /// replaced with a zero-padded page number.
    #[serde(rename_all = "camelCase")]
    PdfRender {
        input: String,
        out_pattern: String,
        dpi: u32,
    },
    /// P5: pdfium text extraction to a .txt file.
    PdfText { input: String, out: String },
}

/// Token substitution over every string inside a JSON value (Js step params).
pub fn substitute_value(
    value: &serde_json::Value,
    tmp: &Path,
    inputs: &[std::path::PathBuf],
) -> serde_json::Value {
    match value {
        serde_json::Value::String(s) => serde_json::Value::String(substitute(s, tmp, inputs)),
        serde_json::Value::Array(items) => serde_json::Value::Array(
            items
                .iter()
                .map(|v| substitute_value(v, tmp, inputs))
                .collect(),
        ),
        serde_json::Value::Object(map) => serde_json::Value::Object(
            map.iter()
                .map(|(k, v)| (k.clone(), substitute_value(v, tmp, inputs)))
                .collect(),
        ),
        other => other.clone(),
    }
}

/// A finished artifact: moved (§5.2, atomically where possible) from the temp
/// dir to a collision-safe name near the source once the job succeeds.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputSpec {
    pub from: String,
    pub base_name: String,
    pub ext: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnginePlan {
    pub steps: Vec<PlanStep>,
    pub outputs: Vec<OutputSpec>,
}

/// Substitute path tokens. Unknown tokens are left untouched on purpose —
/// a typo then fails loudly at execution instead of silently pointing at cwd.
pub fn substitute(text: &str, tmp: &Path, inputs: &[std::path::PathBuf]) -> String {
    let mut out = text.replace("{tmp}", &tmp.to_string_lossy());
    if let Some(first) = inputs.first() {
        if let Some(dir) = first.parent() {
            out = out.replace("{srcdir}", &dir.to_string_lossy());
        }
    }
    for (i, input) in inputs.iter().enumerate() {
        out = out.replace(&format!("{{in{i}}}"), &input.to_string_lossy());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::substitute;
    use std::path::{Path, PathBuf};

    #[test]
    fn substitutes_all_tokens() {
        let inputs = vec![PathBuf::from("C:\\media\\video.mp4")];
        let got = substitute("{srcdir}|{in0}|{tmp}\\x", Path::new("T:\\job"), &inputs);
        assert_eq!(got, "C:\\media|C:\\media\\video.mp4|T:\\job\\x");
    }

    #[test]
    fn plan_json_roundtrip() {
        let json = r#"{
            "steps": [
                {"kind": "sidecar", "bin": "ffmpeg", "args": ["-i", "{in0}", "{tmp}/o.m4a"],
                 "retry": [{"stderrContains": "not divisible by 2", "extraArgs": ["-vf", "pad"]}],
                 "totalUs": 1000},
                {"kind": "copy", "from": "{in0}", "to": "{tmp}/c.bin"}
            ],
            "outputs": [{"from": "{tmp}/o.m4a", "baseName": "video", "ext": "m4a"}]
        }"#;
        let plan: super::EnginePlan = serde_json::from_str(json).expect("valid plan JSON");
        assert_eq!(plan.steps.len(), 2);
        assert_eq!(plan.outputs.len(), 1);
    }
}
