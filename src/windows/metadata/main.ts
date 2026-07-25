/**
 * Metadata window (I6): reads EXIF for the file itself, highlights GPS rows,
 * and either closes (keep) or submits `strip=true` (remove).
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface ExifEntry {
  readonly tag: string;
  readonly value: string;
  readonly sensitive: boolean;
}

const params = new URLSearchParams(window.location.search);
const jobId = params.get("job") ?? "";
const path = params.get("path") ?? "";
const name = params.get("name") ?? "";

const nameEl = document.getElementById("name");
const bodyEl = document.getElementById("rows");
const emptyEl = document.getElementById("empty");

if (nameEl !== null) {
  nameEl.textContent = name;
}

void invoke<ExifEntry[]>("read_exif", { path })
  .then((entries) => {
    if (entries.length === 0) {
      if (emptyEl !== null) {
        emptyEl.hidden = false;
      }
      return;
    }
    for (const entry of entries) {
      const row = document.createElement("tr");
      const tag = document.createElement("td");
      tag.textContent = entry.tag;
      const value = document.createElement("td");
      value.textContent = entry.value;
      if (entry.sensitive) {
        row.className = "sensitive";
      }
      row.append(tag, value);
      bodyEl?.appendChild(row);
    }
  })
  .catch(() => {
    if (emptyEl !== null) {
      emptyEl.textContent = "Couldn't read metadata from this file.";
      emptyEl.hidden = false;
    }
  });

document.getElementById("strip")?.addEventListener("click", () => {
  void invoke("submit_options", { jobId, options: { strip: "true" } }).then(() =>
    getCurrentWindow().close(),
  );
});
document.getElementById("close")?.addEventListener("click", () => {
  void getCurrentWindow().close();
});
