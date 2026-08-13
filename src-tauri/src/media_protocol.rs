//! `zapitmedia://` — the Trim window's media source (ADR 005).
//!
//! Tauri's built-in asset protocol derives Content-Type from the `infer` crate,
//! which reports **`audio/m4a`** for M4A files. That is not a MIME type any
//! browser engine knows; Chromium accepts only `audio/mp4` / `audio/x-m4a`, so
//! WebView2 refused to play m4a while wav (whose sniffed type it does know)
//! worked. The header is not overridable, so we serve media ourselves and map
//! the extension to a type the engine actually recognises.
//!
//! Access is deny-by-default: a path is served only after a window has been
//! handed it and called `preview_allow` — the same posture the asset protocol's
//! empty scope had.

use std::collections::HashSet;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Cap on one response body. Media elements ask for ranges, so this bounds
/// memory without bounding playback.
const MAX_CHUNK: u64 = 1024 * 1024;
/// Above this, a request with no Range still gets a partial first chunk rather
/// than pulling a whole film into memory.
const FULL_RESPONSE_LIMIT: u64 = 16 * 1024 * 1024;

/// Extension → a MIME type WebView2 will actually hand to its media pipeline.
pub fn mime_for(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match ext.as_str() {
        // The whole reason this module exists: `audio/m4a` is not a real type.
        "m4a" | "aac" => "audio/mp4",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "ogg" | "opus" => "audio/ogg",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        _ => "application/octet-stream",
    }
}

/// Parse `bytes=START-[END]` against a known length. Returns an inclusive
/// range already clamped to the file and to `MAX_CHUNK`.
pub fn parse_range(header: &str, len: u64) -> Option<(u64, u64)> {
    let spec = header.trim().strip_prefix("bytes=")?;
    // Multi-range requests are legal but no media element sends them; serving
    // the first range is the accepted simplification.
    let spec = spec.split(',').next()?.trim();
    let (raw_start, raw_end) = spec.split_once('-')?;
    if len == 0 {
        return None;
    }
    let last = len - 1;
    let (start, end) = if raw_start.is_empty() {
        // `bytes=-500` means the final 500 bytes.
        let want: u64 = raw_end.trim().parse().ok()?;
        (len.saturating_sub(want), last)
    } else {
        let start: u64 = raw_start.trim().parse().ok()?;
        let end = if raw_end.trim().is_empty() {
            last
        } else {
            raw_end.trim().parse::<u64>().ok()?.min(last)
        };
        (start, end)
    };
    if start > last || end < start {
        return None;
    }
    Some((start, end.min(start + MAX_CHUNK - 1)))
}

fn error(status: u16) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(status)
        .body(Vec::new())
        .unwrap_or_default()
}

/// Turn a request URI into the file path it addresses.
fn requested_path(uri: &str) -> Option<PathBuf> {
    // Windows form: http://zapitmedia.localhost/<percent-encoded path>
    let (_host, tail) = uri
        .split_once("://")
        .map_or(uri, |(_, rest)| rest)
        .split_once('/')?;
    let tail = tail.split(['?', '#']).next().unwrap_or(tail);
    Some(PathBuf::from(percent_decode(tail)))
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(byte) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Serve one request. `allowed` is the deny-by-default set of granted paths.
pub fn respond(
    allowed: &Mutex<HashSet<PathBuf>>,
    request: &http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
    let Some(path) = requested_path(&request.uri().to_string()) else {
        return error(400);
    };
    // Deny-by-default: only files a window was explicitly handed.
    let permitted = allowed.lock().is_ok_and(|set| set.contains(&path));
    if !permitted {
        return error(403);
    }
    let Ok(mut file) = std::fs::File::open(&path) else {
        return error(404);
    };
    let Ok(meta) = file.metadata() else {
        return error(404);
    };
    let len = meta.len();
    let mime = mime_for(&path);

    let requested = request
        .headers()
        .get(http::header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| parse_range(v, len));

    // No Range on a large file would otherwise mean reading it all into memory;
    // answer with the first chunk instead and let the engine range the rest.
    let range = match requested {
        Some(found) => Some(found),
        None if len > FULL_RESPONSE_LIMIT => Some((0, MAX_CHUNK.min(len) - 1)),
        None => None,
    };

    match range {
        Some((start, end)) => {
            let size = end - start + 1;
            let Ok(capacity) = usize::try_from(size) else {
                return error(500);
            };
            let mut buffer = vec![0u8; capacity];
            if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut buffer).is_err() {
                return error(500);
            }
            http::Response::builder()
                .status(206)
                .header(http::header::CONTENT_TYPE, mime)
                .header(http::header::ACCEPT_RANGES, "bytes")
                .header(http::header::CONTENT_LENGTH, size)
                .header(
                    http::header::CONTENT_RANGE,
                    format!("bytes {start}-{end}/{len}"),
                )
                .body(buffer)
                .unwrap_or_else(|_| error(500))
        }
        None => {
            let mut buffer = Vec::new();
            if file.read_to_end(&mut buffer).is_err() {
                return error(500);
            }
            http::Response::builder()
                .status(200)
                .header(http::header::CONTENT_TYPE, mime)
                .header(http::header::ACCEPT_RANGES, "bytes")
                .header(http::header::CONTENT_LENGTH, buffer.len())
                .body(buffer)
                .unwrap_or_else(|_| error(500))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn m4a_gets_a_type_the_engine_recognises() {
        // The reported bug: infer says "audio/m4a", which Chromium rejects.
        assert_eq!(mime_for(Path::new("a.m4a")), "audio/mp4");
        assert_eq!(mime_for(Path::new("A.M4A")), "audio/mp4");
        assert_eq!(mime_for(Path::new("a.wav")), "audio/wav");
        assert_eq!(mime_for(Path::new("a.mp4")), "video/mp4");
        assert_eq!(mime_for(Path::new("a.unknown")), "application/octet-stream");
    }

    #[test]
    fn parses_an_open_ended_range() {
        assert_eq!(parse_range("bytes=0-", 500), Some((0, 499)));
    }

    #[test]
    fn clamps_a_range_to_the_chunk_cap() {
        let (start, end) = parse_range("bytes=0-", 10 * MAX_CHUNK).expect("range");
        assert_eq!(start, 0);
        assert_eq!(end, MAX_CHUNK - 1);
    }

    #[test]
    fn clamps_an_end_past_the_file() {
        assert_eq!(parse_range("bytes=10-9999", 100), Some((10, 99)));
    }

    #[test]
    fn parses_a_suffix_range() {
        assert_eq!(parse_range("bytes=-20", 100), Some((80, 99)));
    }

    #[test]
    fn rejects_nonsense_and_out_of_bounds() {
        assert!(parse_range("items=0-1", 100).is_none());
        assert!(parse_range("bytes=500-600", 100).is_none());
        assert!(parse_range("bytes=abc-", 100).is_none());
        assert!(parse_range("bytes=0-", 0).is_none());
    }

    #[test]
    fn decodes_a_percent_encoded_windows_path() {
        let path = requested_path("http://zapitmedia.localhost/C%3A%5Cclips%5Ca%20b.mp4");
        assert_eq!(path, Some(PathBuf::from(r"C:\clips\a b.mp4")));
    }

    #[test]
    fn unlisted_paths_are_refused() {
        let allowed = Mutex::new(HashSet::new());
        let request = http::Request::builder()
            .uri("http://zapitmedia.localhost/C%3A%5Csecret.mp4")
            .body(Vec::new())
            .expect("request");
        assert_eq!(respond(&allowed, &request).status(), 403);
    }
}
