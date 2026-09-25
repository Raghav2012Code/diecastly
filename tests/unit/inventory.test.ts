import { describe, expect, it } from "vitest";
import { adjustDelta, adjustSchema, initialStockSchema, restockSchema } from "@/lib/validation/inventory";

const PRODUCT_ID = "10000000-0000-0000-0000-000000000001";
const KEY = "req-1234567890";

describe("initial stock", () => {
  it("accepts a positive whole quantity", () => {
    expect(initialStockSchema.parse({ productId: PRODUCT_ID, quantity: 4 }).quantity).toBe(4);
  });

  it("rejects zero or negative quantities", () => {
    expect(() => initialStockSchema.parse({ productId: PRODUCT_ID, quantity: 0 })).toThrow();
    expect(() => initialStockSchema.parse({ productId: PRODUCT_ID, quantity: -1 })).toThrow();
  });
});

describe("restock", () => {
  it("accepts a positive quantity and defaults the cost flags", () => {
    const parsed = restockSchema.parse({ productId: PRODUCT_ID, quantity: 10, idempotencyKey: KEY });
    expect(parsed.quantity).toBe(10);
    expect(parsed.unitCost).toBeNull();
    expect(parsed.setCurrentCost).toBe(false);
    expect(parsed.note).toBeNull();
  });

  it("rejects zero, negative and fractional quantities", () => {
    expect(() => restockSchema.parse({ productId: PRODUCT_ID, quantity: 0, idempotencyKey: KEY })).toThrow();
    expect(() => restockSchema.parse({ productId: PRODUCT_ID, quantity: -2, idempotencyKey: KEY })).toThrow();
    expect(() => restockSchema.parse({ productId: PRODUCT_ID, quantity: 1.5, idempotencyKey: KEY })).toThrow();
  });

  it("rejects a negative unit cost and requires an idempotency key", () => {
    expect(() =>
      restockSchema.parse({ productId: PRODUCT_ID, quantity: 1, unitCost: -5, idempotencyKey: KEY }),
    ).toThrow();
    expect(() => restockSchema.parse({ productId: PRODUCT_ID, quantity: 1, idempotencyKey: "short" })).toThrow();
  });
});

describe("adjustment", () => {
  it("produces a signed delta from direction and quantity", () => {
    expect(adjustDelta({ direction: "increase", quantity: 3 })).toBe(3);
    expect(adjustDelta({ direction: "decrease", quantity: 3 })).toBe(-3);
  });

  it("accepts a damage decrease and a return increase", () => {
    expect(
      adjustSchema.parse({
        productId: PRODUCT_ID,
        direction: "decrease",
        quantity: 2,
        reason: "damage",
        idempotencyKey: KEY,
      }).reason,
    ).toBe("damage");
    expect(
      adjustSchema.parse({
        productId: PRODUCT_ID,
        direction: "increase",
        quantity: 2,
        reason: "return",
        idempotencyKey: KEY,
      }).reason,
    ).toBe("return");
  });

  it("rejects an increase for damage or loss", () => {
    expect(() =>
      adjustSchema.parse({
        productId: PRODUCT_ID,
        direction: "increase",
        quantity: 1,
        reason: "loss",
        idempotencyKey: KEY,
      }),
    ).toThrow();
  });

  it("rejects a decrease for a return", () => {
    expect(() =>
      adjustSchema.parse({
        productId: PRODUCT_ID,
        direction: "decrease",
        quantity: 1,
        reason: "return",
        idempotencyKey: KEY,
      }),
    ).toThrow();
  });

  it("rejects an unknown reason", () => {
    expect(() =>
      adjustSchema.parse({
        productId: PRODUCT_ID,
        direction: "decrease",
        quantity: 1,
        reason: "shrinkage",
        idempotencyKey: KEY,
      }),
    ).toThrow();
  });
});
