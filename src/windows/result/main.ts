/**
 * Result window (G1): shows a hash with copy-to-clipboard and a
 * paste-to-compare field verified in constant time on the Rust side.
 */
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "../../ui/theme.css";

const params = new URLSearchParams(window.location.search);
const hash = params.get("hash") ?? "";
const algorithm = params.get("algorithm") ?? "";
const name = params.get("name") ?? "";

const nameEl = document.getElementById("name");
const algoEl = document.getElementById("algorithm");
const hashEl = document.getElementById("hash");
const compareEl = document.getElementById("compare") as HTMLInputElement | null;
const verdictEl = document.getElementById("verdict");
const copyBtn = document.getElementById("copy");

if (nameEl !== null) {
  nameEl.textContent = name;
}
if (algoEl !== null) {
  algoEl.textContent = algorithm;
}
if (hashEl !== null) {
  hashEl.textContent = hash;
}

copyBtn?.addEventListener("click", () => {
  void writeText(hash).then(() => {
    copyBtn.textContent = "Copied";
    setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
  });
});

compareEl?.addEventListener("input", () => {
  const typed = compareEl.value.trim();
  if (verdictEl === null) {
    return;
  }
  if (typed === "") {
    verdictEl.textContent = "";
    verdictEl.className = "";
    return;
  }
  void invoke<boolean>("compare_hash", { a: hash, b: typed }).then((same) => {
    verdictEl.textContent = same ? "✓ Matches" : "✗ Does not match";
    verdictEl.className = same ? "ok" : "bad";
  });
});

document.getElementById("close")?.addEventListener("click", () => {
  void getCurrentWindow().close();
});
