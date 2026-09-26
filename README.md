# Diecastly

A D2C business-management platform for a small diecast (Hot Wheels) collectibles seller: an
admin application to run the business and a responsive public storefront.

Most sales are in-person, hand-to-hand, paid in cash or UPI; roughly 10–15% are online orders
that require packing and shipping. The system is intentionally small: one Next.js application
with Supabase as the entire backend.

## Status

- **Phase 0 — foundation:** complete (app scaffold, auth, admin shell, guard, env handling).
- **Phase 1 — database:** complete (schema, constraints, views, RPCs, RLS, tests).
- **Phase 2 — catalog & inventory:** complete (products, categories, suppliers, images, opening stock, restock, adjustments, movement ledger).
- **Phase 3 — POS & payments:** complete (Record Sale with a live receipt, orders list and detail, payments and refunds, printable receipts).
- **Phase 4 — storefront:** complete (catalog with search/filter/sort, product detail with gallery, client-side cart, guest checkout via `place_online_order`, token-accessed order confirmation).
- **Phase 5 — online order ops:** complete (order queue with fulfilment actions, cancel and in-person reversal, customer list).
- **Phase 6 — reporting:** complete (dashboard, sales with CSV export, analytics with product margin, business settings).
- **Phase 7:** not started (edge-case tests, responsive QA, low-stock alerts, polish, release checklist).

> Docker is not installed on the current machine. Phases 0–2 were validated against a real
> PostgreSQL 18 cluster with a Supabase shim rather than `supabase start`; the Phase 3
> invariant suite (`supabase/tests/07_phase3_pos_payments.sql`) is authored but still needs
> `supabase test db` on a machine with the local stack. Browser-level QA likewise requires a
> running local stack.

## Stack

Next.js (App Router) + TypeScript · Tailwind CSS + shadcn/ui · Supabase (Postgres, Auth,
Storage) · Vercel · Zod · Vitest · pgTAP · Playwright (later).

## Documentation

The approved architecture lives in `docs/` and is the source of truth:

- `docs/architecture.md` — structure, routes, data-access lanes
- `docs/database.md` — schema, money/profit definitions, integrity rules
- `docs/security.md` — auth, RLS, RPC security, guest access tokens
- `docs/ux.md` — admin and storefront behaviour
- `docs/decisions.md` — decision log
- `docs/roadmap.md` — phases and deferred work

## Prerequisites

- Node.js 20+ and npm
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- Docker (required by the Supabase CLI for the local stack)

> The current development machine does not have Docker installed. The migrations have been
> validated against a real PostgreSQL 18 cluster, but `supabase start` / `supabase test db`
> require Docker.

## Local setup

```bash
npm install

# Start the local Supabase stack (requires Docker).
# This prints the API URL, anon key and service-role key.
supabase start

# Copy the example env file and paste the keys printed above.
cp .env.example .env.local

# Apply migrations and seed.
supabase db reset

# Run the app.
npm run dev
```

### Create the admin user

Public sign-up is disabled. Create the single admin user through Supabase Studio
(`http://localhost:54323`) or the CLI, then add a matching `admin_users` row so RLS recognises
them as an admin:

```sql
insert into public.admin_users (id, email)
select id, email from auth.users where email = 'you@example.com';
```

Sign in at `/admin/login`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |
| `npm run format` | Prettier |
| `npm run db:start` / `db:stop` | Local Supabase stack |
| `npm run db:reset` | Apply migrations + seed locally |
| `npm run db:test` | Run pgTAP invariant tests (requires Docker) |
| `npm run db:push` | Push migrations to the linked remote project |

## Security model at a glance

- The database is the single source of truth. Stock, orders and payments change **only** through
  `security definer` RPCs; simple metadata uses RLS-guarded writes.
- Payment state is derived from the append-only `payments` ledger — never stored.
- Guest order access requires both the order number and a 122-bit access token; phone/email
  never authorise access.
- Anon has no base-table privileges; it reaches the storefront through definer views and two
  RPCs only.
- The service-role key is server-only and must never reach the browser.
