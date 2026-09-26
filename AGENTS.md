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
| `npm run test:db:fallback` | all three, in sequence | the SQL half of the gate |

  `npm run verify:fallback` is the whole gate (`typecheck`, `lint`, `test`, `build`, then all three suites) and is what to run in place of `npm run verify` on this host, which cannot complete because `test:db` needs a reachable server. `npm run verify` remains the real gate and is unchanged.

  This is a fallback, not a replacement for `npm run test:db`: it has no pgTAP, cannot `CREATE DATABASE`, and `RAISE NOTICE` output goes to the server log rather than stdout, so the success signal is a `SELECT` that is echoed as a result row.

- **Assert the assertions, every time you add one.** A green plain-SQL suite proves nothing unless it can fail. Before believing a new assertion, break the code it claims to cover and confirm the suite exits non-zero — for example, drop a trigger, or `grant execute ... to anon`, and check the named FAIL message appears. Two traps make a passing assertion vacuous rather than absent:

  - A test that mutates an array built with `array_agg(id)` over an ordered *subquery* is not testing what it looks like: an ORDER BY outside the aggregate does not constrain the aggregate's order. Put `order by` **inside** `array_agg`.
  - When patching a file with a script, use a **function** replacer, never a string. In `String.prototype.replace`, `$$` in a replacement is an escape for one literal `$`, so writing `$$;` through a string replacement silently produces `$;`. This corrupted a migration terminator here and the patch reported success while changing nothing.
  - Assert an absolute stock figure only when the fixture guarantees it. A "nothing changed" claim must compare against a value read immediately before the call, because earlier sections in the same file legitimately move that stock.
  - A `DO` block is one transaction, so a `raise exception` on a failed assertion **rolls back that block's own writes**. A later block that depends on them will fail for the wrong reason, which reads like a second bug.
  - For an all-or-nothing claim, "the call was rejected" is only half the assertion. Assert the rejected call also **changed nothing**, or it passes even against an implementation that half-applied before failing.

- **A `revoke ... from anon` you delete may not grant anything.** `anon` has no default grant; the default is `PUBLIC`. Deleting `revoke execute ... from public, anon` grants `anon` nothing, so the suite stays green and proves nothing. To negative-test a grant, `grant` the privilege to the wrong role for real.
- **Feeding `--single` needs a SQL-aware splitter, and its comments must be removed rather than flattened.** `scripts/sql-split.mjs` emits one statement per line and strips comments. Both halves are load-bearing. Collapsing whitespace instead of removing comments is what breaks: flattening the newline that terminates a `--` comment extends that comment over the rest of the statement, so a function body swallows its own closing `$$` and PostgreSQL reports the deeply misleading "syntax error at end of input". That is exactly how the Diecastly migrations failed the first time this was run. String literals are never touched, and a newline inside one is refused rather than rewritten.
- **pgTAP is still unavailable** — not bundled with the EDB Windows binaries, and no MSYS2 package exists, so `CREATE EXTENSION pgtap` needs a cross-toolchain build (an MSVC-built server against a UCRT64 gcc). `supabase/tests/*.sql` still cannot run on this host; only the plain-SQL assertions can.
- State in any completion report whether the pgTAP suite actually ran. If it did not, say so plainly and say what *was* verified instead. "All migrations applied and the money behaviour asserted" is a real result and should be reported as exactly that, never inflated into "the suite passed".
- Public sign-up is disabled; create the admin user from the SQL under **Create the admin user** in the README.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in this repo, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the repo root plus `docs/adr/`. See `docs/agents/domain.md`.
