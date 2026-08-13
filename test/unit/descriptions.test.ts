/**
 * The Settings window explains each action in plain English and lists the file
 * types it reacts to. These tests keep that copy honest: every menu action has
 * a description, no description points at an action that no longer exists, and
 * the file-type wording matches the extensions in the registry.
 */
import { describe, expect, test } from "vitest";
import { actions, menuableActions } from "../../src/actions/registry";
import { ACTION_DESCRIPTIONS, describeAction } from "../../src/actions/descriptions";
import {
  CATEGORY_VIEWS,
  extensionsFor,
  fileTypeSummary,
  matchesQuery,
} from "../../src/windows/settings/categories";

describe("action descriptions", () => {
  test.each(menuableActions.map((action) => action.id))("%s has a description", (id) => {
    expect(describeAction(id).length).toBeGreaterThan(10);
  });

  test("no description refers to an action that does not exist", () => {
    const known = new Set(actions.map((action) => action.id));
    const orphans = Object.keys(ACTION_DESCRIPTIONS).filter((id) => !known.has(id));
    expect(orphans).toEqual([]);
  });

  test("an unknown id degrades to an empty string rather than throwing", () => {
    expect(describeAction("not-an-action")).toBe("");
  });

  test("every menuable action sits in a category the settings list renders", () => {
    const rendered = new Set(CATEGORY_VIEWS.map((view) => view.id));
    const missing = menuableActions
      .filter((action) => !rendered.has(action.category))
      .map((action) => action.id);
    expect(missing).toEqual([]);
  });
});

describe("file-type wording", () => {
  test("de-duplicates and sorts the extensions across a category", () => {
    expect(extensionsFor([{ extensions: ["mov", "mp4"] }, { extensions: ["mp4", "avi"] }])).toEqual(
      ["avi", "mov", "mp4"],
    );
  });

  test("an action with no extensions is described as working on anything", () => {
    expect(fileTypeSummary([])).toContain("any kind of file");
  });

  test("a short list is spelled out in full", () => {
    expect(fileTypeSummary(["mp3", "wav"])).toBe("Shows up when you right-click .mp3, .wav");
  });

  test("a long list is truncated with a count of the rest", () => {
    const summary = fileTypeSummary(["a", "b", "c", "d", "e", "f", "g", "h"], 6);
    expect(summary).toContain(".a, .b, .c, .d, .e, .f");
    expect(summary).toContain("and 2 more");
  });
});

describe("search", () => {
  const trim = menuableActions.find((action) => action.id === "trim-video");
  if (trim === undefined) {
    throw new Error("trim-video is missing from the registry");
  }
  const description = describeAction("trim-video");

  test("an empty query keeps everything visible", () => {
    expect(matchesQuery(trim, description, "  ")).toBe(true);
  });

  test("matches on a file extension the user typed", () => {
    expect(matchesQuery(trim, description, "mkv")).toBe(true);
    expect(matchesQuery(trim, description, ".mkv")).toBe(true);
  });

  test("matches on words from the description, not just the label", () => {
    expect(matchesQuery(trim, "Open a preview window and cut out the parts", "preview")).toBe(true);
  });

  test("does not match an unrelated term", () => {
    expect(matchesQuery(trim, description, "spreadsheet")).toBe(false);
  });
});
