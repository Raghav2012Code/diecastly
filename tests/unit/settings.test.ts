import { describe, expect, it } from "vitest";
import { settingsInputSchema } from "@/lib/validation/settings";
import { MAX_MONEY } from "@/lib/validation/catalog";

/**
 * The settings form must not be able to build a row the database refuses. Every
 * bound here mirrors a CHECK on `settings` (20260925120100_catalog.sql), so these
 * tests are the client half of a constraint that also exists in SQL.
 */

const VALID = {
  businessName: "Diecastly",
  businessPhone: "+91 99999 00000",
  businessEmail: "hello@example.test",
  upiId: "diecastly@upi",
  upiQrPath: "upi/qr.png",
  orderPrefix: "DC",
  defaultShippingFee: 49,
  lowStockThresholdDefault: 2,
  onlineOrderHoldHours: 48,
  inPersonReversalWindowHours: 24,
  codEnabled: true,
};

describe("settingsInputSchema", () => {
  it("accepts a complete, valid row", () => {
    const parsed = settingsInputSchema.safeParse(VALID);
    expect(parsed.success).toBe(true);
  });

  it("applies the column defaults for every field the form leaves empty", () => {
    // orderPrefix is deliberately required, so it is supplied here; the numeric
    // defaults are not.
    const parsed = settingsInputSchema.parse({ businessName: "Diecastly", orderPrefix: "DC" });
    expect(parsed.defaultShippingFee).toBe(0);
    expect(parsed.lowStockThresholdDefault).toBe(2);
    expect(parsed.onlineOrderHoldHours).toBe(48);
    expect(parsed.inPersonReversalWindowHours).toBe(24);
    expect(parsed.codEnabled).toBe(true);
  });

  it("requires the order prefix, which the form always sends", () => {
    // The SQL column has a default, but the form marks the field required and
    // silently inventing a prefix for an admin who cleared it would be worse than
    // asking for it.
    expect(settingsInputSchema.safeParse({ businessName: "Diecastly" }).success).toBe(false);
    expect(
      settingsInputSchema.safeParse({ businessName: "Diecastly", orderPrefix: "DC" }).success,
    ).toBe(true);
  });

  it("accepts the exact payload the settings form builds", () => {
    // Every field as strings, because that is what a form's FormData produces.
    // If this fails, the settings page cannot save at all.
    const parsed = settingsInputSchema.safeParse({
      businessName: "Diecastly",
      businessPhone: "+91 99999 00000",
      businessEmail: "hello@example.test",
      upiId: "diecastly@upi",
      upiQrPath: "upi/qr.png",
      orderPrefix: "DC",
      defaultShippingFee: "49",
      lowStockThresholdDefault: "2",
      onlineOrderHoldHours: "48",
      inPersonReversalWindowHours: "24",
      codEnabled: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("yields null for an omitted optional field, never undefined", () => {
    // `undefined` is dropped by JSON.stringify, so the column would be left
    // UNCHANGED rather than cleared — a silent no-op behind an admin who was told
    // the save succeeded.
    const parsed = settingsInputSchema.parse({ businessName: "Diecastly", orderPrefix: "DC" });
    for (const field of [
      "businessPhone",
      "businessEmail",
      "upiId",
      "upiQrPath",
    ] as const) {
      expect(parsed[field], field).toBeNull();
    }
    expect(JSON.stringify(parsed)).toContain('"upiId":null');
  });

  it("requires a business name", () => {
    expect(settingsInputSchema.safeParse({ businessName: "" }).success).toBe(false);
    expect(settingsInputSchema.safeParse({}).success).toBe(false);
  });

  // The DB CHECKs are `> 0` on both hour columns, so zero must not get through.
  it("refuses a zero or negative window, matching the database CHECK", () => {
    for (const field of ["onlineOrderHoldHours", "inPersonReversalWindowHours"]) {
      expect(settingsInputSchema.safeParse({ ...VALID, [field]: 0 }).success, field).toBe(false);
      expect(settingsInputSchema.safeParse({ ...VALID, [field]: -1 }).success, field).toBe(false);
    }
  });

  it("refuses a negative shipping fee, matching the database CHECK", () => {
    expect(settingsInputSchema.safeParse({ ...VALID, defaultShippingFee: -1 }).success).toBe(false);
    expect(settingsInputSchema.safeParse({ ...VALID, defaultShippingFee: 0 }).success).toBe(true);
  });

  it("refuses a shipping fee beyond numeric(12,2)", () => {
    expect(settingsInputSchema.safeParse({ ...VALID, defaultShippingFee: MAX_MONEY }).success).toBe(true);
    expect(
      settingsInputSchema.safeParse({ ...VALID, defaultShippingFee: MAX_MONEY + 1 }).success,
    ).toBe(false);
  });

  it("refuses a fractional count of hours or a fractional threshold", () => {
    expect(settingsInputSchema.safeParse({ ...VALID, onlineOrderHoldHours: 1.5 }).success).toBe(false);
    expect(
      settingsInputSchema.safeParse({ ...VALID, lowStockThresholdDefault: 2.5 }).success,
    ).toBe(false);
  });

  it("uppercases the order prefix, so numbering is consistent", () => {
    expect(settingsInputSchema.parse({ ...VALID, orderPrefix: "dc" }).orderPrefix).toBe("DC");
  });

  it("rejects a malformed email but allows it to be omitted", () => {
    expect(settingsInputSchema.safeParse({ ...VALID, businessEmail: "nope" }).success).toBe(false);
    expect(settingsInputSchema.safeParse({ ...VALID, businessEmail: "" }).success).toBe(true);
  });

  it("treats blank optional text as null rather than an empty string", () => {
    const parsed = settingsInputSchema.parse({ ...VALID, upiId: "   ", businessPhone: "" });
    expect(parsed.upiId).toBeNull();
    expect(parsed.businessPhone).toBeNull();
  });

  it("coerces form strings, because every field arrives as text", () => {
    // A number input's value is a string; without coercion every save would fail.
    const parsed = settingsInputSchema.safeParse({
      ...VALID,
      defaultShippingFee: "49.50",
      onlineOrderHoldHours: "72",
      codEnabled: false,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.defaultShippingFee).toBe(49.5);
      expect(parsed.data.onlineOrderHoldHours).toBe(72);
      expect(parsed.data.codEnabled).toBe(false);
    }
  });

  it("refuses a non-numeric number in a number field", () => {
    expect(settingsInputSchema.safeParse({ ...VALID, defaultShippingFee: "free" }).success).toBe(
      false,
    );
  });
});
