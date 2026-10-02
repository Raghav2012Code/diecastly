-- Rotating a leaked guest access token.
--
-- Covers the four things that can go wrong with the remedy promised in
-- security.md §6 — an unauthorized caller, an unknown order, an order with no
-- guest link, and the switchover itself — plus the requirement that a rotation
-- changes nothing except the token.

begin;
set search_path = public, extensions;
select plan(12);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-0000000000a9',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'admin@test.local', 'x', now(), now(), now()
);

insert into public.admin_users (id, email)
values ('00000000-0000-0000-0000-0000000000a9', 'admin@test.local');

insert into public.products (id, name, slug, selling_price, purchase_cost, status)
values ('10000000-0000-0000-0000-000000000009', 'Rotate Car', 'rotate-car', 80, 50, 'active');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a9","role":"authenticated"}';

select public.set_initial_stock('10000000-0000-0000-0000-000000000009', 5, 50);

select public.place_online_order(
  '[{"productId":"10000000-0000-0000-0000-000000000009","quantity":1,"unitPrice":80}]'::jsonb,
  '{"name":"Buyer","phone":"9876543211","addressLine1":"1 Test St","city":"Bengaluru","state":"KA","postalCode":"560001"}'::jsonb,
  'cod'::public.payment_method,
  '{"line1":"1 Test St","city":"Bengaluru"}'::jsonb,
  null,
  'rot-online-1'
);

-- The pre-rotation state, so "unchanged" is compared against a value read
-- immediately before the call rather than one the fixture assumes.
create temporary table rotate_state (
  old_token uuid,
  status_before public.order_status,
  total_before numeric(12, 2),
  customer_before text,
  result jsonb
);

insert into rotate_state (old_token, status_before, total_before, customer_before)
select access_token, status, total, customer_name
  from public.orders
 where idempotency_key = 'rot-online-1';

-- A logged-in non-admin is not in admin_users, so require_admin() refuses. The
-- token must not be rotatable by anyone who can merely authenticate.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}';

select throws_ok(
  $$ select public.rotate_order_access_token(
       (select id from public.orders where idempotency_key = 'rot-online-1')) $$,
  '42501',
  'not_authorized',
  'a non-admin cannot rotate a token'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a9","role":"authenticated"}';

select throws_ok(
  $$ select public.rotate_order_access_token('00000000-0000-0000-0000-0000000000ee'::uuid) $$,
  'P0001',
  'order_not_found',
  'an unknown order cannot be rotated'
);

-- The one rotation the remaining assertions read from.
update rotate_state
   set result = public.rotate_order_access_token(
     (select id from public.orders where idempotency_key = 'rot-online-1')
   );

select is(
  ((select result ->> 'access_token' from rotate_state)::uuid)
    <> (select old_token from rotate_state),
  true,
  'rotation mints a token different from the old one'
);

select is(
  (select access_token from public.orders where idempotency_key = 'rot-online-1'),
  ((select result ->> 'access_token' from rotate_state)::uuid),
  'the order row stores the token the RPC returned'
);

select is(
  (public.get_order_by_access(
     (select order_number from public.orders where idempotency_key = 'rot-online-1'),
     (select old_token from rotate_state)
   ) ->> 'found')::boolean,
  false,
  'the old link stops resolving'
);

select is(
  (public.get_order_by_access(
     (select order_number from public.orders where idempotency_key = 'rot-online-1'),
     ((select result ->> 'access_token' from rotate_state)::uuid)
   ) ->> 'found')::boolean,
  true,
  'the new link resolves'
);

select is(
  (select result ->> 'order_number' from rotate_state),
  (select order_number from public.orders where idempotency_key = 'rot-online-1'),
  'the returned order number identifies the order'
);

select is(
  ((select result ->> 'order_id' from rotate_state)::uuid),
  (select id from public.orders where idempotency_key = 'rot-online-1'),
  'the returned order id identifies the order'
);

select is(
  (select status from public.orders where idempotency_key = 'rot-online-1'),
  (select status_before from rotate_state),
  'rotation leaves the fulfilment status alone'
);

select is(
  (select total from public.orders where idempotency_key = 'rot-online-1'),
  (select total_before from rotate_state),
  'rotation leaves the money alone'
);

select is(
  (select customer_name from public.orders where idempotency_key = 'rot-online-1'),
  (select customer_before from rotate_state),
  'rotation leaves the customer details alone'
);

-- The column is `not null default gen_random_uuid()`, so a row with no token
-- cannot be inserted as-is. The constraint is relaxed inside this rolled-back
-- transaction purely to build the fixture the guard exists for: an order that
-- was never given a guest link must be refused, not issued one.
alter table public.orders alter column access_token drop not null;

insert into public.orders (order_number, channel, status, access_token)
values ('ROT-INPERSON-1', 'in_person', 'completed', null);

select throws_ok(
  $$ select public.rotate_order_access_token(
       (select id from public.orders where order_number = 'ROT-INPERSON-1')) $$,
  'P0001',
  'no_access_token',
  'an order with no guest link cannot be rotated'
);

select * from finish();
rollback;
