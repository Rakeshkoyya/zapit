/**
 * Probe results (mirror of `src-tauri/src/probe.rs` MediaInfo). Attached to
 * FileInfo by the Rust side before plan building; null when the file is not a
 * media file or probing failed — plans must handle that gracefully.
 */

export interface StreamInfo {
  readonly kind: string;
  readonly codec: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly vfr: boolean;
}

export interface MediaInfo {
  readonly durationS: number | null;
  readonly streams: readonly StreamInfo[];
}

export function audioStream(media: MediaInfo | null | undefined): StreamInfo | undefined {
  return media?.streams.find((s) => s.kind === "audio");
}

export function videoStream(media: MediaInfo | null | undefined): StreamInfo | undefined {
  return media?.streams.find((s) => s.kind === "video");
}

/** Duration in microseconds for FFmpeg progress math; undefined when unknown. */
export function durationUs(media: MediaInfo | null | undefined): number | undefined {
  const s = media?.durationS;
  return typeof s === "number" && s > 0 ? Math.round(s * 1_000_000) : undefined;
}
