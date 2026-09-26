import { describe, expect, it } from "vitest";
import {
  INVENTORY_SCOPE_VALUES,
  MOVEMENT_SOURCE_VALUES,
  MOVEMENT_TYPE_VALUES,
  PRODUCT_SORT_VALUES,
  PRODUCT_STATUS_VALUES,
  PRODUCT_STOCK_VALUES,
  one,
  oneOf,
  oneOfWithAll,
  orderChannelParam,
  orderStatusParam,
  pageNumber,
  paymentStatusParam,
} from "@/lib/list-params";

describe("one", () => {
  it("keeps a single non-empty string", () => {
    expect(one("abc")).toBe("abc");
  });

  it("rejects empty strings, arrays and absent values", () => {
    expect(one("")).toBeUndefined();
    expect(one(undefined)).toBeUndefined();
    expect(one(["a", "b"])).toBeUndefined();
  });
});

describe("oneOf", () => {
  const allowed = ["a", "b"] as const;

  it("keeps a member", () => {
    expect(oneOf("a", allowed)).toBe("a");
  });

  it("treats an unrecognised value as absent rather than substituting", () => {
    // The defect: `?stock=bogus` was treated as anything that was not the
    // low-stock value, so it silently became "out of stock".
    expect(oneOf("bogus", allowed)).toBeUndefined();
    expect(oneOf("", allowed)).toBeUndefined();
    expect(oneOf(undefined, allowed)).toBeUndefined();
  });

  it("resolves a repeated parameter to the first occurrence", () => {
    expect(oneOf(["a", "b"], allowed)).toBe("a");
    expect(oneOf(["bogus", "a"], allowed)).toBeUndefined();
  });
});

describe("oneOfWithAll", () => {
  const allowed = ["a", "b"] as const;

  it("defaults to all", () => {
    expect(oneOfWithAll(undefined, allowed)).toBe("all");
    expect(oneOfWithAll("bogus", allowed)).toBe("all");
  });

  it("accepts an explicit all", () => {
    expect(oneOfWithAll("all", allowed)).toBe("all");
  });

  it("accepts a member", () => {
    expect(oneOfWithAll("b", allowed)).toBe("b");
  });
});

describe("pageNumber", () => {
  it("accepts a positive integer", () => {
    expect(pageNumber("3")).toBe(3);
    expect(pageNumber("1")).toBe(1);
  });

  it("falls back to page 1 for anything else", () => {
    expect(pageNumber(undefined)).toBe(1);
    expect(pageNumber("")).toBe(1);
    expect(pageNumber("abc")).toBe(1);
    expect(pageNumber("0")).toBe(1);
    expect(pageNumber("-4")).toBe(1);
    expect(pageNumber("2.7")).toBe(2);
  });
});

describe("every list filter", () => {
  const cases: Array<[string, readonly string[], (v: string) => unknown]> = [
    ["product status", PRODUCT_STATUS_VALUES, (v) => oneOfWithAll(v, PRODUCT_STATUS_VALUES)],
    ["stock", PRODUCT_STOCK_VALUES, (v) => oneOf(v, PRODUCT_STOCK_VALUES)],
    ["product sort", PRODUCT_SORT_VALUES, (v) => oneOf(v, PRODUCT_SORT_VALUES)],
    ["inventory scope", INVENTORY_SCOPE_VALUES, (v) => oneOfWithAll(v, INVENTORY_SCOPE_VALUES)],
    ["movement type", MOVEMENT_TYPE_VALUES, (v) => oneOf(v, MOVEMENT_TYPE_VALUES)],
    ["movement source", MOVEMENT_SOURCE_VALUES, (v) => oneOf(v, MOVEMENT_SOURCE_VALUES)],
    ["order status", ["pending", "completed", "cancelled"], orderStatusParam],
    ["order channel", ["in_person", "online"], orderChannelParam],
    ["payment status", ["paid", "unpaid", "partial", "refunded", "cod_pending"], paymentStatusParam],
  ];

  it.each(cases)("accepts every valid %s value", (_name, valid, parse) => {
    for (const value of valid) {
      expect(parse(value)).toBeDefined();
    }
  });

  it.each(cases)("rejects an unrecognised %s value to absent", (_name, _valid, parse) => {
    const result = parse("definitely-not-a-real-value") as string | undefined;
    expect(result === undefined || result === "all").toBe(true);
  });
});
