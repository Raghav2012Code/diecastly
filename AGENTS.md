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
- **Docker is not installed**, so `supabase start`, `supabase db reset` and `supabase test db` cannot run on this machine. Run the invariant suite in `supabase/tests/` against a real PostgreSQL 18 with a Supabase shim instead, and say so in any completion report. `.env.local` holds the standard Supabase CLI local keys pending `supabase status` once Docker exists.
- Public sign-up is disabled; create the admin user from the SQL under **Create the admin user** in the README.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in this repo, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the repo root plus `docs/adr/`. See `docs/agents/domain.md`.
