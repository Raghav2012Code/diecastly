import { describe, expect, it } from "vitest";
import { lastPage, resolveListState } from "@/lib/list-state";

const base = { ok: true, rowCount: 0, total: 0, page: 1, pageSize: 20, hasFilters: false };

describe("resolveListState", () => {
  it("reports rows when the page has any", () => {
    expect(resolveListState({ ...base, rowCount: 5, total: 45, page: 1 })).toBe("rows");
    expect(resolveListState({ ...base, rowCount: 5, total: 45, page: 3 })).toBe("rows");
  });

  it("reports error before anything else", () => {
    expect(resolveListState({ ...base, ok: false, rowCount: 0, total: 45, page: 99 })).toBe("error");
  });

  it("distinguishes an out-of-range page from an empty collection", () => {
    // The defect: 45 products, page 3 requested after the total dropped to 40.
    // This must never render "add your first product".
    expect(resolveListState({ ...base, total: 40, page: 3 })).toBe("out-of-range");
    expect(resolveListState({ ...base, total: 45, page: 4 })).toBe("out-of-range");
    expect(resolveListState({ ...base, total: 45, page: 99 })).toBe("out-of-range");
  });

  it("treats an out-of-range page as out of range even with filters active", () => {
    // With filters the empty result is usually "no matches", but if the page
    // itself does not exist that is the more specific and more useful answer.
    expect(resolveListState({ ...base, total: 40, page: 3, hasFilters: true })).toBe("out-of-range");
  });

  it("keeps 'nothing here' and 'nothing matches' distinct", () => {
    expect(resolveListState({ ...base, total: 0, page: 1 })).toBe("empty");
    expect(resolveListState({ ...base, total: 0, page: 1, hasFilters: true })).toBe("no-matches");
  });

  it("accepts the last page that does have rows", () => {
    expect(resolveListState({ ...base, rowCount: 5, total: 45, page: 3 })).toBe("rows");
    // page 3 of 40 is the last valid page, but it has no rows because the
    // query returned none — that is an empty *result*, not an invalid page.
    expect(resolveListState({ ...base, total: 40, page: 2, rowCount: 20 })).toBe("rows");
  });

  it("never calls page 1 out of range, even for an empty collection", () => {
    expect(resolveListState({ ...base, total: 0, page: 1 })).not.toBe("out-of-range");
    expect(resolveListState({ ...base, total: 1, page: 1 })).not.toBe("out-of-range");
  });
});

describe("lastPage", () => {
  it("is at least 1", () => {
    expect(lastPage(0, 20)).toBe(1);
    expect(lastPage(45, 20)).toBe(3);
    expect(lastPage(40, 20)).toBe(2);
    expect(lastPage(41, 20)).toBe(3);
  });
});
