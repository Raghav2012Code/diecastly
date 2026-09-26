# Diecastly — Database

Approved schema reference. Currencies are INR. All money is `numeric(12,2)` — never floating point.

## 1. Enumerated types

| Enum | Values |
|---|---|
| `product_status` | `draft`, `active`, `archived` |
| `order_channel` | `in_person`, `online` |
| `order_status` | `pending`, `confirmed`, `packed`, `shipped`, `delivered`, `completed`, `cancelled`, `returned` |
| `payment_method` | `cash`, `upi`, `cod`, `card`, `bank_transfer`, `other` |
| `payment_provider` | `manual`, `razorpay`, `stripe` |
| `payment_record_status` | `pending`, `authorized`, `received`, `failed`, `refunded` |
| `movement_type` | `initial`, `restock`, `sale`, `order_cancel`, `adjustment`, `damage`, `loss`, `return` |

## 2. Identity

**`admin_users`** — membership table; more than one admin is supported without redesign.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `= auth.users(id)`, `on delete cascade` |
| `email` | text | |
| `display_name` | text | |
| `is_active` | boolean default true | |
| `created_at` | timestamptz default now() | |

`is_admin()` checks membership + `is_active` against `auth.uid()`.

## 3. Catalog (metadata — RLS writes)

**`suppliers`** — `id`, `name`, `contact_name`, `phone`, `email`, `notes`, `is_active`, timestamps.

**`categories`** — `id`, `name`, `slug (unique)`, `parent_id → categories (set null)`, `sort_order`, `is_active`, timestamps. One self-nesting taxonomy covers both category and series.

**`products`** — metadata only; **no stock column**.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text not null | |
| `slug` | text unique not null | public URL |
| `brand`, `model`, `series` | text | |
| `category_id` | uuid → categories (set null) | |
| `supplier_id` | uuid → suppliers (set null) | |
| `description` | text | |
| `sku` | text unique | |
| `barcode` | text unique | nullable |
| `purchase_cost` | numeric(12,2) not null default 0 | current/default cost; snapshot at sale |
| `selling_price` | numeric(12,2) not null default 0 | default price; overridable at sale |
| `low_stock_threshold` | int not null default 0 | |
| `status` | product_status not null default draft | |
| `is_featured` | boolean default false | |
| `created_by` | uuid → auth.users | |
| `created_at`, `updated_at` | timestamptz | |

**`product_images`** — `id`, `product_id → products (cascade)`, `storage_path`, `alt_text`, `sort_order`, `is_primary`. Partial unique index ensures one primary image per product.

## 4. Inventory (RPC writes only)

**`inventory_stock`** — the authoritative current quantity, kept separate from `products` so metadata edits can never touch stock.

| Column | Type | Notes |
|---|---|---|
| `product_id` | uuid PK → products (cascade) | |
| `quantity` | int not null default 0 | `CHECK (quantity >= 0)` |
| `updated_at` | timestamptz | |

**`inventory_movements`** — append-only audit ledger. Every stock change writes exactly one movement in the same transaction as the stock update.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `product_id` | uuid not null → products (restrict) | |
| `delta` | int not null | `CHECK (delta <> 0)` |
| `quantity_after` | int not null | from the conditional update's RETURNING |
| `movement_type` | movement_type not null | |
| `reference_type` | text | `order` or `manual` |
| `reference_id` | uuid | order id when applicable |
| `unit_cost` | numeric(12,2) | cost captured for that movement |
| `note` | text | |
| `source` | text not null | `admin`, `storefront`, or `system` |
| `actor_id` | uuid → auth.users | |
| `created_at` | timestamptz default now() | |

Indexes: `(product_id, created_at desc)`, `(reference_id)`.
Partial unique index on `(reference_id, product_id)` where `movement_type = 'order_cancel'` — guarantees a sale is restocked at most once.
Partial unique index on `(product_id)` where `movement_type = 'initial'` — a product's opening stock can be initialized at most once.

**Reference contract (enforced by CHECK):**
- `sale`, `order_cancel` ⇒ `reference_type = 'order'` and `reference_id IS NOT NULL`.
- `initial`, `restock`, `adjustment`, `damage`, `loss` ⇒ `reference_id IS NULL`.
- `return` ⇒ manual in v1. The CHECK permits `reference_id IS NULL` **or** `reference_type = 'order'`, so an order-linked return is allowed by the schema and simply not built yet; see the constraint comment in the inventory migration.
The RPC layer must set these consistently; the constraint makes violations impossible to persist.

