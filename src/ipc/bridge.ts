/**
 * The only module that touches Tauri IPC (§12: action modules stay pure).
 * Wires the plan-request loop: Rust asks, the registry builds, we answer with
 * a plan, a needs-options signal, or a user-facing failure.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ActionOptions, FileInfo } from "../core/action";
import { NeedsOptions, PlanError } from "../core/planError";
import { findAction, findMenuActions } from "../actions/registry";

interface PlanRequest {
  readonly jobId: string;
  readonly actionId: string;
  readonly inputs: readonly FileInfo[];
  readonly options: ActionOptions;
}

interface JsRequest {
  readonly jobId: string;
  readonly engine: string;
  readonly params: unknown;
}

/** Dispatch js:// engine calls (pdf-lib etc.) and report back to the runner. */
async function startJsService(): Promise<void> {
  const { pdfMerge, pdfSplit, imagesToPdf } = await import("../engines/pdfLib");
  await listen<JsRequest>("js://execute", (event) => {
    const { jobId, engine, params } = event.payload;
    const run = async (): Promise<void> => {
      switch (engine) {
        case "pdf-merge":
          await pdfMerge(params as Parameters<typeof pdfMerge>[0]);
          break;
        case "pdf-split":
          await pdfSplit(params as Parameters<typeof pdfSplit>[0]);
          break;
        case "images-to-pdf":
          await imagesToPdf(params as Parameters<typeof imagesToPdf>[0]);
          break;
        default:
          throw new Error(`Unknown engine "${engine}".`);
      }
    };
    run()
      .then(() => invoke("js_done", { jobId, error: null }))
      .catch((err: unknown) => {
        // Tauri invoke rejections are plain strings/objects, not Errors.
        let message: string;
        if (err instanceof Error) {
          message = err.message;
        } else if (typeof err === "string") {
          message = err;
        } else {
          message = JSON.stringify(err);
        }
        return invoke("js_done", { jobId, error: message });
      });
  });
}

/** Shape the Rust registry writer expects (mirror of MenuAction). */
export interface MenuAction {
  readonly id: string;
  readonly menuLabel: string;
  readonly extensions: readonly string[];
  readonly multiFile: string;
  /** Non-empty → the entry becomes a nested flyout of preset choices. */
  readonly presets: readonly { label: string; options: Record<string, string> }[];
}

/** Menu entries for the currently enabled actions (the `noop` canary never shows). */
export function menuActions(disabled: readonly string[]): MenuAction[] {
  return findMenuActions(disabled).map((a) => ({
    id: a.id,
    menuLabel: a.menuLabel,
    extensions: a.extensions,
    multiFile: a.multiFile,
    presets: (a.presets ?? []).map((p) => ({ label: p.label, options: { ...p.options } })),
  }));
}

/** Answers `menu://request` for the `install-menu` / `uninstall-menu` verbs. */
async function startMenuService(): Promise<void> {
  await listen("menu://request", () => {
    const disabled = configuredDisabled;
    void invoke("menu_built", { actions: menuActions(disabled) });
  });
}

/** Disabled ids, loaded once at startup so the menu service stays synchronous. */
let configuredDisabled: readonly string[] = [];

export async function startPlanService(): Promise<void> {
  try {
    const config = await invoke<{ disabledActions?: string[] }>("get_config");
    configuredDisabled = config.disabledActions ?? [];
  } catch {
    configuredDisabled = [];
  }
  await startMenuService();
  await startJsService();
  /**
   * True when the context menu launched a preset-bearing action and the user
   * has not chosen yet. `menu=1` must be the *only* option: once the presets
   * window replies it adds `preset` (and the preset's own keys), which lets the
   * next round build a plan instead of reopening the window.
   */
  const fromMenuWithoutChoice = (
    action: { readonly presets?: readonly unknown[] },
    options: Readonly<Record<string, string>>,
  ): boolean =>
    (action.presets?.length ?? 0) > 0 && options.menu === "1" && Object.keys(options).length === 1;

  await listen<PlanRequest>("plan://request", (event) => {
    const { jobId, actionId, inputs, options } = event.payload;
    const action = findAction(actionId);
    if (action === undefined) {
      void invoke("plan_failed", { jobId, message: `Unknown action "${actionId}".` });
      return;
    }
    try {
      // A preset action invoked from the context menu carries `menu=1` and
      // nothing else: presets are no longer registry submenus (they blew past
      // Explorer's ~16-verb-per-class ceiling), so the choice happens in a
      // window instead. CLI and `smoke` runs pass real options and skip this.
      if (fromMenuWithoutChoice(action, options)) {
        void invoke("plan_needs_options", { jobId, window: "presets" });
        return;
      }
      const plan = action.buildPlan(inputs, options);
      void invoke("plan_built", { jobId, plan });
    } catch (err) {
      if (err instanceof NeedsOptions) {
        void invoke("plan_needs_options", { jobId, window: err.window });
      } else if (err instanceof PlanError) {
        void invoke("plan_failed", { jobId, message: err.message });
      } else {
        console.error(`buildPlan(${actionId}) threw`, err);
        void invoke("plan_failed", {
          jobId,
          message: "Something went wrong preparing this action.",
        });
      }
    }
  });
  await invoke("webview_ready");
}
