import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describeDbError, GENERIC_ERROR_MESSAGE } from "@/lib/db/errors";

/**
 * Every code the migrations actually raise, read from the SQL.
 *
 * The companion test in `errors.test.ts` holds a hand-maintained `RAISED_CODES`
 * literal, which is a specification someone has to remember to update — the gap
 * that let `invalid_payment_method` ship shadowed by `invalid_payment` for so
 * long. This file closes the human step: if a migration raises a token with no
 * friendly message, the build fails here rather than an admin meeting
 * "Something went wrong".
 *
 * The literal list stays, deliberately, and is now pinned *against* this one.
 * Keeping both means a new code must be added in two places, so the omission is
 * caught rather than made easy — one list parsed from disk could silently drift
 * from `MESSAGES` if the parser stopped matching the SQL syntax.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");

/**
 * `raise exception '<token>' using errcode = '...'`
 *
 * Also matches the multi-line form some migrations use, and deliberately does
 * NOT match `raise exception using ...` or a `format(...)`-built message: those
 * carry no literal token, so there is nothing to translate. `ignoreCase` would
 * be wrong here — the token IS the message Postgres surfaces.
 */
const RAISE_PATTERN = /raise\s+exception\s+'([a-z0-9_]+)'\s+using\s+errcode/gi;

function raisedCodesIn(sql: string): string[] {
  const found: string[] = [];
  for (const match of sql.matchAll(RAISE_PATTERN)) found.push(match[1]);
  return found;
}

const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const raised = new Map<string, string[]>();
for (const name of migrations) {
  for (const code of raisedCodesIn(readFileSync(join(MIGRATIONS_DIR, name), "utf8"))) {
    raised.set(code, [...(raised.get(code) ?? []), name]);
  }
}

describe("raised codes are translated", () => {
  it("finds the migrations at all", () => {
    // A path change would otherwise make every assertion below vacuous, because
    // an empty scan passes "no code is unmapped". This is the control for the
    // parser, not for the translator.
    expect(migrations.length).toBeGreaterThan(10);
    expect(raised.size).toBeGreaterThan(20);
  });

  it("parses the codes the SQL suite pins, so the parser is not quietly wrong", () => {
    // If the regex stopped matching — a syntax change in a migration, a stray
    // newline — the scan would return a subset and the test above would still
    // pass on a smaller set. This asserts a specific code is found in a
    // specific file.
    expect(raised.get("invalid_payment_method")).toContain("20260926120000_money_trust_boundary.sql");
    expect(raised.get("over_payment")).toContain("20260926120100_cap_recorded_payments.sql");
    expect(raised.get("image_set_mismatch")).toContain(
      "20260926120300_image_ordering_atomicity.sql",
    );
    expect(raised.get("over_payment")).toContain("20260926120600_payment_guards.sql");
  });

  it("gives every code the migrations raise a specific, non-generic message", () => {
    const unmapped: string[] = [];
    for (const code of raised.keys()) {
      const { message } = describeDbError({ code: "P0001", message: code });
      if (message === GENERIC_ERROR_MESSAGE) unmapped.push(code);
    }
    expect(unmapped).toEqual([]);
  });

  it("reports which migration raised an unmapped code, so the fix is findable", () => {
    // The same assertion, but a failure names the file rather than only the
    // token. Cheap, and it is the difference between a two-second fix and a
    // grep across twenty migrations.
    const unmapped: string[] = [];
    for (const [code, files] of raised) {
      if (describeDbError({ code: "P0001", message: code }).message === GENERIC_ERROR_MESSAGE) {
        unmapped.push(`${code} (${[...new Set(files)].join(", ")})`);
      }
    }
    expect(unmapped).toEqual([]);
  });

  it("translates a code found only in SQL the literal list might not carry", () => {
    // The specific regression this replaces: `invalid_payment_method` raised in
    // a migration, mapped in errors.ts, and shadowed in the lookup by the prefix
    // `invalid_payment`. Reading the SQL means a code that was added to a
    // migration and to the translator is covered even if nobody remembered the
    // literal list.
    expect(describeDbError({ code: "22023", message: "invalid_payment_method" }).message).toBe(
      "Choose a valid payment method.",
    );
  });
});
