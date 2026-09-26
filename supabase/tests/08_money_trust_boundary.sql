-- Money trust boundary invariants.
--
--   * an anonymous caller cannot influence the price of an online order
--   * a sale recorded with no payment records no payment
--   * the stored subtotal equals the sum of the stored line totals
--   * a recorded payment may not exceed the outstanding balance
--
-- Requires a real PostgreSQL 18 with a Supabase shim. These assertions have
-- not been executed: the development machine has no Docker and no local
-- PostgreSQL, so `supabase test db` cannot run there.

begin;
set search_path = public, extensions;
select plan(21);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'owner@test.local', 'x', now(), now(), now()
);

insert into public.admin_users (id, email)
values ('00000000-0000-0000-0000-0000000000c1', 'owner@test.local');

insert into public.products (id, name, slug, sku, selling_price, purchase_cost, status)
values
  ('21000000-0000-0000-0000-000000000001', 'Online Priced', 'tb-online-priced', 'TB-001', 500, 200, 'active'),
  ('21000000-0000-0000-0000-000000000002', 'Online Second',  'tb-online-second',  'TB-002', 300, 100, 'active'),
  ('21000000-0000-0000-0000-000000000003', 'Zero Price',     'tb-zero-price',     'TB-003', 0,   50,  'active'),
  ('21000000-0000-0000-0000-000000000004', 'Credit Sale',    'tb-credit-sale',    'TB-004', 250, 100, 'active'),
  ('21000000-0000-0000-0000-000000000005', 'Cap Target',     'tb-cap-target',     'TB-005', 400, 150, 'active'),
  -- Sub-paisa precision in the catalog, to exercise the rounding path.
  ('21000000-0000-0000-0000-000000000006', 'Odd Cents',      'tb-odd-cents',      'TB-006', 0.005, 0, 'active');

select public.set_initial_stock('21000000-0000-0000-0000-000000000001', 20, 200);
select public.set_initial_stock('21000000-0000-0000-0000-000000000002', 20, 100);
select public.set_initial_stock('21000000-0000-0000-0000-000000000003', 20, 50);
select public.set_initial_stock('21000000-0000-0000-0000-000000000004', 20, 100);
select public.set_initial_stock('21000000-0000-0000-0000-000000000005', 20, 150);
select public.set_initial_stock('21000000-0000-0000-0000-000000000006', 20, 0);

-- Deliberately NO admin session from here on: the price cases must hold for an
-- anonymous caller, which is how the storefront reaches place_online_order.
select set_config('request.jwt.claims', '{}', true);

-- ===========================================================================
-- An anonymous caller cannot set the price of an online order.
-- ===========================================================================

-- Under-charging: one rupee instead of the catalog's 500.
select lives_ok(
  $$ select public.place_online_order(
       '[{"productId":"21000000-0000-0000-0000-000000000001","quantity":1,"unitPrice":1}]'::jsonb,
       '{"name":"Tamper Low","phone":"9876500001"}'::jsonb,
       'upi'::public.payment_method,
       '{"line1":"1 Test St","city":"Bengaluru","state":"KA","postal_code":"560001","country":"India"}'::jsonb,
       null, 'tb-price-low'::text) $$,
  'an anonymous caller can submit a tampered price without error'
);

select is(
  (select unit_price from public.order_items
    where order_id = (select id from public.orders where idempotency_key = 'tb-price-low')),
  500::numeric(12, 2),
  'a tampered unit price is ignored and the catalog price is stored'
);

select is(
  (select total from public.orders where idempotency_key = 'tb-price-low'),
  500::numeric(12, 2),
  'a tampered price does not reach the stored order total'
);

-- Over-charging must be ignored too, not just under-charging.
select lives_ok(
  $$ select public.place_online_order(
       '[{"productId":"21000000-0000-0000-0000-000000000001","quantity":1,"unitPrice":999999}]'::jsonb,
       '{"name":"Tamper High","phone":"9876500002"}'::jsonb,
       'upi'::public.payment_method,
       '{"line1":"1 Test St","city":"Bengaluru","state":"KA","postal_code":"560001","country":"India"}'::jsonb,
       null, 'tb-price-high'::text) $$,
  'an anonymous caller can submit an inflated price without error'
);

