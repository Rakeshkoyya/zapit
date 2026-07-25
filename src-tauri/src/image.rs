//! I3's compress-to-target search (§6): binary-search encoder quality, then
//! step the resolution down 15% at a time until the file fits. Pure logic with
//! an injected encoder so tests run without ImageMagick.

use crate::error::{AppError, AppResult};

/// Outer resolution ladder: 100%, then ×0.85 per step. §6 said 6 shrinks; the
/// M3 gate (48 MP noise → 50 KB) needs the ladder to keep going — tiny targets
/// on huge/noisy sources legitimately end up below 37%.
const SCALES: &[u32] = &[
    100, 85, 72, 61, 52, 44, 37, 31, 27, 23, 19, 16, 14, 12, 10, 8, 7, 6, 5,
];
const MIN_QUALITY: u8 = 10;
const MAX_QUALITY: u8 = 95;

/// Find (quality, scale%) producing the largest file ≤ `target_kb`.
/// `encode` runs one attempt and returns the resulting byte size.
pub fn search_size<E>(target_kb: u64, mut encode: E) -> AppResult<(u8, u32)>
where
    E: FnMut(u8, u32) -> AppResult<u64>,
{
    let target_bytes = target_kb.saturating_mul(1024);
    for &scale in SCALES {
        let mut lo = MIN_QUALITY;
        let mut hi = MAX_QUALITY;
        let mut best: Option<u8> = None;
        while lo <= hi {
            let mid = lo + (hi - lo) / 2;
            let size = encode(mid, scale)?;
            if size <= target_bytes {
                best = Some(mid);
                lo = mid + 1;
            } else {
                if mid == MIN_QUALITY {
                    break;
                }
                hi = mid - 1;
            }
        }
        if let Some(quality) = best {
            return Ok((quality, scale));
        }
    }
    Err(AppError::user(format!(
        "Couldn't get the image under {target_kb} KB — it may be too detailed for that size."
    )))
}

#[cfg(test)]
mod tests {
    use super::search_size;

    /// Mock model: size grows with quality and scale.
    fn model(q: u8, scale: u32) -> u64 {
        u64::from(q) * u64::from(scale) * 20
    }

    #[test]
    fn finds_largest_quality_under_target_at_full_scale() {
        // target 120 KB = 122880 bytes; at scale 100: size = q*2000 → q=61 fits (122000), q=62 doesn't.
        let (q, scale) = search_size(120, |q, s| Ok(model(q, s))).expect("fits");
        assert_eq!(scale, 100);
        assert_eq!(q, 61);
    }

    #[test]
    fn downscales_when_min_quality_is_still_too_big() {
        // target 15 KB = 15360: scale 100 min q=10 → 20000 too big; scale 85: q*1700 → q=9? min 10 → 17000 too big;
        // scale 72: q*1440 → q=10 → 14400 fits.
        let (q, scale) = search_size(15, |q, s| Ok(model(q, s))).expect("fits after downscale");
        assert_eq!(scale, 72);
        assert_eq!(q, 10);
    }

    #[test]
    fn gives_up_with_a_user_error_when_impossible() {
        let result = search_size(0, |q, s| Ok(model(q, s)));
        assert!(result.is_err());
    }

    #[test]
    fn iteration_count_stays_bounded() {
        let mut calls = 0u32;
        let _ = search_size(120, |q, s| {
            calls += 1;
            Ok(model(q, s))
        });
        assert!(
            calls <= 8,
            "binary search should need ≤8 encodes, used {calls}"
        );
    }
}
