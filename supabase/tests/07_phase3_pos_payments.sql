-- Phase 3 invariants: in-person sale payments, derived payment state, refund
-- caps, payment idempotency, and the cost snapshot that protects profit.

begin;
set search_path = public, extensions;
select plan(14);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-0000000000b3',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'admin@test.local', 'x', now(), now(), now()
);

insert into public.admin_users (id, email)
values ('00000000-0000-0000-0000-0000000000b3', 'admin@test.local');

insert into public.products (id, name, slug, sku, selling_price, purchase_cost, status)
values
  ('20000000-0000-0000-0000-000000000001', 'Till Car',     'pg3-till-car', 'PG3-001', 250, 100, 'active'),
  ('20000000-0000-0000-0000-000000000002', 'Snapshot Car', 'pg3-snap-car', 'PG3-002', 300, 100, 'active');

-- Simulate an authenticated admin for auth.uid().
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}';

select public.set_initial_stock('20000000-0000-0000-0000-000000000001', 10, 100);
select public.set_initial_stock('20000000-0000-0000-0000-000000000002', 5, 100);

-- ---------------------------------------------------------------------------
-- A partial payment derives a partial state and an exact balance.
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.record_in_person_sale(
       '[{"productId":"20000000-0000-0000-0000-000000000001","quantity":2,"unitPrice":250}]'::jsonb,
       'cash'::public.payment_method,
       '[{"amount":200,"method":"cash"}]'::jsonb,
       null, null, 'pg3-partial-sale') $$,
  'a sale can be recorded with a partial payment'
);

select is(
  (select payment_status
     from public.v_order_financials
    where order_id = (select id from public.orders where idempotency_key = 'pg3-partial-sale')),
  'partial',
  'a partial payment derives a partial payment state'
);

select is(
  (select balance
     from public.v_order_financials
    where order_id = (select id from public.orders where idempotency_key = 'pg3-partial-sale')),
  300::numeric(12, 2),
  'the balance equals the amount still owed'
);

select is(
  (select count(*)::integer
     from public.inventory_movements
    where movement_type = 'sale'
      and reference_id = (select id from public.orders where idempotency_key = 'pg3-partial-sale')),
  1,
  'the sale writes exactly one sale movement linked to the order'
);

select is(
  (select quantity from public.inventory_stock
    where product_id = '20000000-0000-0000-0000-000000000001'),
  8,
  'the sale decrements stock'
);

-- ---------------------------------------------------------------------------
-- Settling the balance derives a paid state without touching fulfilment.
-- ---------------------------------------------------------------------------

select is(
  (public.record_payment(
     (select id from public.orders where idempotency_key = 'pg3-partial-sale'),
     300, 'cash'::public.payment_method, 'settle', 'pg3-settle-key'
   ) #>> '{financials,payment_status}'),
  'paid',
  'recording the outstanding balance derives a paid state'
);

select is(
  (select status::text from public.orders where idempotency_key = 'pg3-partial-sale'),
  'completed',
  'recording a payment does not change fulfilment status'
);

-- A repeated payment with the same key must not write a second row.
select public.record_payment(
  (select id from public.orders where idempotency_key = 'pg3-partial-sale'),
  300, 'cash'::public.payment_method, 'settle again', 'pg3-settle-key'
);

select is(
  (select count(*)::integer from public.payments where idempotency_key = 'pg3-settle-key'),
  1,
  'a repeated payment with the same key writes no second row'
);

-- ---------------------------------------------------------------------------
-- Refund cap: over-refund rejected, refund at the cap accepted.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.refund_payment(
       (select id from public.orders where idempotency_key = 'pg3-partial-sale'),
       600, 'cash'::public.payment_method, 'too much', 'pg3-over-refund') $$,
  'P0001',
  'over_refund',
  'refunding more than the net received is rejected'
);

select is(
  (public.refund_payment(
     (select id from public.orders where idempotency_key = 'pg3-partial-sale'),
     500, 'cash'::public.payment_method, 'full refund', 'pg3-refund-key'
   ) #>> '{financials,payment_status}'),
  'refunded',
  'a refund at the cap is accepted and derives a refunded state'
);

select is(
  (select status::text from public.orders where idempotency_key = 'pg3-partial-sale'),
  'completed',
  'a refund does not change fulfilment status'
);

-- ---------------------------------------------------------------------------
-- Cost is snapshotted on the line; a later cost edit never rewrites profit.
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.record_in_person_sale(
       '[{"productId":"20000000-0000-0000-0000-000000000002","quantity":1,"unitPrice":300}]'::jsonb,
       'upi'::public.payment_method, null, null, null, 'pg3-snap-sale') $$,
  'a second sale is recorded'
);

update public.products set purchase_cost = 999
where id = '20000000-0000-0000-0000-000000000002';

select is(
  (select unit_cost from public.order_items
    where order_id = (select id from public.orders where idempotency_key = 'pg3-snap-sale')),
  100::numeric(12, 2),
  'a later cost edit never rewrites the sale cost snapshot'
);

select is(
  (select line_profit from public.order_items
    where order_id = (select id from public.orders where idempotency_key = 'pg3-snap-sale')),
  200::numeric(12, 2),
  'line profit uses the snapshotted cost, not the current one'
);

select * from finish();
rollback;
