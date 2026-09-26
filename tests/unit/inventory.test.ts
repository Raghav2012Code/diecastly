import { describe, expect, it } from "vitest";
import {
  adjustDelta,
  adjustSchema,
  errorForField,
  fieldErrorFromZod,
  initialStockSchema,
  isErrorField,
  restockSchema,
} from "@/lib/validation/inventory";

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

describe("error to field attribution", () => {
  const FIELDS = ["quantity", "unitCost", "setCurrentCost", "note", "direction", "reason"];

  it("attributes a quantity failure to the quantity field", () => {
    const parsed = restockSchema.safeParse({ productId: PRODUCT_ID, quantity: "", idempotencyKey: KEY });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const error = fieldErrorFromZod(parsed.error);
    expect(error.field).toBe("quantity");
    expect(errorForField(error, "quantity")).toBe(error.message);
  });

  it("attributes a cost failure to the cost field, not the quantity", () => {
    const parsed = restockSchema.safeParse({
      productId: PRODUCT_ID,
      quantity: 5,
      unitCost: "-1",
      idempotencyKey: KEY,
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const error = fieldErrorFromZod(parsed.error);
    expect(error.field).toBe("unitCost");
  });

  it("attributes a direction failure from the adjust refinement", () => {
    const parsed = adjustSchema.safeParse({
      productId: PRODUCT_ID,
      direction: "increase",
      quantity: 1,
      reason: "damage",
      idempotencyKey: KEY,
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    expect(fieldErrorFromZod(parsed.error).field).toBe("direction");
  });

  it("marks exactly one field invalid, never a second by mistake", () => {
    // The defect being fixed: one shared error string was rendered under Note
    // while aria-invalid was hard-wired to the quantity input, so a cost error
    // was announced against the wrong field.
    for (const payload of [
      { productId: PRODUCT_ID, quantity: "", idempotencyKey: KEY },
      { productId: PRODUCT_ID, quantity: 5, unitCost: "-1", idempotencyKey: KEY },
      { productId: PRODUCT_ID, quantity: 5, note: "x".repeat(600), idempotencyKey: KEY },
    ]) {
      const parsed = restockSchema.safeParse(payload);
      expect(parsed.success).toBe(false);
      if (parsed.success) continue;

      const error = fieldErrorFromZod(parsed.error);
      const marked = FIELDS.filter((field) => isErrorField(error, field));
      expect(marked).toHaveLength(1);
      expect(marked[0]).toBe(error.field);
    }
  });

  it("shows a field-less failure to no field, and still offers its message", () => {
    const error = { field: null, message: "Not enough stock available for that change." };
    for (const field of FIELDS) {
      expect(errorForField(error, field)).toBeUndefined();
      expect(isErrorField(error, field)).toBe(false);
    }
    expect(error.message).toContain("Not enough stock");
  });

  it("returns nothing when there is no error at all", () => {
    for (const field of FIELDS) {
      expect(errorForField(null, field)).toBeUndefined();
      expect(isErrorField(null, field)).toBe(false);
    }
  });
});