select is(
  (select total from public.orders where idempotency_key = 'tb-price-high'),
  500::numeric(12, 2),
  'an inflated price is ignored as well'
);

-- A tampered line discount must not survive either.
select lives_ok(
  $$ select public.place_online_order(
       '[{"productId":"21000000-0000-0000-0000-000000000001","quantity":1,"lineDiscount":400}]'::jsonb,
       '{"name":"Tamper Discount","phone":"9876500003"}'::jsonb,
       'upi'::public.payment_method,
       '{"line1":"1 Test St","city":"Bengaluru","state":"KA","postal_code":"560001","country":"India"}'::jsonb,
       null, 'tb-price-discount'::text) $$,
  'an anonymous caller can submit a tampered line discount without error'
);

select is(
  (select discount_total from public.orders where idempotency_key = 'tb-price-discount'),
  0::numeric(12, 2),
  'a tampered line discount is ignored on the online channel'
);

-- A product with no sellable price must be refused, not sold at a tampered one.
select throws_ok(
  $$ select public.place_online_order(
       '[{"productId":"21000000-0000-0000-0000-000000000003","quantity":1,"unitPrice":1}]'::jsonb,
       '{"name":"Zero Price","phone":"9876500004"}'::jsonb,
       'upi'::public.payment_method,
       '{"line1":"1 Test St","city":"Bengaluru","state":"KA","postal_code":"560001","country":"India"}'::jsonb,
       null, 'tb-price-zero'::text) $$,
  '22023', 'invalid_unit_price',
  'a product whose catalog price is zero is refused rather than sold at a tampered price'
);

-- The lane must stay open: no session, and the order still decrements stock.
select is(
  (select quantity from public.inventory_stock
    where product_id = '21000000-0000-0000-0000-000000000001'),
  18,
  'a genuine anonymous order still decrements stock exactly once'
);

select is(
  (select count(*)::integer from public.order_status_history
    where order_id = (select id from public.orders where idempotency_key = 'tb-price-low')),
  1,
  'an anonymous order still records its status history'
);

-- ===========================================================================
-- A sale with no payment records no payment.
-- ===========================================================================

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}',
  true
);

-- p_payments omitted entirely.
select lives_ok(
  $$ select public.record_in_person_sale(
       '[{"productId":"21000000-0000-0000-0000-000000000004","quantity":1,"unitPrice":250}]'::jsonb,
       'cash'::public.payment_method, null, null, null, 'tb-no-pay-null'::text) $$,
  'a sale with no payments argument is recorded'
);

select is(
  (select count(*)::integer from public.payments
    where order_id = (select id from public.orders where idempotency_key = 'tb-no-pay-null')),
  0,
  'a sale with no payments argument creates no payment row'
);

select is(
  (select payment_status from public.v_order_financials
    where order_id = (select id from public.orders where idempotency_key = 'tb-no-pay-null')),
  'unpaid',
  'a sale with no payment derives unpaid, not paid'
);

select is(
  (select balance from public.v_order_financials
    where order_id = (select id from public.orders where idempotency_key = 'tb-no-pay-null')),
  250::numeric(12, 2),
  'a sale with no payment still owes the full total'
);

-- An explicitly empty array must behave identically to omitting the argument.
select lives_ok(
  $$ select public.record_in_person_sale(
       '[{"productId":"21000000-0000-0000-0000-000000000004","quantity":1,"unitPrice":250}]'::jsonb,
       'cash'::public.payment_method, '[]'::jsonb, null, null, 'tb-no-pay-empty'::text) $$,
  'a sale with an empty payments array is recorded'
);

select is(
  (select count(*)::integer from public.payments
    where order_id = (select id from public.orders where idempotency_key = 'tb-no-pay-empty')),
  0,
  'an empty payments array creates no payment row either'
);

-- Fulfilment is independent of payment: the goods changed hands regardless.
select is(
  (select status::text from public.orders where idempotency_key = 'tb-no-pay-null'),
  'completed',
  'an unpaid in-person sale is still fulfilled'
);

