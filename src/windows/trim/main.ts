/**
 * Trim window (V6/A2): collects start/end/lossless and submits them to the
 * waiting job via `submit_options`. Closing the window cancels (Rust listens
 * for the close event).
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { parseSeconds } from "../../core/time";

const params = new URLSearchParams(window.location.search);
const jobId = params.get("job") ?? "";
const durationS = Number(params.get("duration") ?? "0");
const name = params.get("name") ?? "";

const nameEl = document.getElementById("name");
const hintEl = document.getElementById("hint");
const errorEl = document.getElementById("error");
const startEl = document.getElementById("start") as HTMLInputElement | null;
const endEl = document.getElementById("end") as HTMLInputElement | null;
const losslessEl = document.getElementById("lossless") as HTMLInputElement | null;

if (nameEl !== null) {
  nameEl.textContent = name;
}
if (hintEl !== null && durationS > 0) {
  const mins = Math.floor(durationS / 60);
  const secs = Math.round(durationS % 60);
  hintEl.textContent = `Duration: ${String(mins)}:${secs.toString().padStart(2, "0")}`;
}
if (endEl !== null && durationS > 0) {
  endEl.value = String(Math.round(durationS * 10) / 10);
}
if (startEl !== null) {
  startEl.value = "0";
}

function fail(message: string): void {
  if (errorEl !== null) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }
}

document.getElementById("go")?.addEventListener("click", () => {
  const start = parseSeconds(startEl?.value ?? "");
  const end = parseSeconds(endEl?.value ?? "");
  if (start === undefined || end === undefined) {
    fail("Times look like 90, 1:30 or 0:12.5.");
    return;
  }
  if (end <= start) {
    fail("End must be after start.");
    return;
  }
  const options: Record<string, string> = {
    start: String(start),
    end: String(end),
    lossless: losslessEl?.checked === true ? "true" : "false",
  };
  void invoke("submit_options", { jobId, options }).then(() => getCurrentWindow().close());
});

document.getElementById("cancel")?.addEventListener("click", () => {
  void getCurrentWindow().close();
});
