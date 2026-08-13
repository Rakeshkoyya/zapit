/**
 * Settings window (§5.6). Four panes: the shell integration and how to reach
 * it, the per-action toggles, where results are written, and about/licences.
 *
 * Toggling an action rewrites the registry menu from the enabled set, so what
 * this window shows and what Explorer shows can never drift apart.
 */
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { menuableActions } from "../../actions/registry";
import { describeAction } from "../../actions/descriptions";
import { menuActions } from "../../ipc/bridge";
import type { QuickAction } from "../../core/action";
import { el, icon, toggle } from "../../ui/dom";
import { CATEGORY_VIEWS, extensionsFor, fileTypeSummary, matchesQuery } from "./categories";
import thirdParty from "../../../docs/THIRD_PARTY.md?raw";
import "../../ui/theme.css";

interface Config {
  v: number;
  outputPolicy: "sameFolder" | "ask" | "fixed";
  fixedDir?: string;
  disabledActions: string[];
  /** Owned by Rust (uninstall bookkeeping) — carried through untouched. */
  createdRegistryKeys?: string[];
}

interface Row {
  readonly action: QuickAction;
  readonly description: string;
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;
}

interface Group {
  readonly card: HTMLElement;
  readonly countEl: HTMLElement;
  readonly masterBtn: HTMLButtonElement;
  readonly rows: readonly Row[];
}

let config: Config = { v: 1, outputPolicy: "sameFolder", disabledActions: [] };
let installed = false;
const groups: Group[] = [];

// ---- shell -----------------------------------------------------------------

const statusEl = document.getElementById("status");
const listEl = document.getElementById("actions");
const filterEl = document.getElementById("filter") as HTMLInputElement | null;
const noMatchesEl = document.getElementById("no-matches");
const navCountEl = document.getElementById("nav-count");
const heroTitleEl = document.getElementById("hero-title");
const heroSubEl = document.getElementById("hero-sub");
const menuBtn = document.getElementById("menu-toggle") as HTMLButtonElement | null;
const fixedRowEl = document.getElementById("fixed-row");
const fixedPathEl = document.getElementById("fixed-path");

let toastTimer: number | undefined;

function toast(message: string, isError = false): void {
  if (statusEl === null) {
    return;
  }
  statusEl.textContent = message;
  statusEl.classList.toggle("toast--error", isError);
  statusEl.classList.add("toast--show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    statusEl.classList.remove("toast--show");
  }, 2600);
}

function failed(err: unknown): void {
  toast(err instanceof Error ? err.message : String(err), true);
}

for (const button of document.querySelectorAll<HTMLButtonElement>(".nav__item")) {
  button.addEventListener("click", () => {
    const target = button.dataset.pane ?? "";
    for (const other of document.querySelectorAll<HTMLButtonElement>(".nav__item")) {
      if (other === button) {
        other.setAttribute("aria-current", "page");
      } else {
        other.removeAttribute("aria-current");
      }
    }
    for (const view of document.querySelectorAll<HTMLElement>(".view")) {
      view.hidden = view.dataset.view !== target;
    }
    document.querySelector(".pane")?.scrollTo({ top: 0 });
  });
}

// ---- persistence -----------------------------------------------------------

async function persist(): Promise<void> {
  await invoke("save_config", { config });
}

/** Rewrite the registry from the current enabled set. */
async function syncMenu(): Promise<void> {
  await invoke("apply_menu", { actions: menuActions(config.disabledActions) });
}

/**
 * Saving always happens; the registry is only rewritten when the menu is
 * actually installed, so flipping switches beforehand cannot install it by
 * surprise.
 */
async function commit(): Promise<void> {
  await persist();
  if (installed) {
    await syncMenu();
  }
}

function commitAndReport(): void {
  void commit()
    .then(() => {
      toast(installed ? "Right-click menu updated." : "Saved.");
    })
    .catch(failed);
}

// ---- action list -----------------------------------------------------------

function setEnabled(id: string, enabled: boolean): void {
  config = {
    ...config,
    disabledActions: enabled
      ? config.disabledActions.filter((other) => other !== id)
      : [...new Set([...config.disabledActions, id])],
  };
}

