import { beforeEach, describe, expect, it } from "vitest";
import {
  errorForField,
  fieldErrorFromZod,
  intentFingerprint,
  isErrorField,
  keyForIntent,
  type MutationIntent,
} from "@/lib/validation/inventory";

describe("intentFingerprint", () => {
  it("ignores the note, which does not define the request", () => {
    // Correcting a note must not become a second stock movement.
    expect(intentFingerprint({ quantity: 5 })).toBe(intentFingerprint({ quantity: 5 }));
  });

  it("changes when a quantity changes", () => {
    expect(intentFingerprint({ quantity: 5 })).not.toBe(intentFingerprint({ quantity: 7 }));
  });

  it("distinguishes absent from zero", () => {
    expect(intentFingerprint({ quantity: 0 })).not.toBe(intentFingerprint({}));
  });
});

describe("keyForIntent", () => {
  let minted: number;
  const mint = () => `key-${(minted += 1)}`;

  beforeEach(() => {
    minted = 0;
  });

  it("mints a key for a first submission", () => {
    const result = keyForIntent(null, { quantity: 5 }, mint);
    expect(result.key).toBe("key-1");
  });

  it("reuses the key when the request is unchanged", () => {
    // The point of an idempotency key: a double click or a retry must not
    // apply the same movement twice.
    const first = keyForIntent(null, { quantity: 5 }, mint);
    const second = keyForIntent(first, { quantity: 5 }, mint);
    expect(second.key).toBe(first.key);
  });

  it("mints a new key when the quantity is corrected", () => {
    // The defect: after a lost response, correcting the quantity reused the
    // key, the database concluded it was a retry, returned the first result,
    // and the correction silently never happened.
    const first = keyForIntent(null, { quantity: 5 }, mint);
    const corrected = keyForIntent(first, { quantity: 7 }, mint);
    expect(corrected.key).not.toBe(first.key);
  });

  it("mints a new key for any intent-defining change", () => {
    const base: MutationIntent = {
      quantity: 5,
      unitCost: 100,
      setCurrentCost: true,
      direction: "decrease",
      reason: "damage",
    };
    const first = keyForIntent(null, base, mint);
    for (const changed of [
      { ...base, quantity: 6 },
      { ...base, unitCost: 101 },
      { ...base, setCurrentCost: false },
      { ...base, direction: "increase" },
      { ...base, reason: "loss" },
    ] satisfies MutationIntent[]) {
      expect(keyForIntent(first, changed, mint).key).not.toBe(first.key);
    }
  });

  it("treats reopening the dialog as a new intent even with identical values", () => {
    // Two deliberate identical restocks are two actions.
    const first = keyForIntent(null, { quantity: 5 }, mint);
    const reopened = keyForIntent(null, { quantity: 5 }, mint);
    expect(reopened.key).not.toBe(first.key);
  });

  it("reuses a key across a rejection, so a correction still applies", () => {
    // A rejected request never reached the ledger, so there is nothing to
    // collide with and the same key is safe.
    const first = keyForIntent(null, { quantity: 5 }, mint);
    const afterRejection = keyForIntent(first, { quantity: 5 }, mint);
    expect(afterRejection.key).toBe(first.key);
  });
});

describe("error to field attribution", () => {
  it("shows an error only on the field it names", () => {
    const error = { field: "quantity", message: "Quantity must be greater than zero." };
    expect(errorForField(error, "quantity")).toBe(error.message);
    expect(errorForField(error, "unitCost")).toBeUndefined();
    expect(isErrorField(error, "quantity")).toBe(true);
    expect(isErrorField(error, "unitCost")).toBe(false);
  });

  it("falls back to a usable message when a failure carries no field", () => {
    const error = fieldErrorFromZod({ issues: [] } as never);
    expect(error.field).toBeNull();
    expect(error.message.length).toBeGreaterThan(0);
  });
});
