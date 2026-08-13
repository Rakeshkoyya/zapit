/**
 * Preview plumbing for the Trim window (ADR 005): asset-protocol URLs for the
 * source file, the filmstrip/waveform pre-passes, and the opt-in proxy build
 * for containers WebView2 refuses to decode.
 */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface SourceInfo {
  readonly jobId: string;
  readonly path: string;
  readonly hasVideo: boolean;
  readonly hasAudio: boolean;
  readonly durationS: number;
}

export interface PreviewAssets {
  readonly filmstrip: string | null;
  readonly waveform: string | null;
}

interface RawAssets {
  readonly filmstrip: string | null;
  readonly waveform: string | null;
}

interface ProgressPayload {
  readonly jobId: string;
  readonly percent: number;
}

/** Allow the file through the (otherwise empty) asset scope, then address it. */
export async function sourceUrl(path: string): Promise<string> {
  await invoke("preview_allow", { path });
  return convertFileSrc(path);
}

/** Filmstrip and waveform; either may be null when the source lacks that stream. */
export async function loadAssets(info: SourceInfo): Promise<PreviewAssets> {
  const raw = await invoke<RawAssets>("preview_assets", {
    jobId: info.jobId,
    path: info.path,
    hasVideo: info.hasVideo,
    hasAudio: info.hasAudio,
    durationS: info.durationS,
  });
  return {
    filmstrip: raw.filmstrip === null ? null : convertFileSrc(raw.filmstrip),
    waveform: raw.waveform === null ? null : convertFileSrc(raw.waveform),
  };
}

/**
 * Transcode a playable stand-in. Resolves to its asset URL; rejects with
 * "Cancelled" when `cancelProxy` interrupts it.
 */
export async function buildProxy(
  info: SourceInfo,
  sourceHeight: number | null,
  onProgress: (percent: number) => void,
): Promise<string> {
  const unlisten = await listen<ProgressPayload>("preview://progress", (event) => {
    if (event.payload.jobId === info.jobId) {
      onProgress(event.payload.percent);
    }
  });
  try {
    const path = await invoke<string>("build_preview_proxy", {
      jobId: info.jobId,
      path: info.path,
      hasVideo: info.hasVideo,
      sourceHeight,
      durationS: info.durationS,
    });
    return convertFileSrc(path);
  } finally {
    unlisten();
  }
}

export async function cancelProxy(jobId: string): Promise<void> {
  await invoke("cancel_preview", { jobId });
}
