#!/usr/bin/env node
/**
 * Runs the pgTAP invariant suite in supabase/tests against a real PostgreSQL.
 *
 * This exists because `npm test` only runs Vitest, which means the four usual
 * gate commands say nothing at all about money: every RPC, view, constraint and
 * RLS policy lives in SQL. This script makes the SQL suite part of the gate, and
 * — more importantly — makes it FAIL LOUDLY when no database is reachable,
 * rather than skipping. A silently skipped database suite is how unverified
 * money changes get called "done".
 *
 * Docker is not required. Point it at any PostgreSQL instance; it creates a
 * scratch database, applies every migration in filename order, runs the suite,
 * and drops the scratch database again.
 *
 *   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres npm run test:db
 *
 * Environment:
 *   PGHOST, PGPORT, PGUSER, PGPASSWORD  connection (defaults 127.0.0.1, 5432, postgres)
 *   PGCLIENTENCODING                    forced to UTF8; the migrations are UTF-8
 *   PSQL_BIN                            explicit path to psql
 *   TEST_DB_ADMIN                       database to connect to for admin work (default postgres)
 *   TEST_DB_NAME                        scratch database name (default diecastly_invariants)
 *   KEEP_TEST_DB                        set to 1 to leave the scratch database behind
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const TESTS = join(ROOT, "supabase", "tests");

const HOST = process.env.PGHOST ?? "127.0.0.1";
const PORT = process.env.PGPORT ?? "5432";
const USER = process.env.PGUSER ?? "postgres";
const ADMIN_DB = process.env.TEST_DB_ADMIN ?? "postgres";
const SCRATCH_DB = process.env.TEST_DB_NAME ?? "diecastly_invariants";
const KEEP = process.env.KEEP_TEST_DB === "1";

// The migrations are UTF-8 (em dashes, arrows). A Windows cluster defaults to a
// non-UTF8 encoding often enough that `-f` would fail on those bytes, so the
// scratch database is created as UTF8 from template0 rather than inheriting the
// server default.
const ENV = { ...process.env, PGCLIENTENCODING: "UTF8" };

/** A database name is interpolated into DDL, so only accept a plain identifier. */
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(SCRATCH_DB)) {
  console.error(
    `\n  FATAL: TEST_DB_NAME must be a plain identifier (letters, digits, underscore), got "${SCRATCH_DB}"`,
  );
  process.exit(1);
}

function fail(message, detail) {
  console.error(`\n  FATAL: ${message}`);
  if (detail) console.error(`  ${detail}`);
  process.exit(1);
}

