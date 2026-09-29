# Diecastly — agent guide

## Read before designing anything

The approved design is the `docs/` set and the GitHub issue you are working from is the spec. Read `docs/architecture.md` (route map, data-access lanes), `docs/database.md` (schema, money/profit definitions, glossary), `docs/security.md` (RLS, RPC security, guest tokens), `docs/ux.md`, `docs/roadmap.md`, and `docs/decisions.md` (decision log; stands in for ADRs until `CONTEXT.md` and `docs/adr/` exist). Where the code disagrees with a doc, raise it explicitly rather than quietly deviating.

Rules that bite:

1. **Ledger lanes are strict.** `orders`, `order_items`, `order_status_history`, `payments`, `inventory_stock` and `inventory_movements` change only through `security definer` RPCs — `lib/db/rpc.ts` is the one place RPC names and argument shapes are declared, so every new mutation is a migration plus a wrapper there, never a direct table write from UI or metadata lanes.
2. **Money is INR, `numeric(12,2)`.** Cost, price, discount and profit arithmetic goes through `lib/validation/money.ts`; never hand-roll `*` or `+` on money values.
3. **History is never rewritten.** Products are archived, not hard-deleted; `inventory_movements` and `payments` are append-only; order lines and payments snapshot name, SKU, price and cost at write time.
4. **IST day boundaries** for anything dated/reported; format through `lib/dates.ts`.

## Verification gate

A change is done only when all four exit clean, not before: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Then commit — one commit per coherent feature, message style matching `git log` ("Phase N — area: what it does" plus a short body of what and what was verified).

## Environment gotchas

- Shell is Windows PowerShell 5.1: `&&` does not work; chain dependent commands with `if ($?) { … }`.
- **The SQL invariant suite is part of the gate and must not be skipped.** `npm test` runs Vitest only, which says nothing about money — every RPC, constraint, RLS policy and view is SQL. `npm run verify` runs typecheck, lint, unit tests, build **and** `npm run test:db`, which applies every migration to a scratch database and runs `supabase/tests/*.sql` against it. `test:db` exits non-zero when no server is reachable rather than skipping, so a green gate is impossible while the SQL is unverified.
- **Docker is not installed** on the development machine, so `supabase start`, `supabase db reset` and `supabase test db` cannot run. `scripts/db-suite.mjs` therefore drives `psql` directly and needs no Docker: point `PGHOST`/`PGPORT`/`PGUSER` at any PostgreSQL and it creates a scratch database, migrates, tests, and drops it.
- **A local PostgreSQL 18 works, but only in single-user mode.** Scoop's install fails because C: has under 200 MB free, so the EDB binaries were extracted to `F:/Temp/opencode/pg`. `initdb` succeeds and the postmaster starts and listens — but **every forked backend dies with `STATUS_DLL_INIT_FAILED` (0xC0000142)**, so no client can connect. Ruled out: missing MSVC runtime (14.51 present), `autovacuum`, `shared_memory_type` (only `windows` is valid on Windows), and `PATH`. The account is **not** an administrator, which blocks the Windows-service route that is otherwise the fix; Windows Defender is active, cannot be disabled without elevation, and is the remaining suspect. Do not spend time re-diagnosing this.
- **`postgres --single` is the workaround, and it works.** It runs the backend inside the postmaster process, so it needs no fork. It applies the Supabase shim plus every migration, then runs one plain-SQL assertion file. There are two, and both are part of the gate:

  | Script | Assertions | Covers |
  | --- | --- | --- |
  | `npm run test:db:single` | `scripts/money-assertions.sql` | the money trust boundary |
  | `npm run test:db:catalog` | `scripts/catalog-assertions.sql` | atomic image ordering, primary selection, deletion, and the function grants |
  | `npm run test:db:orders` | `scripts/order-assertions.sql` | cancellation restock, idempotency scoping, the customer link, and the payment caps |
  | `npm run test:db:tap` | `supabase/tests/*.sql` (8 files, 91 assertions) | the pgTAP files, run under `scripts/pgtap-shim.sql` |
  | `npm run test:db:shim` | `scripts/pgtap-shim-selftest/` (8 scenarios) | that the shim itself can still **fail** — six of the eight are meant to fail |
| `npm run test:db:fallback` | all five, in sequence | the SQL half of the gate |

  `npm run verify:fallback` is the whole gate (`typecheck`, `lint`, `test`, `build`, `contrast`, then all five suites) and is what to run in place of `npm run verify` on this host, which cannot complete because `test:db` needs a reachable server. `npm run verify` remains the real gate and is unchanged.

