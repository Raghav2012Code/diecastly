-- Fulfilment lifecycle: the transition matrix, the reversal window, and the
-- all-or-nothing property that goes with a refusal.
--
-- WHY THIS FILE EXISTS ALONE
--
-- Issue #19 asked for the scripts/*-assertions.sql suites to be ported so the
-- two do not drift. A topic-by-topic comparison against the ten existing pgTAP
-- files found that eleven of the thirteen topics are ALREADY covered there
-- (idempotency, restock, the payment and refund caps, price tampering, the
-- anon gallery filter, primary-image selection, the customer link, the zero
-- catalog price). Porting those again would have been duplication, not
-- coverage. Three topics existed in the plain-SQL suites and nowhere in pgTAP:
--
--   * the transition matrix
--   * the reversal window
--   * a refusal that must leave nothing behind
--
-- Those are what this file covers. The mapping is written out in
-- docs/testing.md so the remaining assertion count is explainable rather than
-- assumed.
--
-- EVERY REFUSAL PAIRED WITH A CONTROL
--
-- An assertion that only proves something is rejected passes just as well
-- against a function that rejects everything. Each illegal transition here is
-- followed by the legal one that must succeed on the same order, so the suite
-- would catch a guard that refuses indiscriminately.
--
-- TWO REFUSALS ALSO ASSERT "CHANGED NOTHING"
--
-- cancel_order restocks before it refuses a shipped order, and the reversal
-- check happens before the restock. "The call was rejected" is therefore only
-- half the claim; each of these reads the quantity immediately before the call
-- and compares it after, so a half-applied implementation cannot pass.

begin;
set search_path = public, extensions;
select plan(13);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-0000000000c4',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'edge@test.local', 'x', now(), now(), now()
);

insert into public.admin_users (id, email)
values ('00000000-0000-0000-0000-0000000000c4', 'edge@test.local');

insert into public.products (id, name, slug, sku, selling_price, purchase_cost, status)
values ('26000000-0000-0000-0000-000000000001', 'Lifecycle Item', 'lifecycle-item', 'LC-1', 100, 40, 'active');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c4","role":"authenticated"}';

select public.set_initial_stock('26000000-0000-0000-0000-000000000001', 20, 40);

-- The order the transition assertions share. Its id is read back rather than
-- carried in a variable so the status history reads it in a later session too.
select public.place_online_order(
  '[{"productId":"26000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
  '{"name":"Edge Buyer","phone":"9900000090"}'::jsonb,
  'upi'::public.payment_method,
  '{"addressLine1":"1 St","city":"Pune","state":"MH","postalCode":"411001"}'::jsonb,
  null, 'pgtap-lifecycle-1'
);

-- ---------------------------------------------------------------------------
-- The transition matrix: only the single next step is legal.
-- ---------------------------------------------------------------------------

-- Skipping two steps.
select throws_ok(
  $$ select public.update_order_status(
       (select id from public.orders where idempotency_key = 'pgtap-lifecycle-1'),
       'shipped'::public.order_status, null, null, null) $$,
  'P0001', 'invalid_transition',
  'a transition that skips two steps is refused'
);

-- CONTROL: the legal single step on the same order must be accepted. Without
-- this, "everything is refused" would pass every assertion below.
select lives_ok(
  $$ select public.update_order_status(
       (select id from public.orders where idempotency_key = 'pgtap-lifecycle-1'),
       'confirmed'::public.order_status, null, null, null) $$,
  'the next single step is accepted'
);

select is(
  (select status from public.orders where idempotency_key = 'pgtap-lifecycle-1'),
  'confirmed'::public.order_status,
  'the order advanced to confirmed'
);

-- Backwards.
select throws_ok(
  $$ select public.update_order_status(
       (select id from public.orders where idempotency_key = 'pgtap-lifecycle-1'),
       'pending'::public.order_status, null, null, null) $$,
  'P0001', 'invalid_transition',
  'moving backwards is refused'
);

-- The same target a second time: the order has already left that state.
select throws_ok(
  $$ select public.update_order_status(
       (select id from public.orders where idempotency_key = 'pgtap-lifecycle-1'),
       'confirmed'::public.order_status, null, null, null) $$,
  'P0001', 'invalid_transition',
  'repeating a step already taken is refused'
);

-- ---------------------------------------------------------------------------
-- cancelled and returned are not statuses you set; they are routes you take.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.update_order_status(
       (select id from public.orders where idempotency_key = 'pgtap-lifecycle-1'),
       'cancelled'::public.order_status, null, null, null) $$,
  'P0001', 'use_cancel_order',
  'cancelled is routed to cancel_order rather than set directly'
);

