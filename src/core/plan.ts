/**
 * Declarative execution plans — the seam that keeps every action unit-testable
 * (§2). Action modules build these as pure data; the Rust runner executes them.
 * This must stay in lockstep with `src-tauri/src/plan.rs` (serde mirror).
 *
 * Paths use placeholder tokens so plans stay machine-independent (golden tests):
 *   `{tmp}`    — the job's private temp dir
 *   `{inN}`    — absolute path of input N (0-based)
 *   `{srcdir}` — directory of input 0
 */

export type SidecarBin = "ffmpeg" | "ffprobe" | "qpdf" | "magick";

/**
 * Stderr-driven auto-retry (§5.2): if the step fails and stderr contains
 * `stderrContains`, retry once with `extraArgs` inserted before the final
 * argument (FFmpeg's output path by convention).
 */
export interface RetryRule {
  readonly stderrContains: string;
  readonly extraArgs: readonly string[];
}

/** One sidecar invocation: argv only, never a shell string. */
export interface SidecarStep {
  readonly kind: "sidecar";
  readonly bin: SidecarBin;
  readonly args: readonly string[];
  readonly retry?: readonly RetryRule[];
  /** Total duration in microseconds, enables FFmpeg progress percent. */
  readonly totalUs?: number;
}

/** Byte-for-byte copy — noop and other instant operations. */
export interface CopyStep {
  readonly kind: "copy";
  readonly from: string;
  readonly to: string;
}

/**
 * I3's compress-to-target: the Rust runner binary-searches encoder quality
 * (then downscales) until the output fits — a feedback loop no static plan
 * can express.
 */
export interface SizeSearchStep {
  readonly kind: "size-search";
  readonly input: string;
  readonly out: string;
  readonly targetKb: number;
  readonly format: "jpeg" | "webp";
}

/** A webview JS-engine call (pdf-lib, …); string values get token substitution. */
export interface JsStep {
  readonly kind: "js";
  readonly engine: string;
  readonly params?: unknown;
}

/**
 * P3's staged qpdf → rasterize pipeline, run Rust-side (ADR 004). Give it
 * either a size target or a quality level, never both.
 */
export interface PdfCompressStep {
  readonly kind: "pdf-compress";
  readonly input: string;
  readonly out: string;
  readonly targetKb?: number;
  readonly quality?: "high" | "medium" | "low";
}

/** Write a UTF-8 text file into the temp dir (FFmpeg concat lists). */
export interface WriteTextStep {
  readonly kind: "write-text";
  readonly path: string;
  readonly content: string;
}

/** G1: streaming hash; the result appears in a window, not on disk. */
export interface ChecksumStep {
  readonly kind: "checksum";
  readonly input: string;
  readonly algorithm: "sha256" | "md5";
}

/** A3: two-pass EBU R128 loudness normalization (measure → apply). */
export interface LoudnormStep {
  readonly kind: "loudnorm";
  readonly input: string;
  readonly out: string;
}

/** P4: pdfium renders each page; `{n}` in outPattern becomes the page number. */
export interface PdfRenderStep {
  readonly kind: "pdf-render";
  readonly input: string;
  readonly outPattern: string;
  readonly dpi: number;
}

/** P5: pdfium text extraction. */
export interface PdfTextStep {
  readonly kind: "pdf-text";
  readonly input: string;
  readonly out: string;
}

export type PlanStep =
  | SidecarStep
  | CopyStep
  | WriteTextStep
  | SizeSearchStep
  | JsStep
  | PdfCompressStep
  | ChecksumStep
  | LoudnormStep
  | PdfRenderStep
  | PdfTextStep;

/** A finished artifact, moved from temp to a collision-safe final name. */
export interface OutputSpec {
  readonly from: string;
  readonly baseName: string;
  readonly ext: string;
}

export interface EnginePlan {
  readonly steps: readonly PlanStep[];
  readonly outputs: readonly OutputSpec[];
}