Current stock is queried through the `v_product_stock` view.

## 5. Customers

**`customers`** — `id`, `name`, `phone_normalized (unique)`, `email`, `address_line1`, `address_line2`, `city`, `state`, `postal_code`, `country`, `notes`, timestamps.

Phone/email **link** orders to a customer for the seller's history. They never authorize viewing an order. Orders snapshot name/phone/email so later edits do not rewrite history. Customer metrics are derived from views, never stored counters. Duplicate merge is deferred.

## 6. Orders

**`orders`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `order_number` | text unique not null | sequence, `DC-YYYY-#####` |
| `channel` | order_channel not null | |
| `status` | order_status not null default pending | fulfillment state |
| `customer_id` | uuid → customers (set null) | |
| `customer_name`, `customer_phone`, `customer_email` | text | snapshots |
| `shipping_address` | jsonb | |
| `payment_method` | payment_method | declared method at creation; **not** a financial state |
| `shipping_fee` | numeric(12,2) not null default 0 | charged to customer |
| `shipping_cost` | numeric(12,2) not null default 0 | paid by seller |
| `courier`, `tracking_number` | text | |
| `shipped_at`, `delivered_at` | timestamptz | |
| `subtotal` | numeric(12,2) not null default 0 | Σ line_total |
| `discount_total` | numeric(12,2) not null default 0 | Σ line_discount (informational) |
| `total` | numeric(12,2) not null default 0 | `subtotal + shipping_fee` |
| `cost_total` | numeric(12,2) not null default 0 | Σ(unit_cost × qty) |
| `access_token` | uuid not null unique default gen_random_uuid() | guest order access |
| `expires_at` | timestamptz | set for unpaid/pending online orders |
| `idempotency_key` | text unique | server-side dedupe for order/sale creation |
| `note` | text | free text recorded with the movement |
| `notes` | text | |
| `created_by` | uuid → auth.users | null for storefront |
| `cancel_reason` | text | |
| `cancelled_at` | timestamptz | |
| `created_at`, `updated_at` | timestamptz | |

There is **no** `amount_paid` and **no** `payment_status` column (see §8).
Constraints keep all money ≥ 0.

**`order_items`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `order_id` | uuid not null → orders (cascade) | |
| `product_id` | uuid → products (set null) | nullable so history survives |
| `product_name` | text not null | name snapshot |
| `sku` | text | SKU snapshot; nullable because `products.sku` is nullable and both sale functions copy it verbatim |
| `quantity` | int not null | `CHECK (quantity > 0)` |
| `unit_price` | numeric(12,2) not null | **actual** sale price; `CHECK (unit_price > 0)` — v1 forbids zero-value lines |
| `unit_cost` | numeric(12,2) not null default 0 | **snapshot** cost |
| `line_discount` | numeric(12,2) not null default 0 | |
| `line_total` | numeric(12,2) **generated stored** | `unit_price*quantity - line_discount` |
| `line_profit` | numeric(12,2) **generated stored** | `(unit_price-unit_cost)*quantity - line_discount` |
| `created_at` | timestamptz | |

**`order_status_history`** — `id`, `order_id → orders (cascade)`, `from_status`, `to_status`, `note`, `changed_by`, `created_at`. Written only by the status/cancel RPCs.

## 7. Payments (manual in v1, gateway-ready)

**`payments`** — append-only.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `order_id` | uuid not null → orders (cascade) | |
| `amount` | numeric(12,2) not null | positive = received, negative = refund |
| `method` | payment_method not null | |
| `provider` | payment_provider not null default manual | |
| `status` | payment_record_status not null default received | |
| `reference` | text | UPI txn ref / note |
| `provider_payment_id`, `provider_order_id` | text | reserved for a future gateway |
| `provider_payload` | jsonb | reserved |
| `idempotency_key` | text unique | prevents duplicate entries |
| `received_at` | timestamptz | |
| `recorded_by` | uuid → auth.users | |
| `created_at`, `updated_at` | timestamptz | |

Unique partial index on `(provider, provider_payment_id)` where not null — makes a future webhook idempotent and **rejects a different payment that reuses an already-seen provider payment id**.
`payments.idempotency_key` unique — a client retry with the same key returns the original result instead of writing a duplicate.
`payment_events` is **not created in v1**; it is added with the gateway integration.

