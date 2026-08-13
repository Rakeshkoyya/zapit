/**
 * Trim window (V6/A2, ADR 005): a timeline editor. Drag regions over a
 * filmstrip/waveform, press Play to hear the assembled result, then submit the
 * keep-regions as `segments` plus `mode` and `lossless`.
 *
 * This file is wiring only — the interaction lives in `timeline.ts`, playback
 * in `player.ts`, and the FFmpeg-backed previews in `preview.ts`.
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { formatSegments, invertSegments, totalSeconds, type Segment } from "../../core/segments";
import { Timeline } from "./timeline";
import { SegmentPlayer } from "./player";
import { buildProxy, cancelProxy, loadAssets, sourceUrl, type SourceInfo } from "./preview";

const params = new URLSearchParams(window.location.search);
const jobId = params.get("job") ?? "";
const durationS = Number(params.get("duration") ?? "0");
const fileName = params.get("name") ?? "";
const path = params.get("path") ?? "";
const hasVideo = params.get("hasVideo") === "1";
const hasAudio = params.get("hasAudio") === "1";

const source: SourceInfo = { jobId, path, hasVideo, hasAudio, durationS };

/** Every id below is guaranteed by trim.html; a miss is a build error, not a runtime one. */
function el(id: string): HTMLElement {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return document.getElementById(id)!;
}

const mediaEl = el("media") as HTMLVideoElement;
const stageMessage = el("stage-message");
const stageNote = el("stage-note");
const buildButton = el("build-preview") as HTMLButtonElement;
const proxyBar = el("proxy-bar");
const proxyFill = el("proxy-fill");
const cancelPreviewButton = el("cancel-preview") as HTMLButtonElement;
const playButton = el("play") as HTMLButtonElement;
const clockEl = el("clock");
const cutsEl = el("cuts");
const emptyEl = el("empty");
const summaryEl = el("summary");
const errorEl = el("error");
const losslessEl = el("lossless") as HTMLInputElement;
const mergeEl = el("merge") as HTMLInputElement;

let regionMode: "keep" | "remove" = "keep";
let selected: number | null = null;
/** Regions drawn on the timeline, before the Keep/Remove toggle is applied. */
let drawn: readonly Segment[] = [];

el("file-name").textContent = fileName;
el("duration").textContent = durationS > 0 ? formatClock(durationS) : "";

// ---- timeline + player ----

const timeline = new Timeline({
  track: el("track"),
  regionLayer: el("regions"),
  playhead: el("playhead"),
  durationS,
  onChange: (segments) => {
    drawn = segments;
    refresh();
  },
  onSeek: (seconds) => {
    player.seek(seconds);
  },
  onSelect: (index) => {
    selected = index;
    renderCuts();
  },
});

const player = new SegmentPlayer({
  media: mediaEl,
  onTime: (seconds) => {
    timeline.setPlayhead(seconds);
    clockEl.textContent = formatClock(seconds);
  },
  onPlayingChange: (playing) => {
    playButton.textContent = playing ? "❚❚ Pause" : "▶ Play cut";
  },
});

function keepSegments(): readonly Segment[] {
  return regionMode === "keep" ? drawn : invertSegments(drawn, durationS);
}

/** Everything downstream of the regions: player, list, summary, submit state. */
function refresh(): void {
  const keep = keepSegments();
  player.setSegments(keep);
  renderCuts();
  errorEl.textContent = "";
  const clips = keep.length;
  if (clips === 0) {
    summaryEl.textContent = "Nothing selected.";
    return;
  }
  const destination = mergeEl.checked || clips === 1 ? "1 file" : `${String(clips)} files`;
  const length = formatClock(totalSeconds(keep));
  summaryEl.textContent = `${String(clips)} ${clips === 1 ? "clip" : "clips"} · ${length} → ${destination}`;
}

// ---- cut list ----

function renderCuts(): void {
  cutsEl.replaceChildren();
  drawn.forEach((segment, index) => {
    const row = document.createElement("li");
    row.className = index === selected ? "selected" : "";
    row.addEventListener("click", () => {
      timeline.setSelected(index);
      player.seek(segment.startS);
    });

    const number = document.createElement("span");
    number.className = "index";
    number.textContent = String(index + 1);

    const range = document.createElement("span");
    range.textContent = `${formatClock(segment.startS)} – ${formatClock(segment.endS)}`;

    const length = document.createElement("span");
    length.style.opacity = "0.6";
    length.textContent = `(${formatClock(segment.endS - segment.startS)})`;

    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "drop";
    drop.textContent = "✕";
    drop.title = "Remove this cut";
    drop.addEventListener("click", (event) => {
      event.stopPropagation();
      timeline.setSelected(index);
      timeline.removeSelected();
    });

    row.append(number, range, length, drop);
    cutsEl.appendChild(row);
  });

  const none = drawn.length === 0;
  emptyEl.hidden = !none;
  emptyEl.textContent = none
    ? regionMode === "keep"
      ? "Drag across the timeline to choose what to keep."
      : "Drag across the timeline to mark what to remove."
    : "";
}

