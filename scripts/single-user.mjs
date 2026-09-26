#!/usr/bin/env node
/**
 * Applies the Supabase shim and every migration using `postgres --single`, then
 * runs a plain-SQL assertion file — all without a client connection.
 *
 * WHY THIS EXISTS
 *
 * On the Windows host this was written for, PostgreSQL's postmaster starts and
 * listens normally, but every *forked backend* dies with
 * STATUS_DLL_INIT_FAILED (0xC0000142), so no client can ever connect:
 *
 *   LOG:  client backend (PID 19216) was terminated by exception 0xC0000142
 *
 * Ruled out: missing MSVC runtime, autovacuum, shared_memory_type, PATH, and
 * the absence of an admin account (which blocks the Windows-service route that
 * would otherwise be the fix). Windows Defender is active and is the remaining
 * suspect, but it cannot be disabled without elevation.
 *
 * `postgres --single` runs the backend *inside* the postmaster process, so it
 * needs no fork and works. That makes migration application verifiable on a
 * host where nothing else can connect. It is a fallback, not a replacement for
 * `npm run test:db`, which exercises the suite over a real connection and is
 * what the gate uses.
 *
 * LIMITATIONS — read before trusting a green result here:
 *   * single-user mode cannot CREATE DATABASE, so there is no scratch database;
 *     it runs against one database that it resets first.
 *   * it has no pgTAP, so it cannot run supabase/tests/*.sql. It verifies that
 *     the schema applies and that plain-SQL assertions hold, nothing more.
 *   * anything relying on multiple sessions is out of scope.
 *
 * Usage:
 *   node scripts/single-user.mjs                  # shim + all migrations
 *   node scripts/single-user.mjs --assertions=path # then run a SQL file
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flatten, UnsupportedSql } from "./sql-split.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const SHIM = join(ROOT, "scripts", "supabase-shim.sql");

const DATA = process.env.PGDATA ?? "F:/Temp/opencode/pg/data";
const POSTGRES =
  process.env.POSTGRES_BIN ?? "F:/Temp/opencode/pg/pgsql/bin/postgres.exe";
const DB = process.env.PGDATABASE ?? "postgres";
const SKIP = (process.env.SKIP_MIGRATIONS ?? "20260925120800_enable_pgtap.sql").split(",");

function single(sql, label) {
  // --single needs one statement per line; see sql-split.mjs for why this is not
  // just a whitespace collapse.
  let flat;
  try {
    flat = flatten(sql);
  } catch (error) {
    if (error instanceof UnsupportedSql) {
      console.error(`\n  FAIL  ${label}\n        cannot run in single-user mode: ${error.message}`);
      return { ok: false, out: "" };
    }
    throw error;
  }
  const result = spawnSync(POSTGRES, ["--single", "-D", DATA, DB], {
    input: flat,
    encoding: "utf8",
    env: { ...process.env, PGCLIENTENCODING: "UTF8" },
  });
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const errored =
    result.status !== 0 ||
    /\bERROR:/.test(out) ||
    /\bFATAL:/.test(out) ||
    /was terminated by exception/.test(out);
  if (errored) {
    console.error(`\n  FAIL  ${label}`);
    const lines = out
      .split("\n")
      .filter((l) => /ERROR|FATAL|HINT|DETAIL|terminated by exception/.test(l))
      .slice(0, 8);
    for (const line of lines) console.error(`        ${line.trim()}`);
  }
  return { ok: !errored, out };
}

if (!existsSync(POSTGRES)) {
  console.error(`\n  FATAL: postgres binary not found at ${POSTGRES}`);
  console.error("  Set POSTGRES_BIN, or see AGENTS.md for how this host is set up.");
  process.exit(1);
}
if (!existsSync(DATA)) {
  console.error(`\n  FATAL: no data directory at ${DATA} (set PGDATA)`);
  process.exit(1);
}

console.log(`  single-user mode: ${POSTGRES}\n  data dir: ${DATA}\n`);

/** 1. Reset, so the run starts from nothing. Single-user cannot drop a database. */
const reset = single(
  "drop schema if exists public cascade;\ndrop schema if exists extensions cascade;\ncreate schema public;\ngrant all on schema public to public;\n",
  "reset public schema",
);
if (!reset.ok) {
  console.error("\n  could not reset; is a server running against this data dir?\n");
  process.exit(1);
}

/** 2. The Supabase shim. */
if (!single(readFileSync(SHIM, "utf8"), "supabase-shim.sql").ok) process.exit(1);
console.log("  applied scripts/supabase-shim.sql");

/** 3. Migrations in filename order, exactly as production would apply them. */
const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql") && !SKIP.some((s) => f.includes(s.trim())))
  .sort();

let failed = null;
for (const file of files) {
  const result = single(readFileSync(join(MIGRATIONS, file), "utf8"), file);
  if (!result.ok) {
    failed = file;
    break;
  }
  console.log(`  applied ${file}`);
}

if (failed) {
  console.error(`\n  MIGRATION FAILED: ${failed}\n`);
  process.exit(1);
}
console.log(`\n  all ${files.length} migrations applied (skipped: ${SKIP.join(", ")})\n`);

/** 4. Optional plain-SQL assertions. */
const assertionArg = process.argv.find((a) => a.startsWith("--assertions="));
if (assertionArg) {
  const file = assertionArg.slice("--assertions=".length);
  const result = single(readFileSync(file, "utf8"), file);
  if (!result.ok) {
    console.error("\n  ASSERTIONS FAILED\n");
    process.exit(1);
  }
  const outs = result.out.match(/^.*ALL ASSERTIONS PASSED.*$/gm) ?? [];
  for (const line of outs) console.log(`  ${line}`);
  console.log(`\n  assertions passed (${outs.length})\n`);
} else {
  console.log("  schema verified. Pass --assertions=<file.sql> to check behaviour.\n");
}
