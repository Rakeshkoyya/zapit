import { startPlanService } from "./ipc/bridge";
import { actions } from "./actions/registry";
import { strings } from "./core/strings";

/**
 * Hidden main window entry: its only runtime job is answering plan://request
 * events from the Rust dispatcher (§2). Real UI lives in the job windows.
 */
void startPlanService().then(() => {
  console.info(`${strings.appName} engine ready — ${String(actions.length)} actions registered`);
});
