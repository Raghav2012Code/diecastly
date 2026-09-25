-- Opening stock may be initialised only once; retries are idempotent.

begin;
set search_path = public, extensions;
select plan(4);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-0000000000a2',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'admin@test.local', 'x', now(), now(), now()
);

insert into public.admin_users (id, email)
values ('00000000-0000-0000-0000-0000000000a2', 'admin@test.local');

insert into public.products (id, name, slug, selling_price, purchase_cost, status)
values ('10000000-0000-0000-0000-000000000002', 'Initial Car', 'initial-car', 100, 60, 'active');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select is(
  (public.set_initial_stock('10000000-0000-0000-0000-000000000002', 5, 60) ->> 'already_initialized')::boolean,
  false,
  'first initialisation runs'
);

select is(
  (public.set_initial_stock('10000000-0000-0000-0000-000000000002', 7, 60) ->> 'already_initialized')::boolean,
  true,
  'second initialisation is a no-op'
);

select is(
  (select quantity from public.inventory_stock
    where product_id = '10000000-0000-0000-0000-000000000002'),
  5,
  'stock is not doubled by the retry'
);

select is(
  (select count(*)::integer from public.inventory_movements
    where product_id = '10000000-0000-0000-0000-000000000002'
      and movement_type = 'initial'),
  1,
  'only one initial movement exists'
);

select * from finish();
rollback;