## 8. Canonical money and profit definitions

Single, non-overlapping definitions. Every report uses these.

| Term | Definition |
|---|---|
| `unit_price` | Actual selling price per unit, before discount |
| `line_discount` | Discount on that line |
| `line_total` | `unit_price × quantity − line_discount` → **actual item revenue** |
| `line_profit` | `line_total − (unit_cost × quantity)` → item revenue after item discount − item COGS |
| `cost_total` | `Σ(unit_cost × quantity)` → **item COGS only; shipping excluded** |
| `subtotal` | `Σ line_total` → net item revenue (discounts already applied) |
| `discount_total` | `Σ line_discount` → **informational only, never subtracted again** |
| `total` | `subtotal + shipping_fee` → amount the customer owes |
| **product gross profit** | `subtotal − cost_total = Σ line_profit` |
| **order contribution after shipping** | product gross profit `+ shipping_fee − shipping_cost` |

Rule: an order-level discount must be allocated into `line_discount` (or a dedicated negative line) by the pricing function. `line_total` is the sole revenue source; nothing is subtracted twice.

**Payment state is derived, never stored.** `v_order_financials` computes:

- `total_due` = `orders.total`
- `total_received` = Σ payments where status `received` and amount > 0
- `total_refunded` = Σ abs(amount) where status `refunded` and amount < 0
- `net_paid` = `total_received − total_refunded`
- `balance` = `total_due − net_paid`
- `payment_status` =
  - `refunded` if `net_paid <= 0` and `total_refunded > 0`
  - `paid` if `net_paid >= total_due` (and `total_due > 0`)
  - `partial` if `0 < net_paid < total_due`
  - `cod_pending` if `balance > 0` and `payment_method = 'cod'`
  - otherwise `unpaid`

Fulfillment status and payment status are completely independent. An in-person sale is created `completed` while its payment state is derived separately. `record_payment` and `refund_payment` **never** mutate fulfillment status, and recording full payment does not confirm an order. Fulfillment transitions happen only through the order-status RPCs.

## 9. Settings

**`settings`** — single row (`id boolean PK default true CHECK (id)`): `business_name`, `business_phone`, `business_email`, `upi_id`, `upi_qr_path`, `currency`, `cod_enabled`, `default_shipping_fee`, `low_stock_threshold_default`, `order_prefix`, `online_order_hold_hours`, `in_person_reversal_window_hours`.

All durations used by RPCs (expiry, reversal window) are read from settings — never hard-coded in multiple places.

## 10. Reporting and public views

Admin reporting (read-only): `v_order_summary`, `v_order_financials`, `v_sales_daily` (IST-day rollup), `v_product_profit`, `v_customer_summary`, `v_product_stock`, `v_products_admin`, `v_low_stock`.

Storefront (definer views exposing safe columns only; anon has **no** base-table grants): `v_products_public`, `v_categories_public`, `v_public_settings`.

## 11. Relationships

```
suppliers 1→* products
categories 1→* products (self-nesting)
products 1→* product_images
products 1→1 inventory_stock
products 1→* inventory_movements
customers 1→* orders
orders 1→* order_items
orders 1→* payments
orders 1→* order_status_history
products 1→* order_items (nullable link; snapshots preserved)
```

## 12. Data-integrity rules

- `inventory_stock.quantity >= 0` always; overselling is impossible.
- Every stock change has exactly one movement, in the same transaction.
- A sale is restocked at most once (partial unique index).
- Order totals are computed server-side inside the RPC; client-sent totals are ignored.
- `orders`/`order_items`/`order_status_history`/`payments`/`inventory_*` are **RPC-write-only** (admin has SELECT). Stored totals and financial records cannot be hand-edited.
- `unit_cost`/`unit_price` are snapshotted per line; later product or cost edits never rewrite historical profit.
- Products are archived, never hard-deleted; order history survives via snapshots.
- `order_items.unit_price > 0` in v1 (no zero-value lines).
- Opening stock (`initial` movement) can be created at most once per product.
- Same idempotency key reuses the original successful result; a different payment reusing a provider payment id is rejected.
- No tenant/workspace/organization columns exist; v1 is single-business, single-location, single-admin.
