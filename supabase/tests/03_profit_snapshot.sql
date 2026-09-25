-- Historical order-line price and cost snapshots never change when product
-- metadata changes.

begin;
set search_path = public, extensions;
select plan(3);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-0000000000a3',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'admin@test.local', 'x', now(), now(), now()
);

insert into public.admin_users (id, email)
values ('00000000-0000-0000-0000-0000000000a3', 'admin@test.local');

insert into public.products (id, name, slug, selling_price, purchase_cost, status)
values ('10000000-0000-0000-0000-000000000003', 'Snapshot Car', 'snapshot-car', 200, 150, 'active');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';

select public.set_initial_stock('10000000-0000-0000-0000-000000000003', 10, 150);

select public.record_in_person_sale(
  '[{"productId":"10000000-0000-0000-0000-000000000003","quantity":2,"unitPrice":200,"lineDiscount":0}]'::jsonb,
  'cash'::public.payment_method, null, null, null, 'snapshot-sale'
);

-- Mutate product metadata after the sale.
update public.products
   set purchase_cost = 999,
       selling_price = 999
 where id = '10000000-0000-0000-0000-000000000003';

select is(
  (select unit_cost from public.order_items
    where order_id = (select id from public.orders where idempotency_key = 'snapshot-sale')),
  150.00::numeric(12, 2),
  'unit_cost snapshot is unchanged'
);

select is(
  (select unit_price from public.order_items
    where order_id = (select id from public.orders where idempotency_key = 'snapshot-sale')),
  200.00::numeric(12, 2),
  'unit_price snapshot is unchanged'
);

select is(
  (select line_profit from public.order_items
    where order_id = (select id from public.orders where idempotency_key = 'snapshot-sale')),
  100.00::numeric(12, 2),
  'generated line_profit is unchanged (2 x (200 - 150))'
);

select * from finish();
rollback;
