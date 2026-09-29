# Diecastly — Implementation Roadmap

Derived from Sections 1–5. Phases are sequential unless noted. Each phase ends with its tests green before the next begins.

## Guiding rule

Data integrity first. Build the schema, RLS, and RPC contracts correctly, then layer UI on top. A thin vertical slice that exercises stock + payment + profit beats broad unfinished UI.

**Scope:** v1 is single-business, single-location, single-admin. No tenant/workspace/organization abstractions are introduced. Multi-tenant SaaS is deferred until there is an actual requirement.

## Slices

### Slice A — Foundation and invariants (Phases 0–1)
- Repo scaffold, Next.js app, Tailwind + shadcn/ui.
- Supabase project, local stack, migrations tooling, env vars.
- Supabase Auth (sign-up disabled), admin login, admin shell, `middleware.ts` guard.
- Full schema: enums, tables, checks, indexes, views, `is_admin()`, RLS.
- SQL/pgTAP invariant tests.
- **Exit:** admin can log in; non-admin sees nothing; invariant tests green.

### Slice B — Main channel: catalog, inventory, POS (Phases 2–3)
- Products, categories, suppliers, images (metadata via RLS).
- `inventory_stock`, `restock_product`, `adjust_stock`, `set_initial_stock`; movement ledger UI.
- `record_in_person_sale`, `record_payment`, `refund_payment`; receipt; derived financials.
- **Exit:** in-person sales decrement stock, write movements, and report correct profit.

### Slice C — Online channel (Phases 4–5)
- Public views, catalog, product detail, cart, checkout, `place_online_order`, confirmation + token access.
- Pending-order queue, `update_order_status`, ship/deliver, `cancel_order` (incl. in-person reversal window), customers.
- **Exit:** a real online order flows browse → checkout → confirm → ship → complete, and cancels restock exactly once.

### Slice D — Reporting and hardening (Phases 6–7) — **met**
- Dashboard, Sales, Analytics, Settings, CSV export. ✅
- Edge-case tests, responsive QA, low-stock alerts, polish. ✅
- Contrast measured in the browser and gated in `verify`; the dead dark palette removed. ✅
- Pending-order queue with `expires_at` surfaced, on the dashboard and as a nav badge. ✅
- **Exit:** reports reconcile with the ledger; release checklist complete. ✅
  Every figure on every report is read from a reporting view that excludes
  cancelled and returned orders, so the property is a fact about *where the
  number comes from* rather than about a page (D61, D70).

Storefront (4) may be swapped with online order ops (5) if preferred; 1–3 must precede both.

## What must be implemented first

Auth + schema + products/inventory + POS. POS is the primary daily flow and exercises every hard invariant, so it forces the schema and RPC contracts to be right early.

## Explicitly deferred

Online payment gateway and `payment_events`; automated expiry job; full returns/exchanges; customer accounts; OTP order lookup; duplicate customer merge; staff roles; coupons; multi-warehouse; tax/GST engine; email/SMS notifications; barcode label printing.

## Deployment and environments

- **Local → dev → production**, all Supabase; migrations in `supabase/migrations`, applied via the CLI only.
- **Vercel** preview per branch, production from `main`.
- **Auth:** public sign-up disabled; create the admin user in the dashboard; seed one `admin_users` row.
- **Storage:** `product-images` bucket with public read + admin write.
- **Seed:** default `settings` row and a starter category set.
- **Secrets:** Supabase URL + anon key public; service-role key server-only; none in the repo.
- **Backups:** Supabase automated backups; manual export before risky migrations.

## Items requiring confirmation — resolved

| # | Question | Resolution |
|---|---|---|
| 1 | Tax/GST: tax-inclusive, or a required breakdown on receipts? | **Neither in v1.** The schema has no tax columns and nothing computes tax, so the honest reading is tax-exclusive with no breakdown. Inventing a tax line would have changed what `total` means — a schema change, not a UI decision. D60 |
| 2 | Defaults: `online_order_hold_hours` 48, `in_person_reversal_window_hours` 24, shipping fee, COD by default? | **48 h, 24 h**, both in `settings` and read by the RPCs — never hard-coded. Shipping fee and COD are settings, read per request, with COD re-checked inside `place_online_order` so a stale form cannot force a method the seller has switched off. D60 |
| 3 | Online orders decrement stock at placement with `expires_at` holds? | **Confirmed.** The hold is now visible to the admin, which was the actual gap: `expires_at` was read nowhere in the admin UI, so a seller saw a pending order and never its deadline. Queue, dashboard card, nav badge and detail line (D75) |
| 4 | Email/SMS confirmation soon, or manual contact? | **Manual for v1.** A token-based bookmarkable link is the whole access model (D10, D59); notifications are deferred |
| 5 | Does product condition (sealed/loose) or per-unit uniqueness ever matter? | **No, not for v1.** Every unit is fungible: stock is a count and movements are deltas. Per-unit identity would change the inventory model from a count to a set of serials |
| 6 | Confirm the RPC-write-only rule for `orders`/`order_items`/`order_status_history` | **Confirmed**, D31. Extended in practice to `payments` and the `inventory_*` tables, so all six ledger tables are SELECT-only to the client |
