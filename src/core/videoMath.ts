/**
 * Target-size bitrate math for V3 (§6): budget the container to ~97% of the
 * target and give audio a fixed lane.
 *
 * **Resolution is never changed here.** Compressing and downscaling are
 * separate actions (V3 vs V11), so a 1080p source always comes out 1080p. When
 * the requested size leaves too little bitrate to be watchable at the source
 * resolution we say so instead of silently shrinking the picture.
 */

export interface BitrateBudget {
  readonly videoKbps: number;
  readonly audioKbps: number;
}

/** Audio drops to this when the video lane would otherwise be starved. */
const VIDEO_FLOOR_KBPS = 150;

/**
 * Bits per pixel below which H.264 stops resembling the source at all —
 * roughly 250 kbps for 1080p30. Under this we refuse rather than hand back a
 * blocky mess (principle 5: no dead ends).
 */
export const MIN_VIABLE_BPP = 0.004;

/**
 * Bits-per-pixel → kbps. Quality presets scale with the source resolution, so
 * "Best quality" gives a 4K file a proportionally larger budget than a 720p one
 * (ADR 002: OpenH264 has no CRF, so quality has to become a bitrate).
 */
export function qualityKbps(
  bpp: number,
  width: number | null | undefined,
  height: number | null | undefined,
  fps = 30,
): number {
  const w = typeof width === "number" && width > 0 ? width : 1280;
  const h = typeof height === "number" && height > 0 ? height : 720;
  return Math.max(Math.round((bpp * w * h * fps) / 1000), 200);
}

/** The bits-per-pixel a given bitrate buys at a given resolution. */
export function bppForBitrate(
  videoKbps: number,
  width: number | null | undefined,
  height: number | null | undefined,
  fps = 30,
): number {
  const w = typeof width === "number" && width > 0 ? width : 1280;
  const h = typeof height === "number" && height > 0 ? height : 720;
  return (videoKbps * 1000) / (w * h * fps);
}

export function computeBudget(targetMb: number, durationS: number): BitrateBudget {
  if (targetMb <= 0 || durationS <= 0) {
    throw new RangeError("target size and duration must be positive");
  }
  const totalKbps = ((targetMb * 8192) / durationS) * 0.97;
  let audioKbps = 128;
  let videoKbps = totalKbps - audioKbps;
  if (videoKbps < VIDEO_FLOOR_KBPS) {
    audioKbps = 96;
    videoKbps = totalKbps - audioKbps;
  }
  return { videoKbps: Math.max(Math.floor(videoKbps), 32), audioKbps };
}
