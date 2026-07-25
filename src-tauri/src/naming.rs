//! Collision-safe output naming (§5.4): outputs never overwrite anything
//! (GOALS.md principle 3). Pure logic + a thin fs probe so tests need no disk.

use std::path::{Path, PathBuf};

/// `video.m4a` → `video (2).m4a` → `video (3).m4a` … using `exists` to test
/// candidates. Extracted from the fs so unit tests can fake collisions.
pub fn resolve_with<F: Fn(&Path) -> bool>(dir: &Path, base: &str, ext: &str, exists: F) -> PathBuf {
    let first = dir.join(format!("{base}.{ext}"));
    if !exists(&first) {
        return first;
    }
    let mut n: u32 = 2;
    loop {
        let candidate = dir.join(format!("{base} ({n}).{ext}"));
        if !exists(&candidate) {
            return candidate;
        }
        // A directory with 4 billion collisions is not a real scenario; the
        // wrapping add just guarantees termination for clippy's sake.
        n = n.wrapping_add(1);
    }
}

/// Production entry: collision test against the real filesystem.
pub fn resolve_output(dir: &Path, base: &str, ext: &str) -> PathBuf {
    resolve_with(dir, base, ext, |p| p.exists())
}

#[cfg(test)]
mod tests {
    use super::resolve_with;
    use std::path::{Path, PathBuf};

    fn taken<'a>(paths: &'a [&'a str]) -> impl Fn(&Path) -> bool + 'a {
        move |p: &Path| paths.iter().any(|t| Path::new(t) == p)
    }

    #[test]
    fn free_name_is_used_directly() {
        let out = resolve_with(Path::new("d"), "video", "m4a", taken(&[]));
        assert_eq!(out, PathBuf::from("d/video.m4a"));
    }

    #[test]
    fn collision_appends_counter_starting_at_2() {
        let out = resolve_with(Path::new("d"), "video", "m4a", taken(&["d/video.m4a"]));
        assert_eq!(out, PathBuf::from("d/video (2).m4a"));
    }

    #[test]
    fn counter_skips_all_taken_names() {
        let out = resolve_with(
            Path::new("d"),
            "video",
            "m4a",
            taken(&["d/video.m4a", "d/video (2).m4a", "d/video (3).m4a"]),
        );
        assert_eq!(out, PathBuf::from("d/video (4).m4a"));
    }

    #[test]
    fn unicode_and_spaces_survive() {
        let out = resolve_with(
            Path::new("d"),
            "मेरा वीडियो (final) 2",
            "mp4",
            taken(&["d/मेरा वीडियो (final) 2.mp4"]),
        );
        assert_eq!(out, PathBuf::from("d/मेरा वीडियो (final) 2 (2).mp4"));
    }
}
