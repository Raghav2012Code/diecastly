-- Behavioural assertions for atomic product-image ordering, primary selection
-- and deletion. Plain SQL, no pgTAP, so it runs under `postgres --single`.
--
-- This is a fallback for `supabase/tests/`, not a replacement. It exists because
-- pgTAP cannot be installed on this host.
--
-- The claims under test are all-or-nothing claims, so the interesting assertion
-- is always paired: the operation is rejected AND nothing changed. Asserting only
-- that it was rejected would pass even if it had half-applied before failing.

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000c2', 'img@test.local')
on conflict (id) do nothing;

insert into public.admin_users (id, email)
values ('00000000-0000-0000-0000-0000000000c2', 'img@test.local')
on conflict (id) do nothing;

insert into public.products (id, name, slug, status)
values ('32000000-0000-0000-0000-000000000001', 'Image Product', 'img-assert', 'draft')
on conflict (id) do nothing;

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}';

-- Four images: the first is primary.
insert into public.product_images (product_id, storage_path, is_primary, sort_order) values
  ('32000000-0000-0000-0000-000000000001', 'assert/a.png', true,  0),
  ('32000000-0000-0000-0000-000000000001', 'assert/b.png', false, 1),
  ('32000000-0000-0000-0000-000000000001', 'assert/c.png', false, 2),
  ('32000000-0000-0000-0000-000000000001', 'assert/d.png', false, 3);

-- ---------------------------------------------------------------------------
-- 1. Authorization: a non-admin cannot touch images.
-- ---------------------------------------------------------------------------
do $$
declare
  v_failed boolean := false;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}', false);
  begin
    perform public.set_primary_image(
      '32000000-0000-0000-0000-000000000001',
      (select id from public.product_images
        where product_id = '32000000-0000-0000-0000-000000000001' and storage_path = 'assert/b.png'));
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL a non-admin was allowed to set the primary image';
  end if;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', false);
  raise notice 'PASS a non-admin cannot set the primary image';
end
$$;

-- ---------------------------------------------------------------------------
-- 2. set_primary_image leaves exactly one primary, however many times it runs.
-- ---------------------------------------------------------------------------
do $$
declare
  v_target uuid;
  v_primaries integer;
  v_actual uuid;
begin
  for i in 1..3 loop
    select id into v_target from public.product_images
     where product_id = '32000000-0000-0000-0000-000000000001' and storage_path = 'assert/b.png';
    perform public.set_primary_image('32000000-0000-0000-0000-000000000001', v_target);

    select count(*) into v_primaries from public.product_images
     where product_id = '32000000-0000-0000-0000-000000000001' and is_primary;
    if v_primaries <> 1 then
      raise exception 'FAIL after % call(s) there are % primaries, expected exactly 1', i, v_primaries;
    end if;

    select id into v_actual from public.product_images
     where product_id = '32000000-0000-0000-0000-000000000001' and is_primary;
    if v_actual <> v_target then
      raise exception 'FAIL the wrong image became primary';
    end if;
  end loop;
  raise notice 'PASS set_primary_image leaves exactly one primary across repeated calls';
end
$$;

-- ---------------------------------------------------------------------------
-- 3. set_primary_image rejects an image from another product, changing nothing.
-- ---------------------------------------------------------------------------
insert into public.products (id, name, slug, status)
values ('32000000-0000-0000-0000-000000000002', 'Other Product', 'img-assert-other', 'draft')
on conflict (id) do nothing;

do $$
declare
  v_foreign uuid;
  v_before uuid;
  v_rejected boolean := false;
begin
  insert into public.product_images (product_id, storage_path, is_primary, sort_order)
  values ('32000000-0000-0000-0000-000000000002', 'assert/foreign.png', true, 0);
  select id into v_foreign from public.product_images where storage_path = 'assert/foreign.png';

  select id into v_before from public.product_images
   where product_id = '32000000-0000-0000-0000-000000000001' and is_primary;

  begin
    perform public.set_primary_image('32000000-0000-0000-0000-000000000001', v_foreign);
  exception when others then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL an image from another product was accepted as primary';
  end if;

  if (select id from public.product_images
       where product_id = '32000000-0000-0000-0000-000000000001' and is_primary) <> v_before then
    raise exception 'FAIL a rejected set_primary_image changed the existing primary';
  end if;
  raise notice 'PASS a foreign image is rejected and the existing primary is untouched';
end
$$;

-- ---------------------------------------------------------------------------
-- 4. reorder applies a complete set.
-- ---------------------------------------------------------------------------
do $$
declare
  v_ids uuid[];
  v_orders integer[];
  v_dupes integer;
