-- Phase 2 invariants: restock and adjustment behaviour, idempotent retries,
-- archival preserving history, and the low-stock view.

begin;
set search_path = public, extensions;
select plan(23);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'admin@test.local', 'x', now(), now(), now()
);

insert into public.admin_users (id, email)
values ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local');

insert into public.products (id, name, slug, sku, selling_price, purchase_cost, low_stock_threshold, status)
values
  ('10000000-0000-0000-0000-000000000001', 'Restock Car',  'pg2-restock-car',  'PG2-001', 250, 100, 0, 'active'),
  ('10000000-0000-0000-0000-000000000002', 'Archive Car',  'pg2-archive-car',  'PG2-002', 250, 100, 0, 'active'),
  ('10000000-0000-0000-0000-000000000003', 'Low Car',      'pg2-low-car',      'PG2-003', 200, 100, 5, 'active'),
  ('10000000-0000-0000-0000-000000000004', 'Healthy Car',  'pg2-healthy-car',  'PG2-004', 200, 100, 2, 'active'),
  ('10000000-0000-0000-0000-000000000005', 'Draft Car',    'pg2-draft-car',    'PG2-005', 200, 100, 3, 'draft'),
  ('10000000-0000-0000-0000-000000000006', 'Zero Car',     'pg2-zero-car',     'PG2-006', 200, 100, 0, 'active');

-- Simulate an authenticated admin for auth.uid().
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- Restock: one movement, quantity_after equals the resulting stock.
select is(
  (public.set_initial_stock('10000000-0000-0000-0000-000000000001', 10) ->> 'quantity')::integer,
  10,
  'opening stock recorded'
);

select is(
  (public.restock_product(
     '10000000-0000-0000-0000-000000000001', 3, 120, false, 'supplier drop', 'pg222-restock-key'
   ) ->> 'quantity')::integer,
  13,
  'restock increments stock'
);

select is(
  (select count(*)::integer from public.inventory_movements where movement_type = 'restock'),
  1,
  'a restock writes exactly one restock movement'
);

select is(
  (select quantity_after::integer from public.inventory_movements where idempotency_key = 'pg222-restock-key'),
  13,
  'a movement records the quantity after the change'
);

-- Adjustment: exactly one movement of the chosen type.
select is(
  (public.adjust_stock(
     '10000000-0000-0000-0000-000000000001', -2, 'adjustment', 'count audit', 'pg222-adjust-key'
   ) ->> 'quantity')::integer,
  11,
  'an adjustment applies the signed delta'
);

select is(
  (select count(*)::integer from public.inventory_movements where movement_type = 'adjustment'),
  1,
  'an adjustment writes exactly one adjustment movement'
);

select is(
  (select quantity_after::integer from public.inventory_movements where idempotency_key = 'pg222-adjust-key'),
  11,
  'the adjustment movement agrees with the stock table'
);

-- A downward adjustment beyond available stock is rejected, stock untouched.
select throws_ok(
  $$ select public.adjust_stock('10000000-0000-0000-0000-000000000001', -12, 'loss', null, null) $$,
  'P0001',
  'insufficient_stock',
  'reducing stock below zero is rejected'
);

select is(
  (select quantity from public.inventory_stock
    where product_id = '10000000-0000-0000-0000-000000000001'),
  11,
  'stock is unchanged after the rejected adjustment'
);

-- Idempotent retries.
select is(
  (public.restock_product('10000000-0000-0000-0000-000000000001', 1, null, false, null, 'pg222-retry-key')
     ->> 'quantity')::integer,
  12,
  'the first submission with a key succeeds'
);

select is(
  (public.restock_product('10000000-0000-0000-0000-000000000001', 1, null, false, null, 'pg222-retry-key')
     ->> 'idempotent')::text,
  'true',
  'a repeated submission with the same key reports the original outcome'
);

select is(
  (select count(*)::integer from public.inventory_movements where idempotency_key = 'pg222-retry-key'),
  1,
  'a retried restock writes no second movement'
);

-- Archival: history survives, selling is blocked.
select is(
  (public.set_initial_stock('10000000-0000-0000-0000-000000000002', 5) ->> 'quantity')::integer,
  5,
  'opening stock for the soon-to-be-archived product'
);

select lives_ok(
  $$ select public.record_in_person_sale(
       '[{"productId":"10000000-0000-0000-0000-000000000002","quantity":2,"unitPrice":250}]'::jsonb,
       'cash'::public.payment_method, null, null, null, 'pg222-sale-key') $$,
  'a sale of the soon-to-be-archived product succeeds'
);

update public.products set status = 'archived'
where id = '10000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ select public.record_in_person_sale(
       '[{"productId":"10000000-0000-0000-0000-000000000002","quantity":1,"unitPrice":250}]'::jsonb,
       'cash'::public.payment_method, null, null, null, 'pg222-sale-archived') $$,
  'P0001',
  'product_inactive',
  'an archived product cannot be sold'
);

select is(
  (select count(*)::integer from public.order_items
    where order_id = (select id from public.orders where idempotency_key = 'pg222-sale-key')),
  1,
  'an archived product keeps its order history'
);

select is(
  (select count(*)::integer from public.inventory_movements
    where product_id = '10000000-0000-0000-0000-000000000002'),
  1,
  'an archived product keeps its movement ledger'
);

-- v_low_stock returns exactly the expected rows: active products at or below
-- their threshold. Products 3 and 6 sit below threshold; product 4 is healthy.
select is(
  (public.set_initial_stock('10000000-0000-0000-0000-000000000004', 10) ->> 'quantity')::integer,
  10,
  'a healthy product is stocked well above its threshold'
);

select is(
  (select count(*)::integer from public.v_low_stock),
  2,
  'v_low_stock returns exactly the expected rows'
);

select ok(
  exists (select 1 from public.v_low_stock where product_id = '10000000-0000-0000-0000-000000000003'),
  'a below-threshold active product appears in v_low_stock'
);

select ok(
  not exists (select 1 from public.v_low_stock where product_id = '10000000-0000-0000-0000-000000000004'),
  'a healthy product does not appear in v_low_stock'
);

select ok(
  not exists (select 1 from public.v_low_stock where product_id = '10000000-0000-0000-0000-000000000005'),
  'a draft product never appears in v_low_stock'
);

select ok(
  exists (select 1 from public.v_low_stock where product_id = '10000000-0000-0000-0000-000000000006'),
  'an out-of-stock active product appears in v_low_stock'
);

select * from finish();
rollback;
