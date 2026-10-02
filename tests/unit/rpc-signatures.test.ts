import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Pins every wrapper in `lib/db/rpc.ts` to the SQL it calls.
 *
 * The failure mode this exists for: PostgREST does not resolve named arguments
 * against the function signature the way a direct call does. A wrapper that
 * passes `p_amount` to a function whose parameter was renamed `p_value` is not a
 * type error — TypeScript is satisfied, the build is green, and the call fails
 * at runtime, in production, on whichever code path is used least. Nothing else
 * in the suite would catch it, because the Zod schemas validate the *camelCase*
 * input and never see the `p_` names.
 *
 * So the contract is checked against the SQL itself rather than against a
 * hand-written list, which is what makes it survive a migration: rename a
 * parameter in a migration and this fails on the next `npm test`.
 *
 * The comparison is deliberately on the SQL side only. Asserting the SQL grants
 * too would be a nice second layer, but the grant rules are already asserted in
 * SQL by `supabase/tests/`, and duplicating them here would give one rule two
 * places to drift.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS_DIR = join(ROOT, "supabase/migrations");
const RPC_TS = join(ROOT, "src/lib/db/rpc.ts");

type SqlFunction = { params: string[]; required: string[]; file: string };

/**
 * `create or replace function public.<name>(<params>) returns ...`
 *
 * The argument list is terminated by `returns` rather than by the first `)`,
 * because a parameter can be declared `numeric(12, 2)` and a naive paren match
 * stops inside the type. Non-greedy up to `)\s*returns` skips those correctly.
 */
const FN_PATTERN =
  /create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(([\s\S]*?)\)\s*returns/gi;

/** `client.rpc("<name>", { p_a: ..., p_b: ... })` — object bodies hold no nested braces. */
const CALL_PATTERN = /client\.rpc\(\s*"(\w+)"\s*,\s*\{([^}]*)\}\s*\)/g;

function parseSqlFunctions(): Map<string, SqlFunction> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  // Later migrations redefine earlier functions — record_payment, cancel_order
  // and several others are replaced to tighten their guards. The LAST definition
  // wins, matching what the database actually holds, so this must not
  // first-write-wins.
  const found = new Map<string, SqlFunction>();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const match of sql.matchAll(FN_PATTERN)) {
      const [, name, rawParams] = match;
      const params: string[] = [];
      const required: string[] = [];

      for (const part of rawParams.split(",")) {
        const trimmed = part.trim();
        if (trimmed.length === 0) continue;
        const paramName = trimmed.split(/\s+/)[0];
        params.push(paramName);
        // No DEFAULT means PostgREST requires it to be supplied.
        if (!/\bdefault\b/i.test(trimmed)) required.push(paramName);
      }

      found.set(name, { params, required, file });
    }
  }

  return found;
}

function parseWrappers(): Map<string, string[]> {
  const source = readFileSync(RPC_TS, "utf8");
  const found = new Map<string, string[]>();

  for (const match of source.matchAll(CALL_PATTERN)) {
    const [, name, body] = match;
    const args = [...body.matchAll(/\b(p_\w+)\s*:/g)].map((arg) => arg[1]);
    found.set(name, args);
  }

  return found;
}

const sqlFunctions = parseSqlFunctions();
const wrappers = parseWrappers();

describe("rpc wrappers match the SQL they call", () => {
  it("finds the migrations and the wrappers at all", () => {
    // The control for the parsers, not for the contract. Without it an empty
    // scan would make every assertion below vacuously true, which is exactly
    // the shape of a test that can never fail.
    expect(sqlFunctions.size).toBeGreaterThan(20);
    expect(wrappers.size).toBeGreaterThan(10);
  });

  it("parses the arguments the way it claims to", () => {
    // If FN_PATTERN stopped matching parameter lists, or CALL_PATTERN stopped
    // matching `p_` keys, the assertions below would pass on empty input. This
    // pins two known shapes rather than a count.
    const recordPayment = sqlFunctions.get("record_payment");
    expect(recordPayment?.params).toEqual(["p_order_id", "p_amount", "p_method", "p_reference", "p_idempotency_key"]);

    // `p_alt_text text default null` must land in `params` and NOT in `required`,
    // because it is optional at the PostgREST boundary.
    const addImage = sqlFunctions.get("add_product_image");
    expect(addImage?.params).toEqual(["p_product_id", "p_storage_path", "p_alt_text"]);
    expect(addImage?.required).toEqual(["p_product_id", "p_storage_path"]);
  });

  it("declares every wrapped RPC name in the migrations", () => {
    const missing = [...wrappers.keys()].filter((name) => !sqlFunctions.has(name)).sort();
    expect(missing).toEqual([]);
  });

  it("passes only parameters the SQL function actually declares", () => {
    const problems: string[] = [];

    for (const [name, args] of wrappers) {
      const sql = sqlFunctions.get(name);
      if (!sql) continue;
      for (const arg of args) {
        if (!sql.params.includes(arg)) {
          problems.push(`${name}: ${arg} is not a parameter (SQL has ${sql.params.join(", ")})`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it("supplies every parameter the SQL requires", () => {
    const problems: string[] = [];

    for (const [name, args] of wrappers) {
      const sql = sqlFunctions.get(name);
      if (!sql) continue;
      for (const required of sql.required) {
        if (!args.includes(required)) {
          problems.push(`${name}: required parameter ${required} is never passed`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it("uses the latest definition of a redefined function", () => {
    // record_payment is redefined by payment_guards.sql after its first
    // definition in functions_orders.sql. Reading only the earliest definition
    // would let a later signature change pass unnoticed, which is the drift
    // that makes a signature test quietly worthless.
    expect(sqlFunctions.get("record_payment")?.file).toBe("20260926120600_payment_guards.sql");
  });
});
