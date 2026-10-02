-- Atomic image ordering on insert, and a deferrable backstop.
--
-- The load-bearing assertion here is the REORDER one. A plain UNIQUE constraint
-- on (product_id, sort_order) would reject a legitimate swap, because
-- `reorder_product_images` writes the new order by UPDATE in a loop and
-- transiently assigns the same value to two rows mid-transaction. Pinning that
-- the swap still commits is what stops someone "fixing" the deferrable backstop
-- later by making the constraint immediate, which would silently regress D47.

begin;
set search_path = public, extensions;
select plan(10);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'images@test.local', 'x', now(), now(), now()
);

insert into public.admin_users (id, email)
values ('00000000-0000-0000-0000-0000000000b1', 'images@test.local');

insert into public.products (id, name, slug, selling_price, purchase_cost, status)
values ('20000000-0000-0000-0000-000000000009', 'Sort Car', 'sort-car', 80, 50, 'active');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

-- Three sequential adds. The whole point is that the database assigned the
-- ordering; nothing here computed it.
select public.add_product_image('20000000-0000-0000-0000-000000000009', 'a.png', 'A');
select public.add_product_image('20000000-0000-0000-0000-000000000009', 'b.png', 'B');
select public.add_product_image('20000000-0000-0000-0000-000000000009', 'c.png', 'C');

select is(
  (select sort_order from public.product_images where storage_path = 'a.png'),
  0,
  'the first image is ordered 0'
);

select is(
  (select sort_order from public.product_images where storage_path = 'b.png'),
  1,
  'the second image is ordered 1'
);

select is(
  (select sort_order from public.product_images where storage_path = 'c.png'),
  2,
  'the third image is ordered 2'
);

-- A non-admin cannot add. `require_admin()` is the guard; the definer context
-- bypasses RLS, so the assertion inside the function is the only thing standing
-- between an authenticated user and the gallery.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}';

select throws_ok(
  $$ select public.add_product_image(
       '20000000-0000-0000-0000-000000000009', 'x.png', null) $$,
  '42501',
  'not_authorized',
  'a non-admin cannot add an image'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select throws_ok(
  $$ select public.add_product_image(
       '00000000-0000-0000-0000-0000000000ee', 'x.png', null) $$,
  'P0001',
  'product_not_found',
  'an image cannot be added to a product that does not exist'
);

-- The backstop. A duplicate order for one product must be rejected, and because
-- the constraint is DEFERRED it is only checked when forced or at commit, which
-- is why `set constraints all immediate` is inside the block: without it the
-- insert would succeed and the violation would surface at COMMIT, taking the
-- whole test transaction with it.
select throws_ok(
  $assert$
    do $do$
    begin
      insert into public.product_images (product_id, storage_path, sort_order, is_primary)
      values ('20000000-0000-0000-0000-000000000009', 'dup.png', 0, false);
      set constraints all immediate;
    end
    $do$
  $assert$,
  '23505',
  null,
  'two images cannot share one position for a product'
);

-- THE REGRESSION GUARD. Swapping the first and last image passes through a state
-- where two rows hold the same sort_order, and only the final state is correct.
-- If the constraint were ever made immediate, this would fail with 23505.
select lives_ok(
  $$ select public.reorder_product_images(array[
       (select id from public.product_images where storage_path = 'c.png'),
       (select id from public.product_images where storage_path = 'b.png'),
       (select id from public.product_images where storage_path = 'a.png')
     ]::uuid[]) $$,
  'a swap reorder commits even though it passes through a duplicate ordering'
);

select is(
  (select sort_order from public.product_images where storage_path = 'c.png'),
  0,
  'the swap moved C to the front'
);

select is(
  (select sort_order from public.product_images where storage_path = 'a.png'),
  2,
  'the swap moved A to the back'
);

select is(
  (select count(*)::integer from public.product_images
    where product_id = '20000000-0000-0000-0000-000000000009'),
  3,
  'the reorder dropped nothing and added nothing'
);

select * from finish();
rollback;