function paintRow(row: Row): void {
  row.root.classList.toggle("action--off", !row.input.checked);
}

function buildRow(action: QuickAction): Row {
  const description = describeAction(action.id);
  const root = el("div", "action");

  const control = toggle(!config.disabledActions.includes(action.id), action.menuLabel);
  const text = el("div", "action__text");

  const name = el("div", "action__name");
  name.appendChild(el("span", undefined, action.menuLabel));
  if (action.presets !== undefined && action.presets.length > 0) {
    // Presets left the registry in ADR 007: one verb per action, and choosing
    // it opens the chooser window rather than a nested Explorer flyout.
    name.appendChild(el("span", "chip chip--accent", "asks you which"));
  }
  text.append(name, el("div", "action__desc", description));

  const files = el("div", "action__files chip-row");
  if (action.extensions.length === 0) {
    files.appendChild(el("span", "chip", "any file"));
  } else {
    for (const extension of action.extensions) {
      files.appendChild(el("span", "chip", `.${extension}`));
    }
  }
  text.appendChild(files);

  root.append(control.root, text);

  const row: Row = { action, description, root, input: control.input };
  control.input.addEventListener("change", () => {
    setEnabled(action.id, control.input.checked);
    paintRow(row);
    updateCounts();
    commitAndReport();
  });
  paintRow(row);
  return row;
}

function updateCounts(): void {
  let onTotal = 0;
  for (const group of groups) {
    const on = group.rows.filter((row) => row.input.checked).length;
    onTotal += on;
    group.countEl.textContent = `${String(on)} of ${String(group.rows.length)} on`;
    group.masterBtn.textContent = on === group.rows.length ? "Turn all off" : "Turn all on";
  }
  if (navCountEl !== null) {
    navCountEl.textContent = `${String(onTotal)}/${String(menuableActions.length)}`;
  }
}

function renderActions(): void {
  if (listEl === null) {
    return;
  }
  listEl.replaceChildren();
  groups.length = 0;

  for (const view of CATEGORY_VIEWS) {
    const inCategory = menuableActions.filter((action) => action.category === view.id);
    if (inCategory.length === 0) {
      continue;
    }

    const card = el("section", "card group");
    const head = el("div", "group__head");

    const mark = el("span", "group__icon");
    mark.appendChild(icon(view.icon));

    const headText = el("div", "group__text");
    headText.append(
      el("div", "group__name", view.label),
      el("div", "group__files", fileTypeSummary(extensionsFor(inCategory))),
    );

    const countEl = el("span", "group__count");
    const masterBtn = el("button", "btn btn--sm btn--ghost");
    masterBtn.type = "button";

    head.append(mark, headText, countEl, masterBtn);
    card.appendChild(head);

    const rows = inCategory.map(buildRow);
    for (const row of rows) {
      card.appendChild(row.root);
    }

    masterBtn.addEventListener("click", () => {
      const turnOn = rows.some((row) => !row.input.checked);
      for (const row of rows) {
        row.input.checked = turnOn;
        setEnabled(row.action.id, turnOn);
        paintRow(row);
      }
      updateCounts();
      commitAndReport();
    });

    groups.push({ card, countEl, masterBtn, rows });
    listEl.appendChild(card);
  }

  updateCounts();
}

function applyFilter(): void {
  const query = filterEl?.value ?? "";
  let anyVisible = false;
  for (const group of groups) {
    let visible = 0;
    for (const row of group.rows) {
      const show = matchesQuery(row.action, row.description, query);
      row.root.hidden = !show;
      if (show) {
        visible += 1;
      }
    }
    group.card.hidden = visible === 0;
    anyVisible = anyVisible || visible > 0;
  }
  if (noMatchesEl !== null) {
    noMatchesEl.hidden = anyVisible;
  }
}

filterEl?.addEventListener("input", applyFilter);

