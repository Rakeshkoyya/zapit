/**
 * The Trim timeline (ADR 005): drag on empty track to create a region, drag a
 * region body to move it, drag an edge to resize. A press that never moves is a
 * seek, not a zero-length cut.
 *
 * Regions here are whatever the Keep/Remove toggle says they are — the window
 * converts them to keep-regions before submitting.
 */
import { MIN_SEGMENT_S, normalizeSegments, type Segment } from "../../core/segments";

export interface TimelineOptions {
  /** The track element; its width defines the seconds-per-pixel scale. */
  readonly track: HTMLElement;
  readonly regionLayer: HTMLElement;
  readonly playhead: HTMLElement;
  readonly durationS: number;
  onChange(segments: readonly Segment[]): void;
  onSeek(seconds: number): void;
  onSelect(index: number | null): void;
}

type DragKind = "create" | "move" | "start" | "end";

interface Drag {
  readonly kind: DragKind;
  readonly index: number;
  readonly grabS: number;
  readonly originStart: number;
  readonly originEnd: number;
  moved: boolean;
}

/** Pointer travel below this is a click, not a drag. */
const CLICK_SLOP_PX = 3;

export class Timeline {
  private segments: Segment[] = [];
  private selected: number | null = null;
  private drag: Drag | null = null;
  private dragStartX = 0;

  constructor(private readonly opts: TimelineOptions) {
    opts.track.addEventListener("pointerdown", (e) => {
      this.onPointerDown(e);
    });
    opts.track.addEventListener("pointermove", (e) => {
      this.onPointerMove(e);
    });
    opts.track.addEventListener("pointerup", (e) => {
      this.onPointerUp(e);
    });
    opts.track.addEventListener("pointercancel", () => {
      this.drag = null;
    });
    // A resized window changes the pixel scale, not the model.
    window.addEventListener("resize", () => {
      this.render();
    });
  }

  getSegments(): readonly Segment[] {
    return this.segments;
  }

  setSegments(segments: readonly Segment[]): void {
    this.segments = [...normalizeSegments(segments, this.opts.durationS)];
    this.selected = null;
    this.render();
    this.opts.onChange(this.segments);
  }

  setPlayhead(seconds: number): void {
    this.opts.playhead.style.left = `${String(this.ratio(seconds) * 100)}%`;
  }

  setSelected(index: number | null): void {
    this.selected = index !== null && index >= 0 && index < this.segments.length ? index : null;
    this.render();
    this.opts.onSelect(this.selected);
  }

  /** Drops a new region into the widest free gap — the "+ Add cut" button. */
  addCut(): void {
    const gap = this.widestGap();
    if (gap === null) {
      return;
    }
    const span = Math.min(gap.endS - gap.startS, Math.max(1, this.opts.durationS / 10));
    const mid = (gap.startS + gap.endS) / 2;
    this.commit([...this.segments, { startS: mid - span / 2, endS: mid + span / 2 }]);
  }

  removeSelected(): void {
    if (this.selected === null) {
      return;
    }
    const kept = this.segments.filter((_, i) => i !== this.selected);
    this.selected = null;
    this.commit(kept);
  }

  // ---- pointer handling ----

  private onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    const at = this.secondsAt(event.clientX);
    this.dragStartX = event.clientX;
    this.opts.track.setPointerCapture(event.pointerId);