- **Contrast is part of the gate now: `npm run contrast`.** `scripts/contrast-audit.mjs` computes WCAG ratios from the token values in `src/app/globals.css` — no browser, no database — and is wired into both `verify` and `verify:fallback`. It was built *before* any token edit so every fix is confirmed by the check that found the bug, and it is negative-tested: the pre-fix `--primary` fails it at 3.56:1, matching the browser measurement in `docs/design-audit.md` to two decimals. **Re-run it after any change to a colour token**, and note that it also asserts there is no `.dark` block and no `darkMode` key — a re-added dark palette is the failure that reads as a feature (D73).

  This is a fallback, not a replacement for `npm run test:db`: it cannot `CREATE DATABASE`, and `RAISE NOTICE` output goes to the server log rather than stdout, so the success signal is a `SELECT` that is echoed as a result row.

- **Assert the assertions, every time you add one.** A green plain-SQL suite proves nothing unless it can fail. Before believing a new assertion, break the code it claims to cover and confirm the suite exits non-zero — for example, drop a trigger, or `grant execute ... to anon`, and check the named FAIL message appears. Two traps make a passing assertion vacuous rather than absent:

  - A test that mutates an array built with `array_agg(id)` over an ordered *subquery* is not testing what it looks like: an ORDER BY outside the aggregate does not constrain the aggregate's order. Put `order by` **inside** `array_agg`.
  - When patching a file with a script, use a **function** replacer, never a string. In `String.prototype.replace`, `$$` in a replacement is an escape for one literal `$`, so writing `$$;` through a string replacement silently produces `$;`. This corrupted a migration terminator here and the patch reported success while changing nothing.
  - Assert an absolute stock figure only when the fixture guarantees it. A "nothing changed" claim must compare against a value read immediately before the call, because earlier sections in the same file legitimately move that stock.
  - A `DO` block is one transaction, so a `raise exception` on a failed assertion **rolls back that block's own writes**. A later block that depends on them will fail for the wrong reason, which reads like a second bug.
  - For an all-or-nothing claim, "the call was rejected" is only half the assertion. Assert the rejected call also **changed nothing**, or it passes even against an implementation that half-applied before failing.

- **A `revoke ... from anon` you delete may not grant anything.** `anon` has no default grant; the default is `PUBLIC`. Deleting `revoke execute ... from public, anon` grants `anon` nothing, so the suite stays green and proves nothing. To negative-test a grant, `grant` the privilege to the wrong role for real.
- **Feeding `--single` needs a SQL-aware splitter, and its comments must be removed rather than flattened.** `scripts/sql-split.mjs` emits one statement per line and strips comments. Both halves are load-bearing. Collapsing whitespace instead of removing comments is what breaks: flattening the newline that terminates a `--` comment extends that comment over the rest of the statement, so a function body swallows its own closing `$$` and PostgreSQL reports the deeply misleading "syntax error at end of input". That is exactly how the Diecastly migrations failed the first time this was run. String literals are never touched, and a newline inside one is refused rather than rewritten.
- **pgTAP itself is still unavailable, but `supabase/tests/*.sql` now runs anyway.** The real extension is not bundled with the EDB Windows binaries and no MSYS2 package exists, so `CREATE EXTENSION pgtap` needs a cross-toolchain build (an MSVC-built server against a UCRT64 gcc). `scripts/pgtap-shim.sql` closes the gap the other way: it implements the six pgTAP functions those files actually use — `plan`, `is`, `ok`, `lives_ok`, `throws_ok`, `finish` — in plain SQL, and `test:db:tap` runs all eight files under `postgres --single`. **`npm run test:db` and `supabase test db` remain the real gate; the shim does not replace them.** Three properties of the shim are load-bearing, so do not "simplify" them away:

  - `is()` compares with `IS NOT DISTINCT FROM`, never `=`. `is(NULL, NULL)` must not pass by accident and `is(NULL, 5)` must not pass at all. Numerics compare by value, so `1.10 = 1.1` as pgTAP intends.
  - `throws_ok()` checks the SQLSTATE **and** the message token. D49 pins every business failure to `P0001` and distinguishes them by message text, so matching the state alone would let an assertion pass on the wrong failure.
  - `finish()` raises on a count mismatch or on any failure, and the harness *requires* its summary line. A file that silently dropped its `finish()` fails instead of passing quietly — which is exactly how `08_money_trust_boundary.sql` sat at `plan(21)` against 29 assertions for its entire life.
- **State in any completion report that the pgTAP files ran under the shim, not under pgTAP.** `supabase test db` still cannot run here. "All 8 files, 91 assertions passed under the shim" is the honest result and should be reported as exactly that, never inflated into "the pgTAP suite passed".
- **The harness reset must drop `auth` and `storage`, not just `public`.** The plain-SQL assertion suites have no `begin; ... rollback;`, so their fixture rows in `auth.users` and `storage.objects` are committed. Dropping only `public` let those rows accumulate across every run until a later run inserting the same id died on a duplicate-key error — a failure with no relationship to what it was testing. The pgTAP files *do* wrap themselves in a transaction, which is why this stayed invisible until they were run back to back against one database.
- Public sign-up is disabled; create the admin user from the SQL under **Create the admin user** in the README.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in this repo, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the repo root plus `docs/adr/`. See `docs/agents/domain.md`.