begin
  select array_agg(id order by sort_order desc) into v_ids
    from public.product_images where product_id = '32000000-0000-0000-0000-000000000001';
  perform public.reorder_product_images(v_ids);

  select array_agg(sort_order order by sort_order) into v_orders
    from public.product_images where product_id = '32000000-0000-0000-0000-000000000001';

  if v_orders <> array[0,1,2,3] then
    raise exception 'FAIL reorder produced sort orders %, expected {0,1,2,3}', v_orders;
  end if;

  select count(*) into v_dupes from (
    select sort_order from public.product_images
     where product_id = '32000000-0000-0000-0000-000000000001'
     group by sort_order having count(*) > 1
  ) x;
  if v_dupes > 0 then
    raise exception 'FAIL reorder left % duplicated sort_order value(s)', v_dupes;
  end if;
  raise notice 'PASS reorder applies a complete set with no duplicate sort_order';
end
$$;

-- ---------------------------------------------------------------------------
-- 5. A partial set is rejected AND nothing is written. This is the atomicity
--    claim: previously a mid-loop failure left the order half-applied.
-- ---------------------------------------------------------------------------
do $$
declare
  v_partial uuid[];
  v_before integer[];
  v_rejected boolean := false;
begin
  select array_agg(sort_order order by sort_order) into v_before
    from public.product_images where product_id = '32000000-0000-0000-0000-000000000001';

  -- Three of the four images: a partial set.
  select array_agg(id order by sort_order) into v_partial
    from (select id, sort_order from public.product_images
           where product_id = '32000000-0000-0000-0000-000000000001'
           order by sort_order limit 3) s;

  begin
    perform public.reorder_product_images(v_partial);
  exception when others then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL a partial image set was accepted';
  end if;

  if (select array_agg(sort_order order by sort_order) from public.product_images
       where product_id = '32000000-0000-0000-0000-000000000001') <> v_before then
    raise exception 'FAIL a rejected reorder still changed sort_order values';
  end if;
  raise notice 'PASS a partial set is rejected and no sort_order changed';
end
$$;

-- ---------------------------------------------------------------------------
-- 6. A duplicated id is rejected, nothing changes.
-- ---------------------------------------------------------------------------
do $$
declare
  v_ids uuid[];
  v_before integer[];
  v_rejected boolean := false;
begin
  select array_agg(sort_order order by sort_order) into v_before
    from public.product_images where product_id = '32000000-0000-0000-0000-000000000001';

  -- Correct length, but with one id repeated. The ORDER BY must be inside
  -- array_agg: an ordered subquery does not constrain the aggregate's order, and
  -- relying on it made this assertion vacuous.
  select array_agg(id order by sort_order) into v_ids
    from public.product_images where product_id = '32000000-0000-0000-0000-000000000001';
  v_ids[1] := v_ids[2];

  begin
    perform public.reorder_product_images(v_ids);
  exception when others then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL a duplicated image id was accepted';
  end if;
  if (select array_agg(sort_order order by sort_order) from public.product_images
       where product_id = '32000000-0000-0000-0000-000000000001') <> v_before then
    raise exception 'FAIL a rejected reorder with duplicates still changed sort_order';
  end if;
  raise notice 'PASS a duplicated id is rejected and no sort_order changed';
end
$$;

-- ---------------------------------------------------------------------------
-- 7. Deleting the primary promotes a successor. This is the operation that was
--    completely broken: promoting before deleting violates the unique index, so
--    the delete never ran.
-- ---------------------------------------------------------------------------
do $$
declare
  v_primary uuid;
  v_count integer;
  v_remaining integer;
begin
  select id into v_primary from public.product_images
   where product_id = '32000000-0000-0000-0000-000000000001' and is_primary;

  perform public.delete_product_image(v_primary);

  select count(*) into v_count from public.product_images where id = v_primary;
  if v_count <> 0 then
    raise exception 'FAIL the primary image was not deleted';
  end if;

  select count(*) into v_remaining from public.product_images
   where product_id = '32000000-0000-0000-0000-000000000001';
  if v_remaining <> 3 then
    raise exception 'FAIL expected 3 images after the delete, found %', v_remaining;
  end if;

  select count(*) into v_count from public.product_images
   where product_id = '32000000-0000-0000-0000-000000000001' and is_primary;
  if v_count <> 1 then
    raise exception 'FAIL expected exactly 1 primary after the delete, found %', v_count;
  end if;
  raise notice 'PASS deleting the primary removes it and promotes exactly one successor';
