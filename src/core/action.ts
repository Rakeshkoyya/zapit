import type { EnginePlan } from "./plan";
import type { MediaInfo } from "./media";

/** Probe-derived facts about one input file, provided by the Rust side. */
export interface FileInfo {
  readonly path: string;
  readonly sizeBytes: number;
  /** ffprobe result; null/undefined for non-media files or probe failure. */
  readonly media?: MediaInfo | null;
}

/**
 * Options resolved from a preset submenu entry or an options window. Values
 * arrive as strings over the CLI/IPC boundary; actions parse what they need.
 */
export type ActionOptions = Readonly<Record<string, string>>;

export type ActionCategory = "video" | "audio" | "image" | "pdf" | "general";

/**
 * One entry in an action's context-menu flyout (§7.3: "clicks beat dialogs").
 * The options travel on the command line, so picking a preset never opens a
 * window. A preset with no options means "ask me" — the action throws
 * NeedsOptions and its prompt window opens.
 */
export interface ActionPreset {
  readonly label: string;
  readonly options: Readonly<Record<string, string>>;
}

/**
 * The uniform action interface (§5.1). Menu generation, settings toggles, and
 * dispatch all derive from the registry of these — adding an action is one file
 * plus one import line.
 *
 * `edition: "pro"` exists only to keep the registry future-proof; nothing Pro is
 * built in v1 (ADR 001).
 */
export interface QuickAction {
  /** Stable id, also used in registry verbs — never rename after release. */
  readonly id: string;
  readonly menuLabel: string;
  readonly category: ActionCategory;
  /** Lowercase input extensions, no dot. Empty list = any file. */
  readonly extensions: readonly string[];
  readonly multiFile: "single" | "multi" | "both";
  readonly edition: "free" | "pro";
  readonly tier: "core" | "extended" | "stretch";
  /**
   * Menu flyout entries. When present the action gets a nested submenu instead
   * of a single entry — the only way a right-click can carry options.
   */
  readonly presets?: readonly ActionPreset[];
  /** PURE: returns data, never spawns processes or touches IO. */
  buildPlan(inputs: readonly FileInfo[], opts: ActionOptions): EnginePlan;
}

/** `C:\media\video.final.mp4` → `{ base: "video.final", ext: "mp4" }`. */
export function splitName(path: string): { base: string; ext: string } {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return { base: name, ext: "" };
  }
  return { base: name.slice(0, dot), ext: name.slice(dot + 1).toLowerCase() };
}
