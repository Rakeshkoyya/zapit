import { describe, expect, it } from "vitest";
import { actions } from "../../src/actions/registry";

describe("action registry", () => {
  it("has unique, stable, kebab-case ids", () => {
    const ids = actions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("uses lowercase extensions without dots", () => {
    for (const action of actions) {
      for (const ext of action.extensions) {
        expect(ext).toMatch(/^[a-z0-9]+$/);
      }
    }
  });
});
