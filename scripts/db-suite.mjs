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
 *   PGHOST, PGPORT, PGUSER, PGPASSWORD   connection (defaults: 127.0.0.1, 5432, postgres)
 *   PGPASSWORD may be omitted when the server uses trust auth.
 *   TEST_DB_ADMIN   existing database to clone the scratch name from (default: postgres)
 *   KEEP_TEST_DB    set to 1 to leave the scratch database behind for debugging
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

function fail(message, detail) {
  console.error(`\n  FATAL: ${message}`);
  if (detail) console.error(`  ${detail}`);
  process.exit(1);
}

function findPsql() {
  if (process.env.PSQL_BIN && existsSync(process.env.PSQL_BIN)) return process.env.PSQL_BIN;
  const candidates = [
    join(ROOT, "node_modules", ".bin", "psql"),
    "C:/Program Files/PostgreSQL/18/bin/psql.exe",
    "C:/Program Files/PostgreSQL/17/bin/psql.exe",
    "F:/Temp/opencode/pg/pgsql/bin/psql.exe",
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return "psql";
}

function psql(database, args, opts = {}) {
  const result = spawnSync(
    findPsql(),
    ["-h", HOST, "-p", PORT, "-U", USER, "-d", database, "-v", "ON_ERROR_STOP=1", ...args],
    { encoding: "utf8", ...opts },
  );
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** 1. Is there a server at all? */
const probe = psql(ADMIN_DB, ["-tAc", "select 1"], { stdio: ["ignore", "pipe", "pipe"] });
if (probe.status !== 0) {
  fail(
    `no PostgreSQL server reachable at ${HOST}:${PORT} as "${USER}"`,
    `${probe.stderr.trim() || probe.stdout.trim()}\n` +
      "  The SQL invariant suite was NOT run. Money, stock, RLS and every view are\n" +
      "  unverified. Start a server (Docker + `supabase start`, or a local cluster) and\n" +
      "  re-run, or set PGHOST/PGPORT/PGUSER. See docs for the shim notes.",
  );
}

console.log(`  connected to ${HOST}:${PORT}/${ADMIN_DB}`);

/** 2. A clean scratch database, so migrations apply from nothing. */
const drop = psql(ADMIN_DB, ["-c", `drop database if exists ${SCRATCH_DB}`]);
if (drop.status !== 0) fail("could not drop the scratch database", drop.stderr.trim());

const create = psql(ADMIN_DB, ["-c", `create database ${SCRATCH_DB}`]);
if (create.status !== 0) fail(`could not create the scratch database ${SCRATCH_DB}`, create.stderr.trim());
console.log(`  created scratch database ${SCRATCH_DB}`);

let failed = false;
try {
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
        if (result.status !== 0) console.error(result.stderr.trim().split("\n").slice(0, 5).join("\n"));
      } else {
        console.log(`  ok    ${file}  (${ok} assertions)`);
      }
    }
  }
} finally {
  if (process.env.KEEP_TEST_DB === "1") {
    console.log(`\n  KEEP_TEST_DB=1: left ${SCRATCH_DB} in place`);
  } else {
    psql(ADMIN_DB, ["-c", `drop database if exists ${SCRATCH_DB}`]);
  }
}

if (failed) {
  console.error("\n  SQL invariant suite FAILED\n");
  process.exit(1);
}
console.log("\n  SQL invariant suite passed\n");
