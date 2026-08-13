/**
 * Generic one-input Prompt window (§5.6) used by I2 (resize spec), I3/P3
 * (target KB), P2 (page ranges) and P6 (passwords). The page's meta tags
 * configure label, option key, placeholder, presets, masking and an optional
 * confirm field; value validation lives in buildPlan (single source of truth).
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "../../ui/theme.css";
import "../../ui/prompt.css";

const params = new URLSearchParams(window.location.search);
const jobId = params.get("job") ?? "";
const name = params.get("name") ?? "";

const meta = (key: string): string =>
  document.querySelector(`meta[name="prompt-${key}"]`)?.getAttribute("content") ?? "";

const optionKey = meta("option");
const nameEl = document.getElementById("name");
const labelEl = document.getElementById("label");
const inputEl = document.getElementById("value") as HTMLInputElement | null;
const confirmEl = document.getElementById("confirm") as HTMLInputElement | null;
const errorEl = document.getElementById("error");
const presetsEl = document.getElementById("presets");

if (nameEl !== null) {
  nameEl.textContent = name;
}
if (labelEl !== null) {
  labelEl.textContent = meta("label");
}
if (inputEl !== null) {
  inputEl.placeholder = meta("placeholder");
  if (meta("type") === "password") {
    inputEl.type = "password";
  }
  inputEl.focus();
}
if (confirmEl !== null && meta("type") === "password") {
  confirmEl.type = "password";
}
for (const preset of meta("presets")
  .split(",")
  .filter((p) => p !== "")) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = preset;
  button.addEventListener("click", () => {
    if (inputEl !== null) {
      inputEl.value = preset;
    }
  });
  presetsEl?.appendChild(button);
}

function submit(): void {
  const value = inputEl?.value.trim() ?? "";
  if (value === "") {
    return;
  }
  if (meta("confirm") === "true" && confirmEl !== null && confirmEl.value.trim() !== value) {
    if (errorEl !== null) {
      errorEl.textContent = "The two passwords don't match.";
    }
    return;
  }
  const options: Record<string, string> = { [optionKey]: value };
  void invoke("submit_options", { jobId, options }).then(() => getCurrentWindow().close());
}

document.getElementById("go")?.addEventListener("click", submit);
for (const field of [inputEl, confirmEl]) {
  field?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      submit();
    }
  });
}
document.getElementById("cancel")?.addEventListener("click", () => {
  void getCurrentWindow().close();
});
