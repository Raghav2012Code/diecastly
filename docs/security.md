# Diecastly — Security

Approved security reference.

## 1. Authentication

- Only **admin users** authenticate, via Supabase Auth email/password.
- Public sign-up is **disabled**; admin users are created through the Supabase dashboard/CLI.
- Customer accounts do not exist. Customers never authenticate.
- `middleware.ts` redirects unauthenticated `/admin/*` requests to `/admin/login`. Middleware is UX convenience only; it is not the security boundary.

## 2. Admin authorization

- `is_admin()` — `security definer`, `stable`, `set search_path = ''`, body:
  `exists (select 1 from public.admin_users where id = auth.uid() and is_active)`.
- Execute granted to `authenticated`; **not** to `anon`.
- Because the table is a membership table, adding a second admin requires only a row — no schema change.
- Every admin RPC re-asserts `is_admin()` at entry (see §4).

## 3. RLS policies (allowlist; default deny)

| Table | anon | authenticated (admin) |
|---|---|---|
| `admin_users` | none | No client access at all. A self-select policy exists but there is no table grant, so the policy gates nothing; `is_admin()` is `security definer` and reads the table as its owner. Stronger than the policy implies. |
| `suppliers` | none | full via `is_admin()` |
| `categories` | SELECT where `is_active` | full |
| `products` | SELECT where `status = 'active'` (via `v_products_public`) | full |
| `product_images` | SELECT where parent product active | full |
| `customers` | none | full |
| `settings` | none (via `v_public_settings`) | full |
| `inventory_stock` | none | **SELECT only — no insert/update/delete policy** |
| `inventory_movements` | none | **SELECT only (append-only via RPC)** |
| `orders` | none | **SELECT only** |
| `order_items` | none | **SELECT only** |
| `order_status_history` | none | **SELECT only** |
| `payments` | none | **SELECT only** |

Rule of thumb: **anything financial or stock-related is RPC-write-only.** Only pure metadata (products, categories, suppliers, images, settings, customers) accepts direct RLS writes.

Public views (`v_products_public`, `v_product_images_public`, `v_categories_public`, `v_public_settings`) are **definer** views that expose only safe columns, and anon is granted **no** base-table privileges at all. (Invoker views are deliberately not used here: RLS is row-level, so invoker views plus an anon table grant would expose sensitive columns such as `purchase_cost`.)

`v_product_images_public` exists because the product gallery needs every image, not just the primary one, and `v_products_public` carries only `primary_image_path`. It is a separate view rather than a widened grant on `product_images`: granting anon that table would expose every column of every image row for every product, **including drafts and archived products**, whose photography must stay private. The view filters to `status = 'active'` products, and both that filter and the grant are asserted in `scripts/catalog-assertions.sql` — a new object reachable by anon is a new public surface, so it is tested rather than assumed.

## 4. Security-definer function requirements

Every RPC must:

- Declare `SECURITY DEFINER`.
- Declare `SET search_path = ''` and schema-qualify every referenced object (prevents `search_path` hijacking).
- Be owned by a role with the required privileges.
- `REVOKE EXECUTE ON FUNCTION … FROM PUBLIC`, then `GRANT EXECUTE` narrowly:
  - **Admin RPCs** → `authenticated` only, and each begins by asserting `is_admin()` (definer bypasses RLS, so the assertion is the guard).
  - **Storefront RPCs** (`place_online_order`, `get_order_by_access`) → `anon, authenticated`.
- Validate all inputs internally; never trust client-supplied totals, prices, or ids.
- **Every expected failure raises a recognisable code, and the message carries the specific code.** All business-rule failures raise `P0001`, invalid parameters raise `22023`, and authorization failures raise `42501`; within those, the *message* is the specific machine-readable token (`'insufficient_stock'`, `'over_refund'`, `'over_payment'`, …). The interface's error-translation module maps every one of those tokens to a friendly message.
- **Distinct SQLSTATEs per failure were considered and rejected (D49).** The intent here previously read "raise distinct SQLSTATEs". Measured on PostgreSQL 18 rather than assumed: custom five-character codes *are* accepted and *are* catchable by name — but a custom code is **no longer caught by `exception when sqlstate 'P0001'`, so any generic handler silently stops matching, and 7 existing invariant assertions pin the expected SQLSTATE. Since the user-visible defect was already closed by mapping all 24 tokens to friendly messages, converting the codes would be a public-contract change with no remaining user benefit.
- `already_cancelled` is deliberately **not** a code: a repeat cancellation returns the existing result idempotently rather than raising.
- **A unit test enumerates the raised tokens as a literal list and fails if any is unmapped**, so a newly raised code cannot reach the interface as a generic failure. Adding a code without a message breaks the build.
- Return only the data the caller is entitled to.

