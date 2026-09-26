import { describe, expect, it } from "vitest";
import { describeDbError, GENERIC_ERROR_MESSAGE } from "@/lib/db/errors";

/**
 * Every code raised by `raise exception` across supabase/migrations, as an
 * explicit literal. Kept as a literal rather than parsed from the SQL on
 * purpose: the list is the specification, a hand-maintained expectation fails
 * loudly and readably, and parsing SQL from a unit test would couple the test
 * to file layout and produce a worse failure message.
 *
 * When a migration adds a raise, add the code here. If it is missing from
 * `MESSAGES`, the test below fails.
 */
const RAISED_CODES = [
  "cod_disabled",
  "customer_name_phone_required",
  "customer_required",
  "empty_items",
  "idempotency_conflict",
  "image_not_found",
  "image_set_mismatch",
  "insufficient_stock",
  "invalid_delta",
  "invalid_discount",
  "invalid_payment",
  "invalid_payment_method",
  "invalid_quantity",
  "invalid_reason",
  "invalid_transition",
  "invalid_unit_price",
  "not_authorized",
  "nothing_to_refund",
  "order_not_found",
  "outside_reversal_window",
  "over_payment",
  "over_refund",
  "product_inactive",
  "product_not_found",
  "shipping_address_required",
  "use_cancel_order",
] as const;

describe("database error translation", () => {
  it("gives every raised code a specific, non-generic message", () => {
    const generic: string[] = [];
    for (const code of RAISED_CODES) {
      const { message } = describeDbError({ code: "P0001", message: code });
      if (message === GENERIC_ERROR_MESSAGE) generic.push(code);
    }
    expect(generic).toEqual([]);
  });

  it("names the remedy, not just the failure", () => {
    for (const code of RAISED_CODES) {
      const { message } = describeDbError({ code: "P0001", message: code });
      expect(message.length).toBeGreaterThan(10);
      expect(message.toLowerCase()).not.toBe(code.toLowerCase());
    }
  });

  it("keeps the generic fallback for genuinely unknown failures", () => {
    expect(describeDbError({ code: "XX000", message: "something else entirely" }).message).toBe(
      GENERIC_ERROR_MESSAGE,
    );
    expect(describeDbError(null).message).toBe(GENERIC_ERROR_MESSAGE);
    expect(describeDbError("a string").message).toBe(GENERIC_ERROR_MESSAGE);
  });

  it("still translates the Postgres error classes", () => {
    expect(describeDbError({ code: "42501", message: "" }).message).toBe(
      "You are not authorized to do that.",
    );
    expect(describeDbError({ code: "23503", message: "" }).message).toContain("no longer exists");
  });

  it("still maps unique-constraint violations to a field", () => {
    const result = describeDbError({
      code: "23505",
      message: "duplicate key value violates unique constraint \"products_sku_key\"",
    });
    expect(result).toEqual({ field: "sku", message: "That SKU is already in use." });
  });

  it("does not map a code that is never raised", () => {
    // Opening stock already being recorded is returned as a result flag, never
    // raised, so it must not appear in the translation table.
    const { message } = describeDbError({ code: "P0001", message: "already_initialized" });
    expect(message).toBe(GENERIC_ERROR_MESSAGE);
  });
});
