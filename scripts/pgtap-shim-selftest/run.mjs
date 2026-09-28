#!/usr/bin/env node
/**
 * Runs every scenario in this directory and checks that each one behaved as its
 * name says it should.
 *
 * Six of the eight are SUPPOSED to fail. `--tap` exits non-zero on any failing
 * file, so running them directly would be useless — the whole point is that a
 * deliberately wrong assertion is caught. So each scenario runs as its own
 * `--tap` invocation, the exit code is compared against what the scenario
 * declares, and the runner fails if any of them disagrees.
 *
 * This is the "assert the assertions" rule from AGENTS.md applied to the thing
 * that does the asserting. Without it, an edit to pgtap-shim.sql that quietly
 * made `is()` return true for anything would turn the whole SQL gate green and
 * say nothing.
 */

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HARNESS = join(HERE, "..", "single-user.mjs");

// The contract each scenario is asserting about the shim.
const EXPECTATIONS = {
  "t1-pass": "pass",
  "t2-wrong-value": "fail",
  "t3-plan-mismatch": "fail",
  "t4-wrong-token": "fail",
  "t5-right-token": "pass",
  "t6-no-finish": "fail",
  "t7-null-vs-value": "fail",
  "t8-lives-fails": "fail",
};

const scenarios = readdirSync(HERE, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name in EXPECTATIONS)
  .map((entry) => entry.name)
  .sort();

if (scenarios.length === 0) {
  console.error("\n  FATAL: no scenarios found\n");
  process.exit(1);
}

console.log(`\n  pgTAP shim self-test — ${scenarios.length} scenarios\n`);

let broken = 0;

for (const name of scenarios) {
  const expect = EXPECTATIONS[name];
  const result = spawnSync(
    process.execPath,
    [HARNESS, `--tap=${join(HERE, name)}`, "--skip-migrations"],
    { encoding: "utf8" },
  );
  const got = result.status === 0 ? "pass" : "fail";
  const ok = got === expect;

  if (!ok) broken += 1;
  console.log(`  ${ok ? "ok  " : "BAD "} ${name.padEnd(20)} expected ${expect}, got ${got}`);

  // On an unexpected pass, the failing detail is the useful thing to surface:
  // it means the shim swallowed an assertion it should have caught.
  if (!ok && got === "pass") {
    for (const line of result.stdout.split("\n")) {
      if (line.includes("not ok")) console.log(`         ${line.trim()}`);
    }
  }
}

console.log("");
if (broken > 0) {
  console.error(`  SHIM SELFTEST BROKEN: ${broken} scenario(s) did not behave as designed\n`);
  process.exit(1);
}
console.log("  shim self-test passed: the shim can still fail, which is the point\n");