function renderRuler(): void {
  const ruler = el("ruler");
  ruler.replaceChildren();
  const marks = 5;
  for (let i = 0; i < marks; i += 1) {
    const label = document.createElement("span");
    label.textContent = formatClock((durationS * i) / (marks - 1));
    ruler.appendChild(label);
  }
}

// The old window opened on the whole file; keeping that as the starting region
// makes the common "just top and tail it" case a two-drag job.
timeline.setSegments(durationS > 0 ? [{ startS: 0, endS: durationS }] : []);
renderRuler();

// ---- controls ----

playButton.addEventListener("click", () => {
  player.toggle();
});
el("add-cut").addEventListener("click", () => {
  timeline.addCut();
});

function setRegionMode(mode: "keep" | "remove"): void {
  regionMode = mode;
  document.body.dataset.regionMode = mode;
  el("mode-keep").setAttribute("aria-pressed", String(mode === "keep"));
  el("mode-remove").setAttribute("aria-pressed", String(mode === "remove"));
  refresh();
}
el("mode-keep").addEventListener("click", () => {
  setRegionMode("keep");
});
el("mode-remove").addEventListener("click", () => {
  setRegionMode("remove");
});
mergeEl.addEventListener("change", () => {
  refresh();
});

document.addEventListener("keydown", (event) => {
  const typing = event.target instanceof HTMLInputElement;
  if (event.key === " " && !typing) {
    event.preventDefault();
    player.toggle();
  } else if (event.key === "Delete" || event.key === "Backspace") {
    timeline.removeSelected();
  }
});

el("go").addEventListener("click", () => {
  const keep = keepSegments();
  if (keep.length === 0) {
    errorEl.textContent =
      regionMode === "keep" ? "Add at least one cut." : "That removes the whole file.";
    return;
  }
  player.pause();
  const options: Record<string, string> = {
    segments: formatSegments(keep),
    mode: mergeEl.checked ? "merge" : "separate",
    lossless: losslessEl.checked ? "true" : "false",
  };
  void invoke("submit_options", { jobId, options }).then(() => getCurrentWindow().close());
});

el("cancel").addEventListener("click", () => {
  void getCurrentWindow().close();
});
window.addEventListener("pagehide", () => {
  // Do not leave an FFmpeg proxy encoding for a window that no longer exists.
  void cancelProxy(jobId);
});

// ---- preview loading ----

/** Set once we know whether the webview can decode the source. */
let proxySettled = false;

function showStage(note: string, canBuild: boolean): void {
  stageMessage.hidden = false;
  stageNote.textContent = note;
  buildButton.hidden = !canBuild;
  proxyBar.hidden = true;
  cancelPreviewButton.hidden = true;
}

function offerProxy(): void {
  if (proxySettled) {
    return;
  }
  proxySettled = true;
  showStage(
    "This format can't play in the preview window. You can still place cuts on the timeline, or build a low-resolution preview.",
    hasVideo || hasAudio,
  );
}

mediaEl.addEventListener("loadedmetadata", () => {
  proxySettled = true; // it plays; never offer the proxy
  stageMessage.hidden = true;
});
mediaEl.addEventListener("error", () => {
  offerProxy();
});

buildButton.addEventListener("click", () => {
  buildButton.hidden = true;
  proxyBar.hidden = false;
  cancelPreviewButton.hidden = false;
  stageNote.textContent = "Building preview…";
  buildProxy(source, null, (percent) => {
    proxyFill.style.width = `${String(percent)}%`;
  })
    .then((url) => {
      stageMessage.hidden = true;
      player.setSource(url);
    })
    .catch(() => {
      showStage("The preview could not be built. Cuts still work without it.", false);
    });
});

cancelPreviewButton.addEventListener("click", () => {
  void cancelProxy(jobId);
  showStage("Preview cancelled. Cuts still work without it.", true);
});

async function load(): Promise<void> {
  if (!hasVideo) {
    mediaEl.classList.add("audio-only");
    showStage("Audio — press Play to hear the cut.", false);
  }
  try {
    player.setSource(await sourceUrl(path));
  } catch {
    offerProxy();
  }
  // Slower than the source URL, so it lands whenever it lands.
  try {
    const assets = await loadAssets(source);
    if (assets.filmstrip !== null) {
      el("strip").style.backgroundImage = `url("${assets.filmstrip}")`;
    }
    if (assets.waveform !== null) {
      el("wave").style.backgroundImage = `url("${assets.waveform}")`;
    }
  } catch {
    // A missing strip is cosmetic; the timeline still works.
  }
}
void load();

/** `74.25` → `1:14.3`; hours only appear when there are hours. */
function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = (safe % 60).toFixed(1).padStart(4, "0");
  if (hours > 0) {
    return `${String(hours)}:${String(minutes).padStart(2, "0")}:${secs}`;
  }
  return `${String(minutes)}:${secs}`;
}