select is(
  (select count(*)::integer from public.inventory_movements
    where movement_type = 'sale'
      and reference_id = (select id from public.orders where idempotency_key = 'tb-no-pay-null')),
  1,
  'an unpaid in-person sale still writes its sale movement'
);

-- The unpaid state is settleable, not terminal.
select is(
  (public.record_payment(
     (select id from public.orders where idempotency_key = 'tb-no-pay-null'),
     250, 'cash'::public.payment_method, 'settled later', 'tb-no-pay-settle'::text
   ) #>> '{financials,payment_status}'),
  'paid',
  'an unpaid sale can be settled later by the normal payment path'
);

-- ===========================================================================
-- The stored subtotal equals the sum of the stored line totals.
-- ===========================================================================

select lives_ok(
  $$ select public.record_in_person_sale(
       '[{"productId":"21000000-0000-0000-0000-000000000006","quantity":3,"lineDiscount":0.005},
         {"productId":"21000000-0000-0000-0000-000000000006","quantity":1,"lineDiscount":0}]'::jsonb,
       'cash'::public.payment_method, null, null, null, 'tb-rounding'::text) $$,
  'a multi-line sale with sub-paisa input is recorded'
);

select is(
  (select o.subtotal from public.orders o where o.idempotency_key = 'tb-rounding'),
  (select sum(i.line_total) from public.order_items i
    where i.order_id = (select id from public.orders where idempotency_key = 'tb-rounding')),
  'the stored subtotal equals the sum of the stored line totals'
);

select is(
  (select o.cost_total from public.orders o where o.idempotency_key = 'tb-rounding'),
  (select sum(i.unit_cost * i.quantity) from public.order_items i
    where i.order_id = (select id from public.orders where idempotency_key = 'tb-rounding')),
  'the stored cost total equals the sum of the stored line costs'
);

-- ===========================================================================
-- A recorded payment may not exceed the outstanding balance.
-- ===========================================================================

select lives_ok(
  $$ select public.record_in_person_sale(
       '[{"productId":"21000000-0000-0000-0000-000000000005","quantity":1,"unitPrice":400}]'::jsonb,
       'cash'::public.payment_method,
       '[{"amount":100,"method":"cash"}]'::jsonb, null, null, 'tb-cap-partial'::text) $$,
  'a partially paid sale is recorded'
);

-- Exactly the balance is the boundary and must be accepted.
select is(
  (public.record_payment(
     (select id from public.orders where idempotency_key = 'tb-cap-partial'),
     300, 'cash'::public.payment_method, 'settle', 'tb-cap-settle'::text
   ) #>> '{financials,payment_status}'),
  'paid',
  'a payment equal to the outstanding balance is accepted'
);

select is(
  (select balance from public.v_order_financials
    where order_id = (select id from public.orders where idempotency_key = 'tb-cap-partial')),
  0::numeric(12, 2),
  'settling the balance leaves no balance'
);

select throws_ok(
  $$ select public.record_payment(
       (select id from public.orders where idempotency_key = 'tb-cap-partial'),
       1, 'cash'::public.payment_method, 'one too many', 'tb-cap-over'::text) $$,
  'P0001', 'over_payment',
  'a payment above the outstanding balance is rejected'
);

-- The refund cap must still hold after the payment cap is added.
select throws_ok(
  $$ select public.refund_payment(
       (select id from public.orders where idempotency_key = 'tb-cap-partial'),
       500, 'cash'::public.payment_method, 'too much', 'tb-cap-over-refund'::text) $$,
  'P0001', 'over_refund',
  'the refund cap is unaffected by the payment cap'
);

-- A retry of an already-successful payment still returns the original result
-- rather than being rejected by the cap it has already passed.
select is(
  (public.record_payment(
     (select id from public.orders where idempotency_key = 'tb-cap-partial'),
     300, 'cash'::public.payment_method, 'settle again', 'tb-cap-settle'::text
   ) #>> '{financials,payment_status}'),
  'paid',
  'retrying a settled payment with the same key still succeeds'
);

select is(
  (select count(*)::integer from public.payments where idempotency_key = 'tb-cap-settle'),
  1,
  'retrying a settled payment writes no second row'
);

select * from finish();
rollback;
