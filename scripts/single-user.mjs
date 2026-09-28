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
 *   * there is no real pgTAP here. `--tap=dir` runs supabase/tests/*.sql against
 *     scripts/pgtap-shim.sql, a plain-SQL stand-in for the six functions those
 *     files use. That proves the assertions execute and the SQL behaves as they
 *     assert; it is not pgTAP and does not replace `npm run test:db`. A green run
 *     here must be reported as "under the shim", never as "the suite passed".
 *   * anything relying on multiple sessions is out of scope.
 *
 * Usage:
 *   node scripts/single-user.mjs                  # shim + all migrations
 *   node scripts/single-user.mjs --assertions=path # then run a plain-SQL file
 *   node scripts/single-user.mjs --tap=dir         # then run every .sql in dir
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flatten, UnsupportedSql } from "./sql-split.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const SHIM = join(ROOT, "scripts", "supabase-shim.sql");
const PGTAP_SHIM = join(ROOT, "scripts", "pgtap-shim.sql");

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

/**
 * 1. Reset, so the run starts from nothing. Single-user cannot drop a database.
 *
 * `auth` and `storage` are dropped too, not just `public`. They are recreated by
 * scripts/supabase-shim.sql with `create schema if not exists`, so dropping them
 * costs nothing — but NOT dropping them leaks state between runs, which is a real
 * and already-observed failure: the plain-SQL assertion suites (money, catalog,
 * orders) have no `begin; ... rollback;`, so their fixture rows in `auth.users`
 * and `storage.objects` are committed and survive. Every run added another
 * "orders@test.local" / "edge@test.local" user, until a later run inserting the
 * same id died on a duplicate-key error and failed for a reason that had nothing
 * to do with what it was testing.
 *
 * The pgTAP files do wrap themselves in a transaction and roll back, which is
 * why this stayed hidden until they were run back to back against the same
 * database.
 */
const reset = single(
  [
    "drop schema if exists public cascade;",
    "drop schema if exists extensions cascade;",
    "drop schema if exists auth cascade;",
    "drop schema if exists storage cascade;",
    "create schema public;",
    "grant all on schema public to public;",
  ].join("\n"),
  "reset schemas",
);
if (!reset.ok) {
  console.error("\n  could not reset; is a server running against this data dir?\n");
  process.exit(1);
}

/** 2. The Supabase shim. */
if (!single(readFileSync(SHIM, "utf8"), "supabase-shim.sql").ok) process.exit(1);
console.log("  applied scripts/supabase-shim.sql");

/**
 * 3. Migrations in filename order, exactly as production would apply them.
 *
 * `--skip-migrations` exists for the pgTAP shim's own self-test, whose scenarios
 * exercise the shim alone and never touch the application schema. Reapplying 17
 * migrations eight times to check six SQL functions would dominate the run.
 */
const skipMigrations = process.argv.includes("--skip-migrations");
const files = skipMigrations
  ? []
  : readdirSync(MIGRATIONS)
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
console.log(
  skipMigrations
    ? "\n  migrations skipped (--skip-migrations)\n"
    : `\n  all ${files.length} migrations applied (skipped: ${SKIP.join(", ")})\n`,
);

/** 4. Optional assertions. */
const assertionArg = process.argv.find((a) => a.startsWith("--assertions="));
const tapArg = process.argv.find((a) => a.startsWith("--tap="));

if (assertionArg && tapArg) {
  console.error("\n  FATAL: pass --assertions= or --tap=, not both.\n");
  process.exit(1);
}

if (tapArg) {
  // The pgTAP stand-in. Its state table is committed here, in its own session,
  // so it survives into each test file's `begin; ... rollback;` transaction.
  if (!existsSync(PGTAP_SHIM)) {
    console.error(`\n  FATAL: pgTAP shim not found at ${PGTAP_SHIM}\n`);
    process.exit(1);
  }
  if (!single(readFileSync(PGTAP_SHIM, "utf8"), "pgtap-shim.sql").ok) process.exit(1);
  console.log("  applied scripts/pgtap-shim.sql");

  const dir = resolve(ROOT, tapArg.slice("--tap=".length));
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort()
    : [];

  if (files.length === 0) {
    console.error(`\n  FATAL: no .sql files in ${dir}\n`);
    process.exit(1);
  }

  // Every file wraps itself in `begin; ... rollback;`, so they are independent
  // and can share one migrated database. Each must print the shim's summary line
  // on the way out: a file that dropped its `finish()` prints nothing, and that
  // is a failure rather than a quiet pass.
  let total = 0;
  let failedFile = null;

  for (const file of files) {
    const result = single(readFileSync(join(dir, file), "utf8"), file);
    const summary = result.out.match(/pgtap-shim: (\d+)\/(\d+) assertions, 0 failed/);

    if (!result.ok || !summary) {
      if (result.ok) {
        console.error(`\n  FAIL  ${file}`);
        console.error("        no pgTAP summary line: finish() did not run, or it did not pass");
      }
      // `--single` echoes every assertion's result row, so the failing ones are
      // already in the output. Without this the only clue is a count, which is
      // not enough to act on.
      for (const line of result.out.match(/^.*\bnot ok \d+ - .*$/gm) ?? []) {
        console.error(`        ${line.trim()}`);
      }
      failedFile = file;
      break;
    }

    if (Number(summary[1]) !== Number(summary[2])) {
      console.error(`\n  FAIL  ${file}`);
      console.error(`        reported ${summary[1]} of ${summary[2]}`);
      failedFile = file;
      break;
    }

    total += Number(summary[1]);
    console.log(`  ${file}: ${summary[1]}/${summary[2]} passed`);
  }

  if (failedFile) {
    console.error(`\n  TEST FAILED: ${failedFile}\n`);
    process.exit(1);
  }
  console.log(`\n  ${files.length} files, ${total} assertions passed (under the shim)\n`);
} else if (assertionArg) {
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
  console.log("  schema verified. Pass --assertions=<file.sql> or --tap=<dir> to check behaviour.\n");
}
