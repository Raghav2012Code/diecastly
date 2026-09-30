# Diecastly — UX and Application Behavior

Approved UX reference. Admin is **desktop-first**; the storefront is **mobile-first** and responsive.

## 1. Admin shell

Persistent left sidebar: Dashboard, Record Sale, Inventory, Products, Orders, Customers, Sales, Analytics, Settings. The sidebar carries two counts — low-stock on Inventory, open orders on Orders — and the same two render below 768 px as a horizontally scrollable bar, so a phone is not stranded (D67). Top bar: signed-in email and sign-out. There is **no global search**; each list has its own. Dense tables; usable on a tablet, including POS.

## 2. Dashboard

**Today only**, and every figure is scoped to the current IST day (D32, D70) — `v_sales_daily` does the conversion, so this asks for one `sale_date`. Five KPI cards: Revenue, Units sold, Gross profit, After shipping, Open orders (links to the pending queue). Every figure comes from a view that excludes cancelled and returned orders, so the dashboard cannot show revenue for a sale that was given back.

Below: **Needs attention** (out-of-stock and low-stock counts as badges, then the low list, linking to Inventory), **Stock on hand** (units, at retail, at cost, potential margin — explicitly not a valuation), **Today so far** (item revenue, shipping charged, COGS, net of shipping), and the **pending-order queue**: unfulfilled orders oldest first, each with its stock-hold deadline, overdue ones badged, and a link to the full list when it is truncated.

There is no 30-day trend chart and no recent-orders list on the dashboard in v1; `/admin/sales` and `/admin/orders` are the surfaces for those. A failed read states the failure rather than rendering zeroes, because a grid of zeros is indistinguishable from a day with no sales.

## 3. Inventory workflow

List columns: product, SKU, current qty (`v_product_stock`), threshold, status, stock value (qty × cost), supplier. Filters: all / low / out / archived. Row actions **Restock** and **Adjust**, both returning the new quantity.

- **Restock modal:** quantity, unit cost (prefilled), optional "update current cost", note → `restock_product`. Past sale cost snapshots are untouched.
- **Adjust modal:** signed direction (or set exact), reason (adjustment / damage / loss / return), note → `adjust_stock`. A negative change beyond available stock is rejected.
- **Movement history:** per-product drawer and a global ledger page — date, type, delta, quantity after, related order, source, actor, note.
- Low-stock threshold editable inline (metadata write).

States: skeleton rows while loading; success toast showing the new quantity; inline error with retry on failure.

## 4. Record Sale (POS) — core daily screen

Two panes. **Left:** product search, auto-focused, matching name/SKU/barcode (barcode scanners work by typing + Enter), showing price and available stock. **Right:** live receipt.

- Selecting a result adds a line; selecting again increments, capped at available stock. Each line has a quantity stepper, editable **unit price** (defaults to `selling_price`; must be greater than zero — zero-value lines are rejected), and an optional **line discount**; a running total is shown.
- **Customer** is optional: "Walk-in" (anonymous) by default; search existing by phone/name or quick-add.
- **Payment:** method (Cash / UPI) and amount tendered; change due is shown for cash, but only the applied amount is recorded. Partial payment is allowed and yields derived `partial` status.
- **Complete Sale** → `record_in_person_sale`. The order is created at the fulfilled terminal state (`completed`) with independently derived payment status; stock is decremented and `sale` movements are written.
- Success → printable receipt (order number, items, totals, payment) with New Sale / Print / View Order.
- Errors: `insufficient_stock` highlights the affected line and refreshes availability; network failure keeps the cart intact for retry. Submit is disabled while in flight and carries a client idempotency key; the server reuses the original order for a repeated key.
- Shortcuts: focus search; complete sale.

## 5. Product management

List: thumbnail, name, SKU, brand, category, price, cost, stock, status; filter by status/category/brand/search. Create/Edit writes metadata via RLS (name, brand, model, category, series, description, SKU, barcode, supplier, cost, price, threshold, status, featured) and manages images in Supabase Storage (multi-upload, reorder, set primary). Opening stock entered in the form is applied by `set_initial_stock`, writing an `initial` movement — metadata stays on the RLS lane, stock on the RPC lane. If that call fails, the product simply exists at 0 stock (safe and recoverable). Products are **archived**, never hard-deleted, preserving order history. Unique slug/SKU/barcode validated inline.
Empty state: "Add your first product."

## 6. Order management

List: number, date, channel, customer, total, derived payment status, fulfillment status. Filters: status, payment status, channel, date range, plus search. A prominent **"Awaiting confirmation"** queue surfaces pending online orders (expiry shown; no auto-cancel in v1).
Detail: fulfillment pill + derived payment pill, customer snapshot, items (unit price, unit cost, line profit), totals (subtotal, discounts, shipping fee, total, cost, gross profit, contribution), payments list (method, amount, reference, received_at, who recorded), status-history timeline, shipping block (address, courier, tracking).
Actions map to RPCs: Confirm, **Mark Paid** (`record_payment`), Record Refund, Pack, Ship (courier + tracking), Delivered, Complete, Reverse/Cancel (restock and refund toggles, confirm dialog). Irreversible actions require confirmation. Print packing slip/receipt.

### 6.1 In-person sale reversal (v1 rule)

