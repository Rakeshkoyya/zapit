/**
 * Reorder window (P1/I5/V7/A4): shows the aggregated file list; up/down moves;
 * submits the final order as 0-based indices into the original input list.
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const params = new URLSearchParams(window.location.search);
const jobId = params.get("job") ?? "";
let names: string[] = [];
try {
  names = JSON.parse(params.get("files") ?? "[]") as string[];
} catch {
  names = [];
}

/** rows[k] = original index of the file currently shown at position k. */
const rows: number[] = names.map((_, i) => i);
const list = document.getElementById("list");

function render(): void {
  if (list === null) {
    return;
  }
  list.replaceChildren();
  rows.forEach((originalIndex, position) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = names[originalIndex] ?? "";
    const up = document.createElement("button");
    up.type = "button";
    up.textContent = "↑";
    up.disabled = position === 0;
    up.addEventListener("click", () => {
      const prev = rows[position - 1];
      const cur = rows[position];
      if (prev !== undefined && cur !== undefined) {
        rows[position - 1] = cur;
        rows[position] = prev;
        render();
      }
    });
    const down = document.createElement("button");
    down.type = "button";
    down.textContent = "↓";
    down.disabled = position === rows.length - 1;
    down.addEventListener("click", () => {
      const next = rows[position + 1];
      const cur = rows[position];
      if (next !== undefined && cur !== undefined) {
        rows[position + 1] = cur;
        rows[position] = next;
        render();
      }
    });
    li.append(name, up, down);
    list.appendChild(li);
  });
}
render();

document.getElementById("go")?.addEventListener("click", () => {
  const options: Record<string, string> = {
    ordered: "true",
    order: rows.join(","),
  };
  void invoke("submit_options", { jobId, options }).then(() => getCurrentWindow().close());
});
document.getElementById("cancel")?.addEventListener("click", () => {
  void getCurrentWindow().close();
});
