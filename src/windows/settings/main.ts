/**
 * Settings window (§5.6): action toggles per category, output policy, shell
 * integration, third-party licenses and a link to the log folder. Toggling an
 * action rewrites the registry menu so the two never drift apart.
 */
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { menuableActions } from "../../actions/registry";
import { menuActions } from "../../ipc/bridge";
import thirdParty from "../../../docs/THIRD_PARTY.md?raw";

interface Config {
  v: number;
  outputPolicy: "sameFolder" | "ask" | "fixed";
  fixedDir?: string;
  disabledActions: string[];
}

const CATEGORY_LABEL: Record<string, string> = {
  video: "Video",
  audio: "Audio",
  image: "Image",
  pdf: "PDF",
  general: "Any file",
};

let config: Config = {
  v: 1,
  outputPolicy: "sameFolder",
  disabledActions: [],
};

const statusEl = document.getElementById("status");
const listEl = document.getElementById("actions");
const menuBtn = document.getElementById("menu-toggle") as HTMLButtonElement | null;

function status(message: string): void {
  if (statusEl !== null) {
    statusEl.textContent = message;
  }
}

async function persist(): Promise<void> {
  await invoke("save_config", { config });
}

/** Rewrite the registry from the current enabled set. */
async function syncMenu(): Promise<void> {
  await invoke("apply_menu", { actions: menuActions(config.disabledActions) });
}

function renderActions(): void {
  if (listEl === null) {
    return;
  }
  listEl.replaceChildren();
  for (const [category, label] of Object.entries(CATEGORY_LABEL)) {
    const inCategory = menuableActions.filter((a) => a.category === category);
    if (inCategory.length === 0) {
      continue;
    }
    const heading = document.createElement("h3");
    heading.textContent = label;
    listEl.appendChild(heading);
    for (const action of inCategory) {
      const row = document.createElement("label");
      row.className = "row";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = !config.disabledActions.includes(action.id);
      box.addEventListener("change", () => {
        config.disabledActions = box.checked
          ? config.disabledActions.filter((id) => id !== action.id)
          : [...config.disabledActions, action.id];
        void persist()
          .then(syncMenu)
          .then(() => {
            status("Menu updated.");
          })
          .catch((err: unknown) => {
            status(`Couldn't update the menu: ${String(err)}`);
          });
      });
      const text = document.createElement("span");
      text.textContent = action.menuLabel;
      const tier = document.createElement("em");
      tier.textContent = action.tier;
      row.append(box, text, tier);
      listEl.appendChild(row);
    }
  }
}

async function refreshMenuButton(): Promise<void> {
  const installed = await invoke<boolean>("menu_installed");
  if (menuBtn !== null) {
    menuBtn.textContent = installed ? "Remove from right-click menu" : "Add to right-click menu";
    menuBtn.dataset.installed = installed ? "true" : "false";
  }
}

menuBtn?.addEventListener("click", () => {
  const installed = menuBtn.dataset.installed === "true";
  menuBtn.disabled = true;
  const run = installed
    ? invoke("remove_menu", {
        extensions: [
          ...new Set(
            menuableActions.flatMap((a) => (a.extensions.length === 0 ? [""] : a.extensions)),
          ),
        ],
      })
    : syncMenu();
  void run
    .then(() => {
      status(installed ? "Removed from the menu." : "Added to the menu.");
    })
    .catch((err: unknown) => {
      status(`Failed: ${String(err)}`);
    })
    .finally(() => {
      menuBtn.disabled = false;
      void refreshMenuButton();
    });
});

for (const policy of ["sameFolder", "ask", "fixed"] as const) {
  const radio = document.getElementById(`policy-${policy}`) as HTMLInputElement | null;
  radio?.addEventListener("change", () => {
    if (radio.checked) {
      config.outputPolicy = policy;
      void persist().then(() => {
        status("Output location saved.");
      });
    }
  });
}

document.getElementById("open-logs")?.addEventListener("click", () => {
  void invoke<string>("log_folder").then((folder) => {
    if (folder !== "") {
      void openPath(folder);
    }
  });
});

const licensesEl = document.getElementById("licenses");
if (licensesEl !== null) {
  licensesEl.textContent = thirdParty;
}

void invoke<Config>("get_config")
  .then((loaded) => {
    config = { ...config, ...loaded, disabledActions: loaded.disabledActions };
    const radio = document.getElementById(
      `policy-${config.outputPolicy}`,
    ) as HTMLInputElement | null;
    if (radio !== null) {
      radio.checked = true;
    }
    renderActions();
    return refreshMenuButton();
  })
  .catch(() => {
    renderActions();
  });
