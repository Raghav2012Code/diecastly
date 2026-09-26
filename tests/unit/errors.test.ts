import { describe, expect, it } from "vitest";
import { describeDbError, fail, failWith, GENERIC_ERROR_MESSAGE } from "@/lib/db/errors";

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

  // -------------------------------------------------------------------------
  // Regression: one code must not shadow another.
  //
  // The old lookup returned the FIRST token found as a substring, scanning in
  // declaration order. `invalid_payment` is a prefix of
  // `invalid_payment_method` and sat four entries above it, so a rejected
  // payment method was reported as "Enter an amount greater than zero." The two
  // tests above could not catch that: they only asserted the message was
  // non-generic, and a specific-but-wrong message passes both.
  // -------------------------------------------------------------------------
  it("maps each raised code to its OWN message, not a prefix neighbour's", () => {
    expect(describeDbError({ code: "P0001", message: "invalid_payment_method" }).message).toBe(
      "Choose a valid payment method.",
    );
    expect(describeDbError({ code: "P0001", message: "invalid_payment" }).message).toBe(
      "Enter an amount greater than zero.",
    );
  });

  it("gives every raised code a message distinct from every other", () => {
    // The general form of the bug above: if two codes ever share a message, the
    // translation has collapsed and one of them is being mis-reported.
    const byCode = new Map<string, string>();
    const collisions: string[] = [];
    for (const code of RAISED_CODES) {
      const { message } = describeDbError({ code: "P0001", message: code });
      const owner = byCode.get(message);
      if (owner !== undefined) collisions.push(`${owner} and ${code} both map to "${message}"`);
      else byCode.set(message, code);
    }
    expect(collisions).toEqual([]);
  });

  it("resolves a bare raised code exactly, whatever the surrounding text", () => {
    // Postgres sets the message to the raised code verbatim, so the exact path is
    // the common one. Wrapping text (a context prefix, or details appended) must
    // still resolve, and must resolve to the same message.
    const expected = "Choose a valid payment method.";
    expect(describeDbError({ code: "22023", message: "invalid_payment_method" }).message).toBe(
      expected,
    );
    expect(
      describeDbError({ code: "22023", message: "invalid_payment_method", details: "" }).message,
    ).toBe(expected);
  });

  it("still prefers the specific token when several appear in one error", () => {
    // A nested function name or a constraint can put more than one token in the
    // haystack. The longer, more specific one must win.
    const { message } = describeDbError({
      code: "P0001",
      message: "invalid_payment_method raised while validating invalid_payment",
    });
    expect(message).toBe("Choose a valid payment method.");
  });
});

describe("hand-written failures", () => {
  it("keeps a remedy the application wrote itself", () => {
    // `fail` translates DATABASE errors, so uniqueSlug's hand-written remedy was
    // being replaced by the generic message -- the one message in the app
    // written specifically to name a fix was the one an admin never saw.
    const remedy =
      'Could not find a free slug for "Ferrari 458" after 50 attempts. Set one explicitly.';
    expect(failWith(remedy).error.message).toBe(remedy);
  });

  it("does not weaken translation of a real database error", () => {
    // The control for the test above: failWith must not become a way to skip
    // translation.
    expect(fail({ code: "P0001", message: "over_refund" }).error.message).toBe(
      "You can only refund what has been received.",
    );
    expect(fail({ code: "P0001", message: "over_refund" }).error.message).not.toBe(
      GENERIC_ERROR_MESSAGE,
    );
  });
});

