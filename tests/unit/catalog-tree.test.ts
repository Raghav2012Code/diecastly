import { describe, expect, it } from "vitest";
import { forbiddenParentIds, type CategoryNode } from "@/lib/catalog/tree";

const node = (id: string, parent_id: string | null): CategoryNode => ({ id, parent_id });

describe("forbiddenParentIds", () => {
  const flat = [node("hot-wheels", null), node("mainline", "hot-wheels"), node("premium", "hot-wheels")];

  it("always forbids the category itself", () => {
    expect(forbiddenParentIds(flat, "mainline").has("mainline")).toBe(true);
  });

  it("forbids nothing else for a leaf", () => {
    const forbidden = forbiddenParentIds(flat, "mainline");
    expect(forbidden.has("hot-wheels")).toBe(false);
    expect(forbidden.has("premium")).toBe(false);
  });

  it("forbids every descendant, not just the category itself", () => {
    // The defect: only the category itself was excluded, so A's parent could be
    // set to B while B's parent was A, and the cycle saved cleanly.
    const tree = [
      node("a", null),
      node("b", "a"),
      node("c", "b"),
      node("d", "c"),
      node("other", null),
    ];
    const forbidden = forbiddenParentIds(tree, "a");
    expect([...forbidden].sort()).toEqual(["a", "b", "c", "d"]);
    expect(forbidden.has("other")).toBe(false);
  });

  it("excludes no valid parent when the category is a root", () => {
    const tree = [node("a", null), node("b", "a")];
    const forbidden = forbiddenParentIds(tree, "b");
    expect(forbidden.has("a")).toBe(false);
  });

  it("terminates on data that already contains a cycle", () => {
    // Defensive: a node is only expanded the first time it is reached, so a
    // pre-existing loop cannot hang the editor.
    const cyclic = [node("a", "b"), node("b", "a")];
    expect(() => forbiddenParentIds(cyclic, "a")).not.toThrow();
    expect(forbiddenParentIds(cyclic, "a").size).toBe(2);
  });

  it("handles a single category and an empty list", () => {
    expect(forbiddenParentIds([], "a").has("a")).toBe(true);
    expect([...forbiddenParentIds([node("solo", null)], "solo")]).toEqual(["solo"]);
  });

  it("always includes the category even when it has no parent row", () => {
    expect(forbiddenParentIds([node("ghost", null)], "ghost").has("ghost")).toBe(true);
  });
});