end
$$;

-- ---------------------------------------------------------------------------
-- 8. Deleting the last remaining image leaves none, and is not an error.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_count integer;
begin
  for v_id in
    select id from public.product_images where product_id = '32000000-0000-0000-0000-000000000001'
  loop
    perform public.delete_product_image(v_id);
  end loop;

  select count(*) into v_count from public.product_images
   where product_id = '32000000-0000-0000-0000-000000000001';
  if v_count <> 0 then
    raise exception 'FAIL expected 0 images after deleting them all, found %', v_count;
  end if;
  raise notice 'PASS deleting every image leaves the product with none and no error';
end
$$;

-- ---------------------------------------------------------------------------
-- 9. Deleting an image that does not exist is rejected, not silently ignored.
-- ---------------------------------------------------------------------------
do $$
declare
  v_rejected boolean := false;
begin
  begin
    perform public.delete_product_image('00000000-0000-0000-0000-000000000000');
  exception when others then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL deleting a non-existent image was silently accepted';
  end if;
  raise notice 'PASS deleting a non-existent image is rejected';
end
$$;

-- ---------------------------------------------------------------------------
-- 10. A product's first image becomes its primary, and later ones do not.
--
--     Note that the four-image fixture at the top of this file is already half
--     of this test: it inserts four rows in one statement, three of them with
--     is_primary = false. A trigger that promoted every non-primary insert
--     would have collided with the partial unique index on that statement, so
--     simply reaching this point asserts the common case.
-- ---------------------------------------------------------------------------
insert into public.products (id, name, slug, status)
values ('32000000-0000-0000-0000-000000000003', 'First Image Product', 'img-assert-first', 'draft')
on conflict (id) do nothing;

do $$
declare
  v_first uuid;
  v_second uuid;
  v_primary uuid;
  v_primaries integer;
begin
  -- The first image of an empty product, explicitly NOT asking to be primary.
  insert into public.product_images (product_id, storage_path, is_primary, sort_order)
  values ('32000000-0000-0000-0000-000000000003', 'assert/first.png', false, 0)
  returning id into v_first;

  select count(*) into v_primaries from public.product_images
   where product_id = '32000000-0000-0000-0000-000000000003' and is_primary;
  if v_primaries <> 1 then
    raise exception 'FAIL the first image was not promoted: % primaries', v_primaries;
  end if;
  select id into v_primary from public.product_images
   where product_id = '32000000-0000-0000-0000-000000000003' and is_primary;
  if v_primary <> v_first then
    raise exception 'FAIL the wrong image was promoted on first insert';
  end if;

  -- A second image must NOT be promoted: the product already has a primary.
  insert into public.product_images (product_id, storage_path, is_primary, sort_order)
  values ('32000000-0000-0000-0000-000000000003', 'assert/second.png', false, 1)
  returning id into v_second;

  select count(*) into v_primaries from public.product_images
   where product_id = '32000000-0000-0000-0000-000000000003' and is_primary;
  if v_primaries <> 1 then
    raise exception 'FAIL a second image was also promoted: % primaries', v_primaries;
  end if;
  select id into v_primary from public.product_images
   where product_id = '32000000-0000-0000-0000-000000000003' and is_primary;
  if v_primary <> v_first then
    raise exception 'FAIL the primary moved to the second image';
  end if;
  raise notice 'PASS the first image is promoted and later images are not';
end
$$;

-- ---------------------------------------------------------------------------
-- 11. Grants. Nothing else in the suite checks these, and a security-definer
--     function that PUBLIC can execute is an unauthenticated write path, so the
--     grants are asserted rather than trusted.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
  v_rpcs text[] := array[
    'public.set_primary_image(uuid,uuid)',
    'public.reorder_product_images(uuid[])',
    'public.delete_product_image(uuid)'
  ];
begin
  foreach v_fn in array v_rpcs loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'FAIL % is executable by anon', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'FAIL % is not executable by authenticated', v_fn;
    end if;
  end loop;

  -- The trigger helper is not an RPC and must not be callable at all.
  if has_function_privilege('anon', 'public.product_images_promote_first()', 'execute')
     or has_function_privilege('authenticated', 'public.product_images_promote_first()', 'execute') then
    raise exception 'FAIL the trigger function is executable by a client role';
  end if;
  raise notice 'PASS the three RPCs are admin-only and the trigger function is not callable';
end
$$;

-- RAISE NOTICE is invisible in single-user mode; the success signal is a SELECT
-- because single-user echoes result rows to stdout.
select 'ALL ASSERTIONS PASSED' as result;
