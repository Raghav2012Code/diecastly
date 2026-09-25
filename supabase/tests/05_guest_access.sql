-- Guest order access requires BOTH the order number and the access token.

begin;
set search_path = public, extensions;
select plan(4);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-0000000000a5',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'admin@test.local', 'x', now(), now(), now()
);

insert into public.admin_users (id, email)
values ('00000000-0000-0000-0000-0000000000a5', 'admin@test.local');

insert into public.products (id, name, slug, selling_price, purchase_cost, status)
values ('10000000-0000-0000-0000-000000000005', 'Access Car', 'access-car', 80, 50, 'active');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}';

select public.set_initial_stock('10000000-0000-0000-0000-000000000005', 5, 50);

select lives_ok(
  $$ select public.place_online_order(
       '[{"productId":"10000000-0000-0000-0000-000000000005","quantity":1,"unitPrice":80}]'::jsonb,
       '{"name":"Buyer","phone":"9876543211","addressLine1":"1 Test St","city":"Bengaluru","state":"KA","postalCode":"560001"}'::jsonb,
       'cod'::public.payment_method,
       '{"line1":"1 Test St","city":"Bengaluru"}'::jsonb,
       null,
       'online-access-1') $$,
  'guest order is placed'
);

select is(
  (public.get_order_by_access(
     (select order_number from public.orders where idempotency_key = 'online-access-1'),
     '00000000-0000-0000-0000-0000000000ff'::uuid
   ) ->> 'found')::boolean,
  false,
  'a wrong token reveals nothing'
);

select is(
  (public.get_order_by_access(
     (select order_number from public.orders where idempotency_key = 'online-access-1'),
     (select access_token from public.orders where idempotency_key = 'online-access-1')
   ) ->> 'found')::boolean,
  true,
  'the correct number and token reveal the order'
);

select is(
  (public.get_order_by_access(
     (select order_number from public.orders where idempotency_key = 'online-access-1'),
     (select access_token from public.orders where idempotency_key = 'online-access-1')
   ) ->> 'total')::numeric,
  (select total from public.orders where idempotency_key = 'online-access-1'),
  'the returned total matches the order total'
);

select * from finish();
rollback;