- Allowed only when `channel = 'in_person'`, `status = 'completed'`, and within `settings.in_person_reversal_window_hours` (default 24, rolling from `created_at`).
- Performed by admin from order detail via `cancel_order` with `restock = true`. The server checks the configured window against `created_at`; the UI only surfaces eligibility and is never trusted.
- **Stock is always restored**, exactly once, through the same authoritative path as any cancellation (partial unique index prevents a double restore).
- **Payment:** a compensating negative payment is appended via `refund_payment` equal to net received. Original payment rows are never edited.
- **Representation:** recorded as a cancellation with reversal (`from_status = 'completed'` in `order_status_history`) — **not** a returns system.
- **Ledger:** one `order_cancel` movement per item, source `admin`, note "in-person reversal".
- **After the window:** no automated reversal. A genuine late return is handled as a manual `adjust_stock(return, +qty)` plus `refund_payment`. A full returns/exchanges flow is deferred to a future phase.
- **Restocking a cancelled order:** a cancelled order whose cancellation was made with "Return the items to stock" **unticked** can be corrected from the same order row via **Return items to stock**. It restores the order's own line quantities (nothing is typed in), and a second press reports that the items are already back rather than doing it again. The order's status does not change — it stays cancelled, and only the stock and the movement ledger move.

## 7. Customer management

A list from `v_customer_summary`: name, phone, email, orders, total spent, last order, with search by phone/name/email. The view does the counting and the spend — and the spend **excludes** cancelled and returned orders, so a cancelled order can never appear as lifetime value.

The list is read-only in v1: there is no customer detail page and no edit path (D51 — the storefront links to a customer but never modifies one, so editing is admin metadata work that is not built). Customers are created at checkout by normalized phone, which is the linking key. Duplicate-merge is deferred and documented.
Empty state: "No customers yet — they're created automatically at checkout."

## 8. Analytics

Two surfaces, split by what the question is:

**`/admin/sales`** — a `from`/`to` date range (IST boundaries) driving Revenue, Gross profit, Contribution after shipping, and Orders, plus a by-day table over the range. CSV export for the same range; the export is a route handler, not a client download, and returns a 503 rather than a file of nothing if the read fails (D64).

**`/admin/analytics`** — lifetime, not ranged: products sold (units, revenue, profit), revenue by channel, and the top performer. CSV export, with the same 503 rule.

So the breakdowns that ship are **by day and by channel**; there is no category breakdown, no payment-method mix, and no AOV or margin-% card. Read-only from views throughout; no figure is recomputed in TypeScript from `orders` (D61).

Both reports declare their scope where a bare number would otherwise be read as "this month" or "all time" — a ranged total under an open range reads as a period the user did not choose.

## 9. Public storefront

**Catalog:** responsive grid of active products with primary image, name, brand/series, price, and stock badge (In stock / Only N left / Sold out). Category/series filters from active categories, search, and sort (newest, price, name).
**Product detail** (`/products/[slug]`): image gallery, name, brand, series, description, price, availability (available count or "Sold out"), quantity selector capped at available, Add to Cart / Buy Now, optional related items.
Loading uses skeletons; unknown slug → 404; empty category → friendly message. There is no sticky add-to-cart bar on mobile and no related-items section in v1 — the product detail is one gallery, the description, price, availability, quantity and Add to Cart. No customer login anywhere.

## 10. Cart and checkout

**Cart** is client-side (context + `localStorage`), storing product id, quantity, and a display snapshot. It is non-authoritative: price and stock are re-validated at checkout. Drawer/page supports quantity edit (capped), remove, subtotal, shipping estimate, and checkout. Price changes between add and checkout surface a clear notice. Empty state: "Your cart is empty."

**Checkout** is a single page: name and phone (required), email (optional), shipping address (required for parcels), payment method radio (UPI; COD only when enabled in settings), notes; live summary (items, subtotal, shipping fee, total). Submit calls `place_online_order` with a client idempotency key and a disabled button while in flight. Success → redirect to confirmation. Failures (sold out, price changed, validation) return to the cart with a specific message and refreshed availability.

## 11. Guest order confirmation / access

Reached via `/order/[orderNumber]?token=…`. `get_order_by_access` requires both order number and token; a missing/invalid token shows a generic "Order not found" (no information leak). The page shows status, items, totals, and payment instructions:

- **UPI:** business UPI ID + QR and amount — "pay and we'll confirm"; derived status shows awaiting confirmation.
- **COD:** "Pay on delivery."

No login; the link is bookmarkable. Phone/email never grant access. Admin can rotate the token if a link leaks. Every method is DB-authoritative — a passed `expires_at` never renders an order as cancelled.

## 12. Loading / empty / error / success

Skeletons for lists and cards; spinners on submit; **no optimistic updates** on stock or financial actions. Every empty state names the next action. Validation errors are inline; transient failures are toasts; crashes are caught by an error boundary. SQLSTATEs (`insufficient_stock`, `invalid_transition`, `already_cancelled`, `over_refund`, `product_inactive`) map to friendly messages; raw database errors are never shown. Destructive actions confirm first; success shows a toast plus refreshed state.

## 13. Important end-to-end flows

1. **Setup:** create product metadata → set opening stock → appears in inventory and (if active) on the storefront.
2. **In-person sale:** POS → search/scan → qty + price → optional customer → Cash/UPI → Complete → receipt; stock decremented by a `sale` movement; revenue and profit recorded.
3. **Online order:** browse → cart → guest checkout (UPI/COD) → `place_online_order` → stock decremented, order `pending` with `expires_at`, token issued → confirmation with UPI QR → admin records payment and confirms → ship → deliver → complete; payment status derived throughout.
4. **Reversal/cancellation:** in-person completed sale within the reversal window, or a pending/confirmed online order → single restock + optional refund → `cancelled` with history.
5. **Low stock:** item hits threshold → badge on dashboard/inventory → restock → restored.
6. **Holds:** admin reviews past-`expires_at` unpaid pending orders and cancels+restocks via the same authoritative logic; the storefront only ever reflects DB state.

## 14. UX boundaries (YAGNI)

No roles UI, multi-warehouse, coupon engine, customer accounts, returns/exchange workflow, or accounting exports beyond CSV.
