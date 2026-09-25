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

### Slice D — Reporting and hardening (Phases 6–7)
- Dashboard, Sales, Analytics, Settings, CSV export.
- Edge-case tests, responsive QA, low-stock alerts, polish.
- **Exit:** reports reconcile with the ledger; release checklist complete.

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

## Items requiring confirmation

1. Tax/GST: tax-inclusive pricing, or a required breakdown on receipts?
2. Defaults: `online_order_hold_hours` (propose 48), `in_person_reversal_window_hours` (propose 24), `default_shipping_fee`, COD enabled by default?
3. Confirm online orders continue to decrement stock at placement with `expires_at` holds.
4. Email/SMS order confirmation soon, or manual contact for v1?
5. Does product condition (sealed/loose) or per-unit uniqueness ever matter?
6. Confirm the RPC-write-only rule for `orders`/`order_items`/`order_status_history` (decision D31).
