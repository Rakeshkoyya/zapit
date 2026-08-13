/**
 * Preset chooser (ADR 007).
 *
 * Presets used to be nested registry submenus, one verb each. Explorer honours
 * only ~16 static verbs per file class, and `.mp4` needed 34 — so the flyout
 * silently truncated after the fourth entry and half the app was unreachable.
 * Presets now live here: one verb per action, one extra click to choose.
 *
 * Opened only for menu-originated runs (`--opt menu=1`); the CLI and `smoke`
 * keep passing `--opt` directly and never see this window.
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { findAction } from "../../actions/registry";
import { el } from "../../ui/dom";
import "../../ui/theme.css";

const params = new URLSearchParams(window.location.search);
const jobId = params.get("job") ?? "";
const actionId = params.get("action") ?? "";
const fileName = params.get("name") ?? "";

const titleEl = document.getElementById("title");
const nameEl = document.getElementById("name");
const choicesEl = document.getElementById("choices");
const errorEl = document.getElementById("error");

const action = findAction(actionId);
const presets = action?.presets ?? [];

if (nameEl !== null) {
  nameEl.textContent = fileName;
}
if (titleEl !== null && action !== undefined) {
  // "Compress video" reads better as a title than "Choose an option".
  titleEl.textContent = action.menuLabel.replace(/[….]+$/u, "");
}

function choose(index: number): void {
  const preset = presets[index];
  if (preset === undefined) {
    return;
  }
  // `preset` is always sent, even when the preset carries no options of its own
  // ("At a time…"), so the reply is never empty — an empty reply would bounce
  // straight back to this window.
  const options: Record<string, string> = { preset: String(index) };
  for (const [key, value] of Object.entries(preset.options)) {
    options[key] = value;
  }
  void invoke("submit_options", { jobId, options }).then(() => getCurrentWindow().close());
}

if (choicesEl !== null) {
  if (presets.length === 0 && errorEl !== null) {
    errorEl.textContent = "This action has no options to choose from.";
  }
  presets.forEach((preset, index) => {
    const button = el("button", "choice");
    button.type = "button";
    button.append(
      el("span", "choice__key", String(index + 1)),
      el("span", undefined, preset.label),
    );
    button.addEventListener("click", () => {
      choose(index);
    });
    choicesEl.appendChild(button);
  });
  choicesEl.querySelector<HTMLButtonElement>(".choice")?.focus();
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    void getCurrentWindow().close();
    return;
  }
  // 1-9 pick a choice directly; past nine the number is just a position marker.
  const digit = Number(event.key);
  if (Number.isInteger(digit) && digit >= 1 && digit <= Math.min(9, presets.length)) {
    choose(digit - 1);
  }
});

document.getElementById("cancel")?.addEventListener("click", () => {
  void getCurrentWindow().close();
});
