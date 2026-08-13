/**
 * Presentation data for the Settings action list: how each category is named,
 * drawn, and described in terms of the files it reacts to.
 *
 * Pure — no DOM, no IPC — so the wording rules are unit-testable.
 */
import type { ActionCategory, QuickAction } from "../../core/action";

export interface CategoryView {
  readonly id: ActionCategory;
  readonly label: string;
  /** SVG path `d` attributes, drawn stroked at 16px. */
  readonly icon: readonly string[];
}

/** Display order of the groups, mirroring the menu order in the registry. */
export const CATEGORY_VIEWS: readonly CategoryView[] = [
  {
    id: "video",
    label: "Video",
    icon: [
      "M3 6.5A2.5 2.5 0 0 1 5.5 4h7A2.5 2.5 0 0 1 15 6.5v11A2.5 2.5 0 0 1 12.5 20h-7A2.5 2.5 0 0 1 3 17.5z",
      "m15 10 5-3v10l-5-3",
    ],
  },
  {
    id: "audio",
    label: "Audio",
    icon: ["M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4"],
  },
  {
    id: "image",
    label: "Images",
    icon: [
      "M3 5.5A2.5 2.5 0 0 1 5.5 3h13A2.5 2.5 0 0 1 21 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5z",
      "m3 16 5-4 4 3 4-4 5 4",
      "M8.5 8.5h.01",
    ],
  },
  {
    id: "pdf",
    label: "PDF",
    icon: [
      "M6 2.5h7l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-18a1 1 0 0 1 1-1z",
      "M13 2.5v5h5",
      "M8.5 15h7",
    ],
  },
  {
    id: "general",
    label: "Any file",
    icon: ["M6 2.5h7l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-18a1 1 0 0 1 1-1z", "M13 2.5v5h5"],
  },
];

/** Every extension the given actions react to, de-duplicated and sorted. */
export function extensionsFor(
  actions: readonly { readonly extensions: readonly string[] }[],
): readonly string[] {
  const seen = new Set<string>();
  for (const action of actions) {
    for (const extension of action.extensions) {
      seen.add(extension);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * The one line under a group heading that answers "when does this show up?".
 * An empty extension list means the action is offered on everything.
 */
export function fileTypeSummary(extensions: readonly string[], max = 6): string {
  if (extensions.length === 0) {
    return "Shows up when you right-click any kind of file";
  }
  const shown = extensions.slice(0, max).map((e) => `.${e}`);
  const rest = extensions.length - shown.length;
  const list = rest > 0 ? `${shown.join(", ")} and ${String(rest)} more` : shown.join(", ");
  return `Shows up when you right-click ${list}`;
}

/**
 * Free-text match over what the user can actually see in a row, so searching
 * "mp3", "shrink" or "compress" all land somewhere sensible.
 */
export function matchesQuery(action: QuickAction, description: string, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (query === "") {
    return true;
  }
  const haystack = [
    action.menuLabel,
    description,
    action.id,
    ...action.extensions,
    ...action.extensions.map((e) => `.${e}`),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}
