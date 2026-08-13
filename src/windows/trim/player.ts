/**
 * Segment-aware playback (ADR 005). Play does not play the file — it plays the
 * *result*: each keep-region in order, jumping the gaps, stopping at the end.
 * That is the whole point of the preview, so the boundary check runs on
 * requestAnimationFrame rather than `timeupdate` (which fires ~4×/s and would
 * overshoot every cut by up to a quarter second).
 */
import type { Segment } from "../../core/segments";

export interface PlayerOptions {
  readonly media: HTMLMediaElement;
  onTime(seconds: number): void;
  onPlayingChange(playing: boolean): void;
}

export class SegmentPlayer {
  private segments: readonly Segment[] = [];
  /** Index of the region being played; === segments.length once finished. */
  private index = 0;
  /** False while the user is scrubbing the raw source outside any region. */
  private following = false;
  private frame = 0;

  constructor(private readonly opts: PlayerOptions) {
    opts.media.addEventListener("play", () => {
      this.opts.onPlayingChange(true);
      this.tick();
    });
    opts.media.addEventListener("pause", () => {
      this.opts.onPlayingChange(false);
      this.stopTicking();
      this.opts.onTime(this.opts.media.currentTime);
    });
    opts.media.addEventListener("seeked", () => {
      this.opts.onTime(this.opts.media.currentTime);
    });
    opts.media.addEventListener("ended", () => {
      this.following = false;
      this.opts.onPlayingChange(false);
      this.stopTicking();
    });
  }

  setSource(url: string): void {
    this.opts.media.src = url;
    this.opts.media.load();
  }

  setSegments(segments: readonly Segment[]): void {
    this.segments = segments;
    if (this.index >= segments.length) {
      this.index = 0;
    }
  }

  isPlaying(): boolean {
    return !this.opts.media.paused;
  }

  /** Space bar and the transport button: play the assembled cut, or pause. */
  toggle(): void {
    if (this.isPlaying()) {
      this.pause();
    } else {
      this.playAll();
    }
  }

  /** Start at the first region, or resume from wherever the playhead sits. */
  playAll(): void {
    const first = this.segments[0];
    if (first === undefined) {
      return;
    }
    const at = this.opts.media.currentTime;
    const resumable = this.segments.findIndex((s) => at >= s.startS && at < s.endS - 0.05);
    if (resumable === -1) {
      this.index = 0;
      this.opts.media.currentTime = first.startS;
    } else {
      this.index = resumable;
    }
    this.following = true;
    void this.opts.media.play().catch(() => {
      // Codec refusals surface through the element's own error handler.
      this.following = false;
    });
  }

  pause(): void {
    this.opts.media.pause();
  }

  /** Free scrub. Staying inside a region keeps the cut preview running. */
  seek(seconds: number): void {
    this.opts.media.currentTime = seconds;
    const inside = this.segments.findIndex((s) => seconds >= s.startS && seconds <= s.endS);
    if (inside === -1) {
      this.following = false;
    } else {
      this.index = inside;
    }
    this.opts.onTime(seconds);
  }

  private tick(): void {
    this.stopTicking();
    const step = (): void => {
      const media = this.opts.media;
      if (media.paused) {
        return;
      }
      this.advance(media.currentTime);
      this.opts.onTime(media.currentTime);
      this.frame = window.requestAnimationFrame(step);
    };
    this.frame = window.requestAnimationFrame(step);
  }

  private stopTicking(): void {
    if (this.frame !== 0) {
      window.cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
  }

  /** Hop to the next region once the current one runs out. */
  private advance(now: number): void {
    if (!this.following) {
      return;
    }
    const current = this.segments[this.index];
    if (current === undefined) {
      this.pause();
      return;
    }
    if (now < current.startS - 0.05) {
      this.opts.media.currentTime = current.startS;
      return;
    }
    if (now < current.endS) {
      return;
    }
    const next = this.segments[this.index + 1];
    if (next === undefined) {
      this.pause();
      this.following = false;
      return;
    }
    this.index += 1;
    this.opts.media.currentTime = next.startS;
  }
}