The Supabase `service_role` key bypasses RLS and is used **server-side only**; it is never exposed to the browser.

## 5. RPC security and responsibilities

| RPC | Caller | Responsibility |
|---|---|---|
| `record_in_person_sale` | admin | Atomic: decrement stock, `sale` movements, order (`completed`), items (cost snapshot), payments; idempotency key dedupes retries |
| `place_online_order` | anon | Atomic: upsert customer, decrement stock, `sale` movements, order (`pending`, `expires_at`), return `access_token`; idempotency key dedupes retries |
| `cancel_order` | admin | Atomic: validate state/window, restock once, optional refund, status history |
| `update_order_status` | admin | Validate transition matrix, stamp timestamps, write history |
| `record_payment` | admin | Append `received` payment; never changes fulfillment status; idempotency key reuses the original result |
| `refund_payment` | admin | Append compensating negative payment; never changes fulfillment status |
| `restock_product` | admin | `+qty`, `restock` movement, optional current-cost update |
| `adjust_stock` | admin | Signed change, `adjustment`/`damage`/`loss`/`return` movement |
| `set_initial_stock` | admin | First `initial` movement for a new product; idempotent — a retry returns the existing result and cannot double stock. Optionally updates `products.purchase_cost`, the one place a stock RPC writes product metadata; the current caller never passes a cost, so that branch is dormant |
| `get_order_by_access` | anon | Read one order only when number + token match |
| `update_order_notes` | admin | Edit non-financial notes (kept out of direct table writes) |
| `set_primary_image` | admin | Make one image the product's primary; exactly one primary afterwards (D48) |
| `reorder_product_images` | admin | Set a product's image display order in one transaction; rejects a partial or foreign set (D47) |
| `delete_product_image` | admin | Delete an image and promote a successor in the same transaction; returns the storage path (D47, D48) |

Each RPC invocation is one implicit transaction; any `RAISE` rolls back everything. The client never orchestrates multi-step financial operations.

**Idempotency is enforced server-side**: a repeated key returns the original successful result where practical, and a conflicting reuse (for example a provider payment id) is rejected. UI guards are supplementary only.

## 6. Guest order access-token model

- `orders.access_token` is a 122-bit `gen_random_uuid()`, unique, generated at order creation.
- Returned exactly once by `place_online_order`, shown on the confirmation page.
- `get_order_by_access(order_number, token)` requires **both**; a missing/incorrect token returns a generic "Order not found" — no information leak.
- Phone/email are linking keys only and **never** authorize access to an order. Note the corollary: a caller must not be able to *obtain* a token by guessing one, which is why a reused `idempotency_key` raises `idempotency_conflict` instead of replaying another request's order (D50).
- The storefront **links** to a customer record but never modifies one (D51). `customers` is admin-only under RLS, but `place_online_order` is `security definer` and granted to `anon`, so a clobbering upsert there would let any anonymous caller rewrite a customer's name and email.
- The token is a bearer secret: never logged, excluded from list payloads, never included in admin tables.
- Admin can rotate a token if a link leaks.
- A future email/SMS one-time-code lookup can be added without schema changes.

## 7. Storage security

- Bucket `product-images`: public **read**, admin-only **write**/update/delete (storage policy keyed to `is_admin()`).
- Uploads validated by content type and size; paths are server-generated to avoid collisions.
- No customer-uploaded content exists in v1. UPI payment screenshots are referenced by note/reference only — no public bucket.

## 8. Payment security

- `payments` is append-only and the single source of truth. There are no client insert/update/delete policies; only `record_payment`/`refund_payment` write.
- Financial amounts are derived in `v_order_financials`; there is no editable `amount_paid` or `payment_status`.
- Corrections are compensating entries, never edits — preserving the audit trail.
- Idempotency: `payments.idempotency_key` unique — a retry with the same key **returns the original result**; `UNIQUE (provider, provider_payment_id)` where not null **rejects a different payment reusing an already-seen provider id**.
- Payment writes never change fulfillment status; recording full payment does not confirm an order.
- Gateway-forward (not built in v1): an Edge Function verifies the provider's signature, then calls a service-role write function. The `provider`/`provider_payment_id`/`provider_payload` columns and the unique index already make retries and duplicate webhooks safe. `payment_events` is added at that time.

## 9. Residual risks and mitigations

| Risk | Mitigation |
|---|---|
| Anon spam creates online orders that hold stock | Small volume + admin queue; `expires_at` marks holds; phase-2 auto-expiry; optional captcha |
| Barcode/SKU enumeration | No sensitive data returned; order data requires token |
| Lost/stale confirmation token | Admin can rotate; buyer can re-request link out-of-band |
| Logged-in non-admin account | RLS returns nothing; no admin_users row ⇒ no access |
