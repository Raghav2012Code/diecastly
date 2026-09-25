-- Payments: derived state, refund caps, and independence from fulfilment status.

begin;
set search_path = public, extensions;
select plan(5);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-0000000000a4',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'admin@test.local', 'x', now(), now(), now()
);

insert into public.admin_users (id, email)
values ('00000000-0000-0000-0000-0000000000a4', 'admin@test.local');

insert into public.products (id, name, slug, selling_price, purchase_cost, status)
values ('10000000-0000-0000-0000-000000000004', 'Pay Car', 'pay-car', 100, 60, 'active');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}';

select public.set_initial_stock('10000000-0000-0000-0000-000000000004', 10, 60);

select public.place_online_order(
  '[{"productId":"10000000-0000-0000-0000-000000000004","quantity":1,"unitPrice":100}]'::jsonb,
  '{"name":"Buyer","phone":"9876543210","addressLine1":"1 Test St","city":"Bengaluru","state":"KA","postalCode":"560001"}'::jsonb,
  'upi'::public.payment_method,
  '{"line1":"1 Test St","city":"Bengaluru"}'::jsonb,
  null,
  'online-pay-1'
);

select is(
  (select status::text from public.orders where idempotency_key = 'online-pay-1'),
  'pending',
  'online order starts pending'
);

select is(
  (public.record_payment(
     (select id from public.orders where idempotency_key = 'online-pay-1'),
     100, 'upi'::public.payment_method, 'txn-1', 'pay-1'
   ) #>> '{financials,payment_status}'),
  'paid',
  'recording full payment derives a paid state'
);

select is(
  (select status::text from public.orders where idempotency_key = 'online-pay-1'),
  'pending',
  'recording payment does NOT change fulfilment status'
);

select is(
  (public.refund_payment(
     (select id from public.orders where idempotency_key = 'online-pay-1'),
     100, 'upi'::public.payment_method, 'buyer cancelled', 'ref-1'
   ) #>> '{financials,payment_status}'),
  'refunded',
  'a full refund derives a refunded state'
);

select throws_ok(
  $$ select public.refund_payment(
       (select id from public.orders where idempotency_key = 'online-pay-1'),
       50, 'upi'::public.payment_method, 'again', 'ref-2') $$,
  'P0001',
  'nothing_to_refund',
  'refunding more than was received is rejected'
);

select * from finish();
rollback;