function findPsql() {
  if (process.env.PSQL_BIN) {
    return existsSync(process.env.PSQL_BIN) ? process.env.PSQL_BIN : null;
  }
  const candidates = [
    join(ROOT, "node_modules", ".bin", "psql"),
    "C:/Program Files/PostgreSQL/18/bin/psql.exe",
    "C:/Program Files/PostgreSQL/17/bin/psql.exe",
    "F:/Temp/opencode/pg/pgsql/bin/psql.exe",
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return "psql"; // last resort: rely on PATH, and let the probe report ENOENT
}

const PSQL = findPsql();

/** A bad PSQL_BIN is a configuration error, not a server error. Say so. */
if (PSQL === null) {
  fail(
    `PSQL_BIN points at a file that does not exist: "${process.env.PSQL_BIN}"`,
    "Fix PSQL_BIN, or unset it to search the usual locations and PATH.\n" +
      "  This is NOT a database problem.",
  );
}

function psql(database, args) {
  const result = spawnSync(
    PSQL,
    ["-h", HOST, "-p", PORT, "-U", USER, "-d", database, "-v", "ON_ERROR_STOP=1", ...args],
    { encoding: "utf8", env: ENV },
  );
  return {
    status: result.status,
    spawnError: result.error ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * Cleanup is registered on 'exit' rather than in a `finally`, because
 * `process.exit()` — which `fail()` uses — terminates immediately and a
 * `finally` block never runs. That leaked the scratch database on every early
 * exit. An 'exit' handler runs on process.exit, on an uncaught exception, and
 * on a normal return.
 */
let created = false;
process.on("exit", () => {
  if (!created) return;
  if (KEEP) {
    console.log(`\n  KEEP_TEST_DB=1: left ${SCRATCH_DB} in place for inspection`);
    return;
  }
  psql(ADMIN_DB, ["-c", `drop database if exists ${SCRATCH_DB}`]);
});

/** 1. Distinguish "no psql" from "no server" — they need different fixes. */
const probe = psql(ADMIN_DB, ["-tAc", "select 1"]);
if (probe.spawnError) {
  fail(
    probe.spawnError.code === "ENOENT"
      ? "could not run psql"
      : `could not run psql (${probe.spawnError.code})`,
    probe.spawnError.code === "ENOENT"
      ? `Tried "${PSQL}". Install PostgreSQL client tools, or set PSQL_BIN to the full\n` +
        "  path of psql.exe. This is NOT a server problem."
      : probe.spawnError.message,
  );
}
if (probe.status !== 0) {
  fail(
    `no PostgreSQL server reachable at ${HOST}:${PORT} as "${USER}"`,
    `${probe.stderr.trim() || probe.stdout.trim()}\n` +
      "  The SQL invariant suite was NOT run. Money, stock, RLS and every view are\n" +
      "  unverified. Start a server (Docker + `supabase start`, or a local cluster) and\n" +
      "  re-run, or set PGHOST/PGPORT/PGUSER.",
  );
}
console.log(`  connected to ${HOST}:${PORT}/${ADMIN_DB}`);

/** 2. A clean scratch database, so migrations apply from nothing. */
const drop = psql(ADMIN_DB, ["-c", `drop database if exists ${SCRATCH_DB}`]);
if (drop.status !== 0) fail(`could not drop a stale ${SCRATCH_DB}`, drop.stderr.trim());

const create = psql(ADMIN_DB, [
  "-c",
  `create database ${SCRATCH_DB} encoding 'UTF8' template template0`,
]);
if (create.status !== 0) {
  fail(`could not create the scratch database ${SCRATCH_DB}`, create.stderr.trim());
}
created = true;
console.log(`  created scratch database ${SCRATCH_DB} (UTF8)`);

let failed = false;

/** 3. Migrations, in filename order — the order they will run in production. */
const migrations = existsSync(MIGRATIONS)
  ? readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort()
  : [];
if (migrations.length === 0) fail(`no migrations found in ${MIGRATIONS}`);

for (const file of migrations) {
  const result = psql(SCRATCH_DB, ["-f", join(MIGRATIONS, file)]);
  if (result.status !== 0) {
    failed = true;
    console.error(`\n  migration failed: ${file}\n${result.stderr.trim()}`);
    break;
  }
}
if (!failed) console.log(`  applied ${migrations.length} migrations`);

/** 4. The suite. TAP is text, so a "not ok" line is a failure. */
if (!failed) {
  const tests = existsSync(TESTS)
    ? readdirSync(TESTS)
        .filter((f) => f.endsWith(".sql"))
        .sort()
    : [];
  if (tests.length === 0) fail(`no test files found in ${TESTS}`);

  console.log(`\n  running ${tests.length} invariant files\n`);
  for (const file of tests) {
    const result = psql(SCRATCH_DB, ["-f", join(TESTS, file)]);
    const out = `${result.stdout}${result.stderr}`;
    const notOk = out.split("\n").filter((line) => /^\s*not ok/.test(line));
    const ok = (out.match(/^\s*ok \d+/gm) ?? []).length;
    const bad = notOk.length;

    if (result.status !== 0 || bad > 0) {
      failed = true;
      console.error(`  FAIL  ${file}  (${ok} passed, ${bad} failed)`);
      for (const line of notOk.slice(0, 10)) console.error(`        ${line.trim()}`);
      if (result.status !== 0) {
        console.error(result.stderr.trim().split("\n").slice(0, 5).join("\n"));
      }
    } else if (ok === 0) {
      // A file that reports success without a single assertion has not proved
      // anything. Treat it as a failure rather than a pass.
      failed = true;
      console.error(`  FAIL  ${file}  (0 assertions — the file did not actually test anything)`);
    } else {
      console.log(`  ok    ${file}  (${ok} assertions)`);
    }
  }
}

if (failed) {
  console.error("\n  SQL invariant suite FAILED\n");
  process.exit(1);
}
console.log("\n  SQL invariant suite passed\n");
