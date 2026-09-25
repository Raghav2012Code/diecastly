import { describe, expect, it } from "vitest";
import { normalizePhone, posLineSchema, posSaleInputSchema } from "@/lib/validation/order";

describe("posLineSchema", () => {
  const base = { productId: "11111111-1111-1111-1111-111111111111", quantity: 1 };

  it("requires a strictly positive unit price", () => {
    expect(posLineSchema.safeParse({ ...base, unitPrice: 0 }).success).toBe(false);
    expect(posLineSchema.safeParse({ ...base, unitPrice: -5 }).success).toBe(false);
    expect(posLineSchema.safeParse({ ...base, unitPrice: 1 }).success).toBe(true);
  });

  it("requires a positive integer quantity", () => {
    expect(posLineSchema.safeParse({ ...base, quantity: 0, unitPrice: 10 }).success).toBe(false);
    expect(posLineSchema.safeParse({ ...base, quantity: 1.5, unitPrice: 10 }).success).toBe(false);
  });

  it("defaults line discount to zero", () => {
    const parsed = posLineSchema.parse({ ...base, unitPrice: 10 });
    expect(parsed.lineDiscount).toBe(0);
  });
});

describe("posSaleInputSchema", () => {
  const valid = {
    items: [
      {
        productId: "11111111-1111-1111-1111-111111111111",
        quantity: 2,
        unitPrice: 250,
        lineDiscount: 0,
      },
    ],
    paymentMethod: "cash" as const,
    idempotencyKey: "sale-key-0001",
  };

  it("accepts a valid sale", () => {
    expect(posSaleInputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a zero-value line inside the sale", () => {
    const invalid = {
      ...valid,
      items: [{ ...valid.items[0], unitPrice: 0 }],
    };
    expect(posSaleInputSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an empty cart", () => {
    expect(posSaleInputSchema.safeParse({ ...valid, items: [] }).success).toBe(false);
  });
});

describe("normalizePhone", () => {
  it("normalizes Indian numbers to E.164-ish form", () => {
    expect(normalizePhone("9876543210")).toBe("+919876543210");
    expect(normalizePhone("+91 98765 43210")).toBe("+919876543210");
    expect(normalizePhone("919876543210")).toBe("+919876543210");
  });
});