document.getElementById("reset-actions")?.addEventListener("click", () => {
  config = { ...config, disabledActions: [] };
  for (const group of groups) {
    for (const row of group.rows) {
      row.input.checked = true;
      paintRow(row);
    }
  }
  updateCounts();
  commitAndReport();
});

// ---- shell integration -----------------------------------------------------

function paintInstalled(): void {
  document.body.dataset.installed = installed ? "true" : "false";
  if (heroTitleEl !== null) {
    heroTitleEl.textContent = installed
      ? "Zapit is in your right-click menu"
      : "Zapit isn't in your right-click menu yet";
  }
  if (heroSubEl !== null) {
    heroSubEl.textContent = installed
      ? "Right-click a file, choose Show more options, then Zapit."
      : "Add it to start using Zapit from File Explorer.";
  }
  if (menuBtn !== null) {
    menuBtn.textContent = installed ? "Remove from menu" : "Add to menu";
    menuBtn.classList.toggle("btn--primary", !installed);
  }
}

async function refreshInstalled(): Promise<void> {
  installed = await invoke<boolean>("menu_installed");
  paintInstalled();
}

async function removeMenu(): Promise<void> {
  const extensions = [
    ...new Set(
      menuableActions.flatMap((action) =>
        action.extensions.length === 0 ? [""] : [...action.extensions],
      ),
    ),
  ];
  await invoke("remove_menu", { extensions });
}

function setMenuInstalled(wanted: boolean): void {
  if (menuBtn !== null) {
    menuBtn.disabled = true;
  }
  const work = wanted ? syncMenu() : removeMenu();
  void work
    .then(() => {
      toast(
        wanted
          ? "Added. Right-click a file and choose Show more options."
          : "Removed from the right-click menu.",
      );
    })
    .catch(failed)
    .finally(() => {
      if (menuBtn !== null) {
        menuBtn.disabled = false;
      }
      void refreshInstalled().catch(failed);
    });
}

menuBtn?.addEventListener("click", () => {
  setMenuInstalled(!installed);
});

document.getElementById("remove-menu")?.addEventListener("click", () => {
  setMenuInstalled(false);
});

// ---- output policy ---------------------------------------------------------

function paintFixedFolder(): void {
  if (fixedRowEl !== null) {
    fixedRowEl.hidden = config.outputPolicy !== "fixed";
  }
  if (fixedPathEl !== null) {
    fixedPathEl.textContent = config.fixedDir ?? "No folder chosen yet";
  }
}

for (const policy of ["sameFolder", "ask", "fixed"] as const) {
  const radio = document.getElementById(`policy-${policy}`) as HTMLInputElement | null;
  radio?.addEventListener("change", () => {
    if (!radio.checked) {
      return;
    }
    config = { ...config, outputPolicy: policy };
    paintFixedFolder();
    void persist()
      .then(() => {
        toast("Saved.");
      })
      .catch(failed);
  });
}

document.getElementById("choose-folder")?.addEventListener("click", () => {
  void open({ directory: true, multiple: false, title: "Choose where results are saved" })
    .then(async (chosen) => {
      if (typeof chosen !== "string") {
        return;
      }
      config = { ...config, fixedDir: chosen };
      paintFixedFolder();
      await persist();
      toast("Folder saved.");
    })
    .catch(failed);
});

// ---- about -----------------------------------------------------------------

document.getElementById("open-logs")?.addEventListener("click", () => {
  void invoke<string>("log_folder")
    .then(async (folder) => {
      if (folder !== "") {
        await openPath(folder);
      }
    })
    .catch(failed);
});

const licensesEl = document.getElementById("licenses");
if (licensesEl !== null) {
  licensesEl.textContent = thirdParty;
}

// ---- boot ------------------------------------------------------------------

void invoke<Config>("get_config")
  .then(async (loaded) => {
    config = { ...config, ...loaded };
    const radio = document.getElementById(
      `policy-${config.outputPolicy}`,
    ) as HTMLInputElement | null;
    if (radio !== null) {
      radio.checked = true;
    }
    paintFixedFolder();
    renderActions();
    await refreshInstalled();
  })
  .catch(() => {
    renderActions();
    paintInstalled();
  });