select throws_ok(
  $$ select public.update_order_status(
       (select id from public.orders where idempotency_key = 'pgtap-lifecycle-1'),
       'returned'::public.order_status, null, null, null) $$,
  'P0001', 'use_cancel_order',
  'returned is routed to cancel_order rather than set directly'
);

-- ---------------------------------------------------------------------------
-- A shipped order cannot be cancelled, and the refusal must move nothing.
-- ---------------------------------------------------------------------------

select public.place_online_order(
  '[{"productId":"26000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
  '{"name":"Shipped Buyer","phone":"9900000092"}'::jsonb,
  'upi'::public.payment_method,
  '{"addressLine1":"1 St","city":"Pune","state":"MH","postalCode":"411001"}'::jsonb,
  null, 'pgtap-lifecycle-2'
);

-- Walk it up to shipped, one legal step at a time.
select public.update_order_status(
  (select id from public.orders where idempotency_key = 'pgtap-lifecycle-2'),
  'confirmed'::public.order_status, null, null, null);
select public.update_order_status(
  (select id from public.orders where idempotency_key = 'pgtap-lifecycle-2'),
  'packed'::public.order_status, null, null, null);
select public.update_order_status(
  (select id from public.orders where idempotency_key = 'pgtap-lifecycle-2'),
  'shipped'::public.order_status, null, 'Delhivery', 'LC-TRK-1');

-- Read immediately before the call, because the refusal assertion below is only
-- meaningful against the value this operation started from.
create temporary table pre_cancel (quantity integer);
insert into pre_cancel
select quantity from public.inventory_stock
 where product_id = '26000000-0000-0000-0000-000000000001';

select throws_ok(
  $$ select public.cancel_order(
       (select id from public.orders where idempotency_key = 'pgtap-lifecycle-2'),
       'too late to cancel', true, true, null) $$,
  'P0001', 'invalid_transition',
  'a shipped order cannot be cancelled'
);

-- The second half of the claim. cancel_order restocks BEFORE it refuses, so
-- rejection alone would pass against an implementation that had already
-- returned the stock to the shelf.
select is(
  (select quantity from public.inventory_stock
    where product_id = '26000000-0000-0000-0000-000000000001'),
  (select quantity from pre_cancel),
  'the refused cancellation moved no stock'
);

-- ---------------------------------------------------------------------------
-- The in-person reversal window, in both directions.
--
-- The window is compared against the order's own timestamp, so the sale has to
-- be genuinely old. Rewriting created_at is a direct table write, which is
-- correct HERE and only here: this is a test arranging a fixture, not the
-- application moving an order. Nothing in src/ does this.
-- ---------------------------------------------------------------------------

select public.record_in_person_sale(
  '[{"productId":"26000000-0000-0000-0000-000000000001","quantity":1,"unitPrice":100}]'::jsonb,
  'cash'::public.payment_method,
  null, null, 'old sale', 'pgtap-lifecycle-3'
);

-- Ten days old, against the 24-hour default window.
update public.orders
   set created_at = now() - interval '10 days'
 where idempotency_key = 'pgtap-lifecycle-3';

create temporary table pre_reversal (quantity integer);
insert into pre_reversal
select quantity from public.inventory_stock
 where product_id = '26000000-0000-0000-0000-000000000001';

select throws_ok(
  $$ select public.cancel_order(
       (select id from public.orders where idempotency_key = 'pgtap-lifecycle-3'),
       'too late', true, true, null) $$,
  'P0001', 'outside_reversal_window',
  'an in-person sale outside the reversal window is refused'
);

select is(
  (select quantity from public.inventory_stock
    where product_id = '26000000-0000-0000-0000-000000000001'),
  (select quantity from pre_reversal),
  'the refused reversal moved no stock'
);

-- CONTROL: the same sale one hour old IS reversible. Without this the file
-- would pass against a cancel_order that refused everything.
update public.orders
   set created_at = now() - interval '1 hour'
 where idempotency_key = 'pgtap-lifecycle-3';

select lives_ok(
  $$ select public.cancel_order(
       (select id from public.orders where idempotency_key = 'pgtap-lifecycle-3'),
       'customer changed mind', true, false, null) $$,
  'a sale inside the window is reversible'
);

select is(
  (select status from public.orders where idempotency_key = 'pgtap-lifecycle-3'),
  'cancelled'::public.order_status,
  'the reversible sale is now cancelled'
);

select * from finish();
rollback;
