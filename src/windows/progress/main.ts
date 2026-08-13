/**
 * Progress window (§5.6): bar + cancel for the job named in the query string.
 * The window is created and closed by the Rust side; this script only renders.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "../../ui/theme.css";

interface ProgressEvent {
  readonly jobId: string;
  readonly percent: number;
  readonly label: string;
}

const params = new URLSearchParams(window.location.search);
const jobId = params.get("job") ?? "";
const actionId = params.get("action") ?? "";

const label = document.getElementById("label");
const bar = document.getElementById("bar") as HTMLProgressElement | null;
const percentEl = document.getElementById("percent");
const cancelBtn = document.getElementById("cancel");

/** `compress-video` → `Compress video`, for the moment before the first event. */
function prettyAction(id: string): string {
  const words = id.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

if (label !== null && actionId !== "") {
  label.textContent = `${prettyAction(actionId)}…`;
}

void listen<ProgressEvent>("job://progress", (event) => {
  if (event.payload.jobId !== jobId) {
    return;
  }
  if (bar !== null) {
    bar.value = event.payload.percent;
  }
  if (percentEl !== null) {
    percentEl.textContent = `${String(event.payload.percent)}%`;
  }
  if (label !== null && event.payload.label !== "") {
    label.textContent = event.payload.label;
  }
});

cancelBtn?.addEventListener("click", () => {
  cancelBtn.setAttribute("disabled", "true");
  void invoke("cancel_job", { jobId });
});
