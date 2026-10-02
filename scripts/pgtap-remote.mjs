#!/usr/bin/env node
/**
 * Runs supabase/tests/*.sql under REAL pgTAP against the linked project.
 *
 * WHY THIS EXISTS
 *
 * `npm run test:db` cannot complete on this host: scripts/db-suite.mjs creates a
 * scratch database with CREATE DATABASE, and hosted Supabase forbids that. The
 * fallback suites cover behaviour but run the pgTAP files under a shim, which is
 * a stand-in and not the gate. This runner closes that gap without Docker: it
 * connects straight to the linked project and feeds each file to psql, which is
 * what `supabase test db` does internally.
 *
 * FAILS LOUDLY — THE PART THAT MATTERS
 *
 * psql EXITS 0 even when assertions fail, because pgTAP's finish() RETURNS a
 * summary string rather than raising. An earlier harness of mine grepped only
 * for `not ok` and reported eight failures as a clean run; the real output said
 * "Failed test 5" and "Looks like you failed 2 tests of 8". So this runner treats
 * any of four independent signals as a failure, and a missing summary line as a
 * failure too — a file that silently lost its finish() must not read as a pass.
 *
 *   * a `not ok` line
 *   * a `# Failed test N` line
 *   * `Looks like you failed` / `Looks like you planned`
 *   * any ERROR, or no summary line at all
 *
 * ISOLATION
 *
 * Every file wraps itself in begin/rollback, so this is non-destructive in the
 * normal case — verified: orders and auth.users are unchanged afterwards. Two
 * caveats worth stating rather than assuming:
 *
 *   * The files must keep that wrapper. A future file without one would COMMIT
 *     its fixtures into the linked database.
 *   * Tests run against a database that already has data, which is the point:
 *     it is how the unscoped global-count assertions in 01 and 06 were caught.
 *     They had passed only because the database had always been empty.
 *
 * PASSWORD
 *
 * Read from SUPABASE_DB_PASSWORD, deliberately not from a committed file. The
 * pooler URL comes from supabase/.temp, which is gitignored.
 */

import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const TESTS = join(ROOT, "supabase/tests");

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error(
    "\n  SUPABASE_DB_PASSWORD is not set.\n" +
      "  The pooler URL is read from supabase/.temp, but the password is not\n" +
      "  stored in the repository on purpose.\n\n" +
      "    SUPABASE_DB_PASSWORD='...' npm run test:db:remote\n",
  );
  process.exit(2);
}

const ref = readFileSync(join(ROOT, "supabase/.temp/project-ref"), "utf8").trim();
const { host, port, database } = poolerHost(ref);

// Connection goes through the standard PG* variables rather than a URI argument,
// so the password never appears in the process list.
const dbEnv = {
  ...process.env,
  PGHOST: host,
  PGPORT: port,
  PGDATABASE: database,
  PGUSER: `postgres.${ref}`,
  PGPASSWORD: password,
};

function poolerHost(projectRef) {
  const url = readFileSync(join(ROOT, "supabase/.temp/pooler-url"), "utf8").trim();
  // `postgres.<ref>@host:port/db` — split on the FIRST @ only. Using
  // split("@")[1] would drop the user entirely and compare a bare hostname
  // against `postgres.<ref>@`, which never matches.
  const rest = url.replace(/^postgresql:\/\//, "");
  const at = rest.indexOf("@");
  if (at < 0) {
    console.error("  supabase/.temp/pooler-url is missing or unparseable — run `supabase link`.");
    process.exit(2);
  }
  const user = rest.slice(0, at);
  const hostAndDb = rest.slice(at + 1);
  // Sanity check: the pooler user and the project ref must agree, or the
  // connection is refused in a way that reads like a password problem.
  if (user !== `postgres.${projectRef}`) {
    console.error(
      `  pooler-url is for ${user}, but project-ref is ${projectRef}.\n` +
        "  Run `supabase link --project-ref <ref>` again.",
    );
    process.exit(2);
  }
  const [hostname, tail] = hostAndDb.split(":");
  const [dbPort, dbName] = (tail ?? "5432").split("/");
  return { host: hostname, port: dbPort || "5432", database: dbName || "postgres" };
}

const PSQL = process.env.PSQL ?? "psql";
const safeTarget = `postgres.${ref}@${host}:${port}/${database}`;
console.log(`\n  pgTAP against the linked project ${ref}\n`);
console.log(`  ${safeTarget}\n`);

function runFile(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(PSQL, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", file], {
      env: dbEnv,
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ out, code }));
  });
}

const files = readdirSync(TESTS)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let passed = 0;
let failed = 0;
let assertions = 0;

for (const file of files) {
  const { out } = await runFile(join(TESTS, file));
  const ok = (out.match(/^ ok /gm) ?? []).length;
  const signals = [
    /^not ok /m,
    /# Failed test/m,
    /Looks like you failed/m,
    /Looks like you planned/m,
    /^ERROR/m,
  ].filter((re) => re.test(out));

  // Real pgTAP's finish() emits NOTHING on success - it returns an empty result
  // set - and only reports a mismatch as "Looks like you planned". So a summary
  // line cannot be required as a liveness signal the way the shim can.
  //
  // plan(N) is read from the FILE, not from psql's output: `select plan(8)`
  // returns nothing and -q suppresses it, so it never appears on stdout. The
  // cross-check against it is what proves the file ran to completion and that no
  // assertion was silently skipped.
  const planned = Number(
    (readFileSync(join(TESTS, file), "utf8").match(/select\s+plan\(\s*(\d+)\s*\)/i) ?? [])[1] ?? NaN,
  );

  assertions += ok;

  if (signals.length === 0 && ok > 0 && planned === ok) {
    console.log(`  PASS  ${file.padEnd(42)} ${ok} assertions`);
    passed += 1;
  } else {
    console.log(`  FAIL  ${file.padEnd(42)} ${ok} passed, plan(${planned})`);
    if (signals.length === 0) {
      console.log(
        ok === 0
          ? "        no assertions ran — the file aborted before its first assertion"
          : `        assertion count does not match plan(${planned}); finish() did not run`,
      );
    }
    for (const line of out.split("\n")) {
      if (/not ok |# Failed test|Looks like you|^ERROR/.test(line)) {
        console.log(`        ${line.replace(/\s+/g, " ").trim()}`);
      }
    }
    failed += 1;
  }
}

console.log("============================================");
console.log(`${files.length} files, ${passed} passed, ${failed} failed, ${assertions} assertions`);
console.log(failed === 0 ? "REAL pgTAP suite passed\n" : "REAL pgTAP suite FAILED\n");
process.exit(failed === 0 ? 0 : 1);
