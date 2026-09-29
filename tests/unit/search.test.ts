import { describe, expect, it } from "vitest";
import { sanitizeSearchTerm } from "@/lib/search";
import { categoryId, searchTerm, seriesName, storefrontSort } from "@/lib/store/params";

describe("sanitizeSearchTerm", () => {
  it("strips parentheses and star that would terminate the PostgREST or-group", () => {
    expect(sanitizeSearchTerm("Hot Wheels (R34)")).toBe("Hot Wheels R34");
    expect(sanitizeSearchTerm("a*b")).toBe("a b");
  });

  it("strips comma, percent, underscore and backslash", () => {
    expect(sanitizeSearchTerm("a,b%c_d\\e")).toBe("a b c d e");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeSearchTerm("  a   b  ")).toBe("a b");
  });
});

describe("store params", () => {
  it("falls back to newest for an unknown sort", () => {
    expect(storefrontSort("bogus")).toBe("newest");
    expect(storefrontSort(undefined)).toBe("newest");
  });

  it("accepts only uuid category ids", () => {
    expect(categoryId("00000000-0000-0000-0000-000000000001")).toBe(
      "00000000-0000-0000-0000-000000000001",
    );
    expect(categoryId("bogus")).toBeUndefined();
  });

  it("trims and caps the search term", () => {
    expect(searchTerm("  R34  ")).toBe("R34");
    expect(searchTerm("")).toBeUndefined();
    expect(searchTerm("x".repeat(200))?.length).toBe(120);
  });

  it("trims the series name", () => {
    expect(seriesName("  Premium  ")).toBe("Premium");
    expect(seriesName("")).toBeUndefined();
  });
});
