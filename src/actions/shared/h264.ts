/**
 * Shared OpenH264 encode args (ADR 002): bitrate-driven with sane caps,
 * yuv420p pinned for player compatibility.
 */
export function h264EncodeArgs(kbps: number): string[] {
  return [
    "-c:v",
    "libopenh264",
    "-b:v",
    `${String(kbps)}k`,
    "-maxrate",
    `${String(Math.round(kbps * 1.15))}k`,
    "-bufsize",
    `${String(kbps * 2)}k`,
    "-pix_fmt",
    "yuv420p",
  ];
}
