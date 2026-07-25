//! G1 checksums (§6): streaming SHA-256/MD5 in 1 MB chunks so a 4 GB file
//! never lands in memory, with progress callbacks and cancel support.

use crate::error::{AppError, AppResult};
use crate::sidecar::CancelFlag;
use md5::Md5;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::Path;

const CHUNK: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Algorithm {
    Sha256,
    Md5,
}

impl Algorithm {
    pub fn parse(text: &str) -> Option<Self> {
        match text.to_ascii_lowercase().as_str() {
            "sha256" | "sha-256" => Some(Algorithm::Sha256),
            "md5" => Some(Algorithm::Md5),
            _ => None,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Algorithm::Sha256 => "SHA-256",
            Algorithm::Md5 => "MD5",
        }
    }
}

/// Hash `path`, reporting 0..=100 as bytes are consumed.
pub fn hash_file(
    path: &Path,
    algorithm: Algorithm,
    cancel: &CancelFlag,
    mut on_progress: impl FnMut(u8),
) -> AppResult<String> {
    let total = std::fs::metadata(path)?.len().max(1);
    let mut file = File::open(path)
        .map_err(|e| AppError::user(format!("Couldn't open {}: {e}", path.display())))?;
    let mut buffer = vec![0u8; CHUNK];
    let mut read_total: u64 = 0;

    let mut sha = Sha256::new();
    let mut md5 = Md5::new();
    loop {
        if cancel.is_cancelled() {
            return Err(AppError::user("Cancelled"));
        }
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        match algorithm {
            Algorithm::Sha256 => sha.update(&buffer[..n]),
            Algorithm::Md5 => md5.update(&buffer[..n]),
        }
        read_total += n as u64;
        #[allow(clippy::cast_possible_truncation)]
        on_progress(((read_total.saturating_mul(100)) / total).min(100) as u8);
    }
    Ok(match algorithm {
        Algorithm::Sha256 => hex(&sha.finalize()),
        Algorithm::Md5 => hex(&md5.finalize()),
    })
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Constant-time comparison for the paste-to-compare field (§6): avoids
/// leaking match position, and normalizes case/whitespace first.
pub fn hashes_match(a: &str, b: &str) -> bool {
    let a = a.trim().to_ascii_lowercase();
    let b = b.trim().to_ascii_lowercase();
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.bytes().zip(b.bytes()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::{hash_file, hashes_match, Algorithm};
    use crate::sidecar::CancelFlag;

    #[test]
    fn parses_algorithm_names() {
        assert_eq!(Algorithm::parse("SHA-256"), Some(Algorithm::Sha256));
        assert_eq!(Algorithm::parse("md5"), Some(Algorithm::Md5));
        assert_eq!(Algorithm::parse("crc32"), None);
    }

    #[test]
    fn hashes_known_content() {
        let dir = std::env::temp_dir().join("zapit-hash-test");
        std::fs::create_dir_all(&dir).expect("temp dir");
        let file = dir.join("abc.txt");
        std::fs::write(&file, b"abc").expect("write");
        let cancel = CancelFlag::default();
        let sha = hash_file(&file, Algorithm::Sha256, &cancel, |_| {}).expect("hashes");
        assert_eq!(
            sha,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let md5 = hash_file(&file, Algorithm::Md5, &cancel, |_| {}).expect("hashes");
        assert_eq!(md5, "900150983cd24fb0d6963f7d28e17f72");
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn comparison_is_case_and_space_insensitive() {
        assert!(hashes_match("  ABC123 ", "abc123"));
        assert!(!hashes_match("abc123", "abc124"));
        assert!(!hashes_match("abc", "abcd"));
    }
}
