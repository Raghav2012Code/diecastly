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
| `/preview` | Admin | dev only | Static preview harness (no database), used for design review and the mobile/tablet QA in D66/D67 |

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
- `lib/db/rpc.ts` — typed wrappers around the Postgres functions the application calls; the only place RPC names/arguments are declared. The migrations declare more functions than are wrapped: `is_admin`, `require_admin`, `next_order_number`, `apply_stock_delta`, `record_movement`, `normalize_phone` and the trigger helpers are internal, and policy functions like `is_listable_product_image` are called from SQL policies rather than from TypeScript. `tests/unit/rpc-signatures.test.ts` pins each wrapper's RPC name and `p_*` arguments against the migrations, so a renamed parameter fails `npm test` rather than failing at runtime — PostgREST does not type-check named arguments, and a mismatch is invisible to `tsc`.
- `lib/validation/` — Zod schemas shared by forms and server code.
- `lib/types/database.types.ts` — **hand-maintained**, not generated from the Supabase schema. It is deliberately partial: function signatures live in `lib/db/rpc.ts` rather than here, and a few view rows are declared locally at their consumer. Regenerating it from the live schema is a future task, not a current guarantee — treat a missing type as a prompt to check the SQL, not as evidence the type is unnecessary.
- Images: Supabase Storage bucket `product-images` (public read, admin write), served via `next/image`.
- Environment variables: Supabase URL + anon key (public), service-role key (server only), site URL.

## 9. Folder structure

```
src/
  app/
    (store)/            catalog, products/[slug], cart, checkout, order/[number]
    (admin)/admin/      dashboard, pos, inventory ( + movements), products
                        ( + new, [id], categories, suppliers), orders ( + [id],
                        [id]/receipt), customers, sales ( + export), analytics
                        ( + export), settings
    (auth)/admin/login/ Supabase Auth sign-in
    (preview)/preview/  static preview harness (the design-review surface)
  components/{ui,admin,store}
  lib/
    supabase/{client,server}.ts
    db/{rpc,errors}.ts
    validation/{money,catalog,inventory,order,settings}.ts
    catalog/, inventory/, orders/, customers/, reports/, store/, preview/  data modules
    search.ts, list-state.ts, list-params.ts, dates.ts, display.ts, storage.ts
    types/database.types.ts
  middleware.ts
supabase/
  migrations/           schema, RLS, functions
  tests/                pgTAP invariant files
docs/                   this documentation set
```

Notes on the structure as it exists rather than as it was planned: the cart is a
React context at `lib/store/cart-context.tsx` (there is no `hooks/` directory —
the planned `hooks/use-cart.ts` was never created); login lives in the `(auth)`
route group, not under `(admin)`; and each data module (`catalog`, `inventory`,
`orders`, `customers`, `reports`, `store`, `preview`) owns its own reads rather
than a shared `lib/data.ts`.


## 10. Deliberate non-goals and scope

**v1 is intentionally single-business, single-location, single-admin.** There are no tenant, workspace, or organization abstractions anywhere in the schema or code. Multi-tenant SaaS architecture is deferred until there is a real requirement; adding it would be a redesign, not a configuration change.

Also out of scope for v1: customer auth, online payment gateway, background jobs, returns/exchange system, staff roles, coupons, multi-currency, multi-warehouse, tax engine, notifications. See `decisions.md` and `roadmap.md`.
