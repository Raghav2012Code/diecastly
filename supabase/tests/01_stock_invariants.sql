-- Stock invariants: overselling is impossible; every change writes exactly one
-- movement; cancellation restocks exactly once.

begin;
set search_path = public, extensions;
select plan(8);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'admin@test.local', 'x', now(), now(), now()
);

insert into public.admin_users (id, email)
values ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local');

insert into public.products (id, name, slug, selling_price, purchase_cost, status)
values ('10000000-0000-0000-0000-000000000001', 'Test Car', 'test-car', 250, 150, 'active');

-- Simulate an authenticated admin for auth.uid().
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (public.set_initial_stock('10000000-0000-0000-0000-000000000001', 2, 150) ->> 'quantity')::integer,
  2,
  'opening stock set to 2'
);

select throws_ok(
  $$ select public.record_in_person_sale(
       '[{"productId":"10000000-0000-0000-0000-000000000001","quantity":3,"unitPrice":250}]'::jsonb,
       'cash'::public.payment_method, null, null, null, 'sale-oversell') $$,
  'P0001',
  'insufficient_stock',
  'selling more than available stock is rejected'
);

select is(
  (select quantity from public.inventory_stock
    where product_id = '10000000-0000-0000-0000-000000000001'),
  2,
  'stock is unchanged after a rejected oversell'
);

select lives_ok(
  $$ select public.record_in_person_sale(
       '[{"productId":"10000000-0000-0000-0000-000000000001","quantity":2,"unitPrice":250}]'::jsonb,
       'cash'::public.payment_method, null, null, null, 'sale-1') $$,
  'a sale within available stock succeeds'
);

select is(
  (select count(*)::integer from public.inventory_movements where movement_type = 'sale'),
  1,
  'exactly one sale movement is written per sale'
);

select is(
  (public.cancel_order(
     (select id from public.orders where idempotency_key = 'sale-1'),
     'customer changed mind', true, true, null
   ) ->> 'status'),
  'cancelled',
  'the sale is cancelled'
);

select is(
  (select quantity from public.inventory_stock
    where product_id = '10000000-0000-0000-0000-000000000001'),
  2,
  'stock is restored on cancellation'
);

select is(
  (select count(*)::integer from public.inventory_movements
    where movement_type = 'order_cancel'),
  1,
  'cancellation restocks exactly once'
);

select * from finish();
rollback;