    const hit = this.hitTest(event.target);
    if (hit === null) {
      // Provisional region; discarded on pointerup if the pointer never moved.
      this.segments = [...this.segments, { startS: at, endS: at }];
      this.selected = this.segments.length - 1;
      this.drag = {
        kind: "create",
        index: this.selected,
        grabS: at,
        originStart: at,
        originEnd: at,
        moved: false,
      };
      return;
    }
    const segment = this.segments[hit.index];
    if (segment === undefined) {
      return;
    }
    this.selected = hit.index;
    this.drag = {
      kind: hit.kind,
      index: hit.index,
      grabS: at,
      originStart: segment.startS,
      originEnd: segment.endS,
      moved: false,
    };
    this.render();
    this.opts.onSelect(this.selected);
  }

  private onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (drag === null) {
      return;
    }
    if (Math.abs(event.clientX - this.dragStartX) > CLICK_SLOP_PX) {
      drag.moved = true;
    }
    const at = this.secondsAt(event.clientX);
    const next = [...this.segments];
    const limit = this.opts.durationS;
    switch (drag.kind) {
      case "create":
        next[drag.index] = { startS: Math.min(drag.grabS, at), endS: Math.max(drag.grabS, at) };
        break;
      case "move": {
        const span = drag.originEnd - drag.originStart;
        const startS = clamp(drag.originStart + (at - drag.grabS), 0, Math.max(0, limit - span));
        next[drag.index] = { startS, endS: startS + span };
        break;
      }
      case "start":
        next[drag.index] = {
          startS: clamp(at, 0, drag.originEnd - MIN_SEGMENT_S),
          endS: drag.originEnd,
        };
        break;
      case "end":
        next[drag.index] = {
          startS: drag.originStart,
          endS: clamp(at, drag.originStart + MIN_SEGMENT_S, limit),
        };
        break;
    }
    this.segments = next;
    this.render();
  }

  private onPointerUp(event: PointerEvent): void {
    const drag = this.drag;
    this.drag = null;
    if (drag === null) {
      return;
    }
    this.opts.track.releasePointerCapture(event.pointerId);
    if (drag.kind === "create" && !drag.moved) {
      // A bare click on empty track means "put the playhead here".
      this.segments = this.segments.filter((_, i) => i !== drag.index);
      this.selected = null;
      this.render();
      this.opts.onSelect(null);
      this.opts.onSeek(drag.grabS);
      return;
    }
    // Normalizing can merge two regions into one, so re-find the one the user
    // was actually holding rather than trusting the old index.
    const held = this.segments[drag.index];
    const anchor = held === undefined ? null : (held.startS + held.endS) / 2;
    this.commit(this.segments);
    this.selected = anchor === null ? null : this.indexAt(anchor);
    this.render();
    this.opts.onSelect(this.selected);
  }

  private commit(segments: readonly Segment[]): void {
    this.segments = [...normalizeSegments(segments, this.opts.durationS)];
    this.render();
    this.opts.onChange(this.segments);
  }

  // ---- geometry ----

  private secondsAt(clientX: number): number {
    const rect = this.opts.track.getBoundingClientRect();
    const ratio = rect.width === 0 ? 0 : (clientX - rect.left) / rect.width;
    return clamp(ratio, 0, 1) * this.opts.durationS;
  }

  private ratio(seconds: number): number {
    return this.opts.durationS > 0 ? clamp(seconds / this.opts.durationS, 0, 1) : 0;
  }

  private indexAt(seconds: number): number | null {
    const found = this.segments.findIndex((s) => seconds >= s.startS && seconds <= s.endS);
    return found === -1 ? null : found;
  }

  private widestGap(): Segment | null {
    const limit = this.opts.durationS;
    if (limit <= 0) {
      return null;
    }
    const gaps: Segment[] = [];
    let cursor = 0;
    for (const segment of this.segments) {
      if (segment.startS - cursor >= MIN_SEGMENT_S) {
        gaps.push({ startS: cursor, endS: segment.startS });
      }
      cursor = Math.max(cursor, segment.endS);
    }
    if (limit - cursor >= MIN_SEGMENT_S) {
      gaps.push({ startS: cursor, endS: limit });
    }
    return gaps.reduce<Segment | null>(
      (best, gap) =>
        best === null || gap.endS - gap.startS > best.endS - best.startS ? gap : best,
      null,
    );
  }

  /** Which region (and which part of it) a pointer landed on, if any. */
  private hitTest(target: EventTarget | null): { kind: DragKind; index: number } | null {
    if (!(target instanceof HTMLElement)) {
      return null;
    }
    const element = target.closest<HTMLElement>("[data-region]");
    if (element === null) {
      return null;
    }
    const index = Number(element.dataset.region);
    if (!Number.isInteger(index)) {
      return null;
    }
    const handle = target.dataset.handle;
    if (handle === "start" || handle === "end") {
      return { kind: handle, index };
    }
    return { kind: "move", index };
  }

  // ---- rendering ----

  private render(): void {
    const layer = this.opts.regionLayer;
    layer.replaceChildren();
    this.segments.forEach((segment, index) => {
      const region = document.createElement("div");
      region.className = index === this.selected ? "region selected" : "region";
      region.dataset.region = String(index);
      const left = this.ratio(segment.startS);
      const right = this.ratio(segment.endS);
      region.style.left = `${String(left * 100)}%`;
      region.style.width = `${String((right - left) * 100)}%`;

      const label = document.createElement("span");
      label.className = "region-label";
      label.textContent = String(index + 1);

      const start = document.createElement("div");
      start.className = "handle handle-start";
      start.dataset.handle = "start";
      const end = document.createElement("div");
      end.className = "handle handle-end";
      end.dataset.handle = "end";

      region.append(start, label, end);
      layer.appendChild(region);
    });
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
