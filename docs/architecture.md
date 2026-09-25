# Diecastly — Architecture

Approved architecture reference. Describes the decided design only; no speculative alternatives.

## 1. Purpose and constraints

Diecastly is a D2C business-management platform for a small diecast (Hot Wheels) reseller.

- Most sales are **in-person, hand-to-hand**, paid in cash or UPI.
- Roughly **10–15% of orders are online** and require packing/shipping.
- One admin operator. Sales are occasional. The system must be fast, simple, and practical.
- Explicitly **not** in scope: microservices, message queues, multi-warehouse, staff roles, coupon engines, customer accounts, accounting suites.

## 2. Stack

| Concern | Choice |
|---|---|
| App framework | Next.js (App Router) + TypeScript |
| Styling / UI | Tailwind CSS + shadcn/ui |
| Backend | Supabase: Postgres, Auth, Storage |
| Hosting | Vercel |
| Migrations / local dev | Supabase CLI |
| Validation | Zod (shared client/server) |
| Unit tests | Vitest |
| Database/invariant tests | pgTAP or SQL test scripts |
| E2E tests | Playwright (thin, happy paths only) |

## 3. Application surfaces

- **Admin application** — desktop-first. Dashboard, Record Sale (POS), Inventory, Products, Orders, Customers, Sales, Analytics, Settings.
- **Public storefront** — mobile-first and responsive. Catalog, product detail, cart, checkout, guest order confirmation.

## 4. Single application, two route groups

One Next.js app with two route groups:

- `app/(admin)/admin/…` — authenticated, admin-only.
- `app/(store)/…` — public storefront.

`middleware.ts` guards `/admin/*` and redirects unauthenticated users to `/admin/login`. Middleware is convenience only; **RLS is the real authorization gate**.

## 5. Route structure

| Route | Surface | Access | Purpose |
|---|---|---|---|
| `/` | Storefront | public | Catalog with search/filter/sort |
| `/products/[slug]` | Storefront | public | Product detail |
| `/cart` | Storefront | public | Cart (client-side) |
| `/checkout` | Storefront | public | Guest checkout |
| `/order/[orderNumber]?token=…` | Storefront | token | Guest order confirmation/status |
| `/admin/login` | Admin | public | Supabase Auth sign-in |
| `/admin` | Admin | admin | Dashboard |
| `/admin/pos` | Admin | admin | Record Sale |
| `/admin/inventory` | Admin | admin | Stock levels + movements |
| `/admin/products` | Admin | admin | Product metadata + images |
| `/admin/orders` | Admin | admin | Order list + detail |
| `/admin/customers` | Admin | admin | Customer list + history |
| `/admin/sales` | Admin | admin | Sales/profit reports |
| `/admin/analytics` | Admin | admin | Trend/breakdown reports |
| `/admin/settings` | Admin | admin | Business settings |

## 6. Data-access lanes

Every read and write goes through exactly one of three lanes. Mixing lanes is the main source of inconsistency.

1. **Reads** — Supabase client in server components / server actions, governed by RLS. Storefront reads only public views.
2. **Atomic writes (RPC)** — Postgres functions called via `supabase.rpc(...)`. Each runs in a single transaction. This lane is the **only** way stock, orders, order items, status history, or payments change.
3. **Metadata writes (RLS)** — direct RLS-guarded table writes for non-transactional data: products, categories, suppliers, product images, settings, customers.

## 7. Core architectural principles

- **The database is the single source of truth.** The UI and storefront only ever report DB state.
- **Stock and money change only through RPCs.** Metadata never carries financial or inventory side effects.
- **Historical data is snapshotted.** Order lines keep product name, SKU, sale price, and unit cost as of the sale.
- **Ledgers are append-only.** Inventory movements and payments are never edited or deleted; corrections are compensating entries.
- **Payment state is derived, never stored as a mutable flag.**
- **Deny by default.** RLS grants are an allowlist; anon can read public views and place an order, nothing else.
- **YAGNI.** No feature is added without a concrete, present-day need.

## 8. Runtime and integration points

- Supabase clients: `lib/supabase/client.ts` (browser, anon key) and `lib/supabase/server.ts` (server components/actions, session cookie). A service-role key is server-only and never shipped to the browser.
- `lib/db/rpc.ts` — typed wrappers around every Postgres function; the only place RPC names/arguments are declared.
- `lib/validation/` — Zod schemas shared by forms and server code.
- `lib/types/database.types.ts` — generated from the Supabase schema.
- Images: Supabase Storage bucket `product-images` (public read, admin write), served via `next/image`.
- Environment variables: Supabase URL + anon key (public), service-role key (server only), site URL.

## 9. Folder structure

```
src/
  app/
    (store)/            catalog, product, cart, checkout, order/[number]
    (admin)/admin/      dashboard, pos, inventory, products, orders,
                        customers, sales, analytics, settings, login
  components/{ui,admin,store}
  lib/
    supabase/{client,server}.ts
    db/rpc.ts
    validation/
    money.ts, dates.ts
    types/database.types.ts
  hooks/use-cart.ts
supabase/
  migrations/           schema, RLS, functions
  tests/                SQL/ pgTAP invariant tests
docs/                   this documentation set
```

## 10. Deliberate non-goals and scope

**v1 is intentionally single-business, single-location, single-admin.** There are no tenant, workspace, or organization abstractions anywhere in the schema or code. Multi-tenant SaaS architecture is deferred until there is a real requirement; adding it would be a redesign, not a configuration change.

Also out of scope for v1: customer auth, online payment gateway, background jobs, returns/exchange system, staff roles, coupons, multi-currency, multi-warehouse, tax engine, notifications. See `decisions.md` and `roadmap.md`.
