# Diecastly — Decision Log

Concise record of approved decisions. Newest decisions appear at the end.

| # | Decision | Rationale |
|---|---|---|
| D1 | **Single Next.js application** with `/admin` and storefront route groups | One deployable unit; no duplicated types/auth/config |
| D2 | **Supabase as the entire backend** (Postgres, Auth, Storage) | No separate API server; minimal operational surface |
| D3 | **Postgres RPCs for atomic business operations** | Guarantees inventory/order/payment consistency; overselling impossible |
| D4 | **Metadata writes use RLS directly; financial/stock writes use RPC only** | Keeps the RPC layer small and focused |
| D5 | **Separate `inventory_stock` table** from `products` | Metadata edits can never touch stock; stock writes denyable at RLS |
| D6 | **Append-only `inventory_movements` ledger** | Reliable audit trail; current stock alone is insufficient |
| D7 | **Inventory movement reference contract** enforced by CHECK | RPCs must set `reference_type`/`reference_id` consistently |
| D8 | **Stock changes use conditional atomic updates** (`quantity >= qty`) | Prevents overselling and negative inventory under concurrency |
| D9 | **Multi-item stock decrements ordered by product id** | Avoids deadlocks |
| D10 | **Token-based guest order access** (`orders.access_token`, 122-bit) | Customers cannot access another order by guessing number/phone |
| D11 | **Phone/email link orders to customers but never authenticate** | Identity for history without treating contact data as a credential |
| D12 | **Guest checkout; no customer accounts** | Lowest friction for occasional buyers |
| D13 | **Manual payments in v1** (cash, manually verified UPI, COD) | Matches how the business actually operates |
| D14 | **Gateway-ready payment schema** (`provider`, `provider_payment_id`, unique idempotency index) | Online provider can be added later without redesign |
| D15 | **`payment_events` deferred** to the gateway phase | Not needed in v1; avoids unused infrastructure |
| D16 | **`payments` is the single source of truth; payment state derived-only** | No second mutable payment state to drift |
| D17 | **No stored `orders.amount_paid` or `orders.payment_status`** | Derived in `v_order_financials` |
| D18 | **`orders.expires_at` for unpaid/pending online orders** | Marks stock holds; duration from settings |
| D19 | **No background expiry job in v1** | Phase 2; manual/admin-driven for now |
| D20 | **Expiry must reuse `cancel_order`** | One authoritative cancel/restock path |
| D21 | **`payment_status` derived-only; filters via `v_order_financials`** | Single source of truth over filter convenience |
| D22 | **Fulfillment status and payment status are independent** | In-person sale is fulfilled at recording, paid state separate |
| D23 | **In-person sale reversal window** (`settings.in_person_reversal_window_hours`, default 24) | Completed sales are not arbitrarily reversible later |
| D24 | **In-person reversal is a cancellation+reversal, not a return** | Simplest correct model; returns deferred |
| D25 | **Out-of-window returns handled manually** (`adjust_stock(return)` + `refund_payment`) | No returns system in v1 |
| D26 | **Snapshot historical product/price/cost data on order lines** | Later edits never rewrite historical profit |
| D27 | **Canonical profit model** with no double-counted discounts | Every report uses one definition |
| D28 | **Product archival, never hard deletion** | Preserves order history through snapshots |
| D29 | **Admin is desktop-first; storefront is mobile-first** | Matches actual usage |
| D30 | **Single seeded admin, but `admin_users` supports many** | No schema redesign when a helper is added |
| D31 | **`orders`/`order_items`/`order_status_history` are RPC-write-only** | Stored totals cannot be hand-edited |
| D32 | **IST used for reporting day boundaries** | Local business timezone |
| D33 | **Payments never mutate fulfillment status** | `record_payment`/`refund_payment` only touch the ledger; recording full payment does not confirm an order; fulfillment changes only via order-status RPCs |
| D34 | **POS `unit_price` must be > 0 in v1** | No zero-value lines; enforced in Zod and in a DB CHECK |
| D35 | **In-person reversal window enforced server-side in the RPC** | The UI only surfaces eligibility; the authoritative timestamp check is in `cancel_order` |
| D36 | **Opening stock initialized at most once per product** | Partial unique index on `initial` movements; `set_initial_stock` is idempotent on retry |
| D37 | **Server-side idempotency** | Same key reuses the original successful result; a different payment reusing a provider payment id is rejected; never UI-only |
| D38 | **v1 is single-business, single-location, single-admin** | No tenant/workspace/organization abstractions; multi-tenant deferred until actually required |
