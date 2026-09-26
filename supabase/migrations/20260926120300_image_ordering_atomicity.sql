-- Atomic image ordering, primary selection and deletion.
--
-- Three operations on product_images were previously a sequence of independent
-- client statements, so a failure part-way left the product in a state no
-- screen anticipated:
--
--   * reorder_product_images issued one UPDATE per image in a loop. If the third
--     of five failed, two were reordered and the rest were not, and the action
--     reported failure — so the admin was told it did not work while the data
--     was half-changed.
--
--   * set_primary_image cleared every primary and then set the new one. The
--     partial unique index forbids the reverse order, so that window is
--     unavoidable from the client; a failure between the two statements left the
--     product with no primary at all.
--
--   * delete_product_image promoted the successor BEFORE deleting the old
--     primary. That order is impossible: the partial unique index permits only
--     one primary per product, so setting the successor while the old primary
--     still exists is a violation. Verified against PostgreSQL 18.6:
--       ERROR: duplicate key value violates unique constraint
--              "product_images_one_primary_idx"
--     The promotion failed, the function returned an error, and the delete never
--     ran — so deleting a primary image did nothing at all.
--
-- Each operation is now one security-definer function, and a plpgsql function
-- body is a single transaction: either every statement lands or none does.
--
-- set_primary_image is deliberately TWO statements inside that one transaction.
-- A single `UPDATE ... SET is_primary = (id = p_image_id)` would depend on the
-- order rows happen to be visited in, because the unique index is checked per
-- row. Clear-then-set inside a transaction has no window and makes no assumption
-- about visit order.
--
-- A fourth change closes the remaining hole: the schema guarantees *at most*
-- one primary image per product, so it permits *none*. A BEFORE INSERT trigger
-- now makes a product's first image its primary, so the invariant holds for
-- inserts too and not only for the three operations above (D48).
--
-- Lane note: product_images is metadata, and D4 puts metadata writes on the RLS
-- lane. These three are a deliberate exception, taken for atomicity rather than
-- for encapsulation — recorded as D47.

-- ===========================================================================
-- Set the primary image
-- ===========================================================================

create or replace function public.set_primary_image(p_product_id uuid, p_image_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();

  if not exists (
    select 1 from public.product_images
     where id = p_image_id and product_id = p_product_id
  ) then
    raise exception 'image_not_found' using errcode = 'P0001';
  end if;

  update public.product_images
     set is_primary = false
   where product_id = p_product_id and is_primary;

  update public.product_images
     set is_primary = true
   where id = p_image_id;
end;
$$;

-- ===========================================================================
-- Reorder a product's images
-- ===========================================================================

create or replace function public.reorder_product_images(p_image_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_expected integer;
  v_given integer;
  v_index integer;
begin
  perform public.require_admin();

  -- The caller supplies only the ordered ids and the product is derived from
  -- them, which keeps the action payload unchanged. The checks below still
  -- guarantee every id belongs to the same product.
  v_given := coalesce(array_length(p_image_ids, 1), 0);
  if v_given = 0 then
    return;
  end if;

  select product_id into v_product_id
    from public.product_images
   where id = p_image_ids[1];

  if v_product_id is null then
    raise exception 'image_not_found' using errcode = 'P0001';
  end if;

  v_expected := (
    select count(*)::integer from public.product_images where product_id = v_product_id
  );

  -- The set must be exactly this product's images. A partial set would silently
  -- drop the omitted images out of the ordering, which is the defect being fixed.
  if v_given <> v_expected then
    raise exception 'image_set_mismatch' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from unnest(p_image_ids) as t(id)
     where not exists (
       select 1 from public.product_images pi
        where pi.id = t.id and pi.product_id = v_product_id
     )
  ) then
    raise exception 'image_set_mismatch' using errcode = 'P0001';
  end if;

  -- Duplicates would leave two images sharing a sort_order.
  if (select count(distinct t.id) from unnest(p_image_ids) as t(id)) <> v_given then
    raise exception 'image_set_mismatch' using errcode = 'P0001';
  end if;

  for v_index in 1..v_given loop
    update public.product_images
       set sort_order = v_index - 1
     where id = p_image_ids[v_index];
  end loop;
end;
$$;

-- ===========================================================================
-- Delete an image, promoting a successor if it was the primary
-- ===========================================================================

create or replace function public.delete_product_image(p_image_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.product_images;
  v_successor uuid;
begin
  perform public.require_admin();

  select * into v_row
    from public.product_images
   where id = p_image_id
     for update;
  if not found then
    raise exception 'image_not_found' using errcode = 'P0001';
  end if;

  -- Chosen before the delete so both land in one transaction. Promoting first is
  -- impossible: the unique index permits one primary per product.
  if v_row.is_primary then
    select id into v_successor
      from public.product_images
     where product_id = v_row.product_id
       and id <> p_image_id
     order by sort_order, created_at
     limit 1;
  end if;

  delete from public.product_images where id = p_image_id;

  if v_successor is not null then
    update public.product_images set is_primary = true where id = v_successor;
  end if;

  -- The row is gone, so the storage object is now unreachable through the
  -- database. The path is returned so the caller can still remove it. Storage
  -- cleanup cannot join this transaction, so a failure there leaves an orphaned
  -- file, which is recoverable — the reverse order would leave a row pointing at
  -- a file that no longer exists.
  return v_row.storage_path;
end;
$$;

-- ===========================================================================
-- The first image of a product becomes its primary
-- ===========================================================================
--
-- The partial unique index guarantees AT MOST one primary per product. It says
-- nothing about AT LEAST one, so a product can hold images and no primary — the
-- state that made the storefront fall back to the placeholder for every
-- thumbnail. The three functions above close it for the paths they own, but the
-- remaining hole is the insert: addProductImage always inserts with
-- `is_primary = false` and then promotes through setPrimaryImage, so a product
-- whose first image is uploaded with isPrimary = false was left with one image
-- and no primary.
--
-- Rather than patch the caller, the rule is enforced where it belongs. Every
-- insert of a non-primary image checks whether the product already has a
-- primary and claims the flag if it does not. That is one statement, so unlike
-- the client-side sequence it cannot be interrupted.
--
-- security definer is deliberate rather than incidental. The check must see the
-- product's true primary, not the caller's RLS-filtered view of it; if a policy
-- ever hid the existing primary, an invoker-rights trigger would wrongly promote
-- a second one and collide with the unique index. A definer trigger reads the
-- real state, so it either promotes correctly or not at all.
--
-- Concurrency: two simultaneous first uploads for the same product can both
-- observe "no primary" and both claim it. The unique index then rejects one. That
-- is a spurious failure rather than silent corruption, and it is the same
-- guarantee the rest of this schema gives.
--
-- Limit, stated plainly: the admin-all RLS policy still permits a direct
-- `UPDATE ... SET is_primary = false` that would orphan a product. No
-- application code issues one. The guarantee is therefore over the paths the
-- application uses, not over arbitrary SQL — the price of keeping
-- product_images on the metadata lane (D4, D47).

create or replace function public.product_images_promote_first()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_primary then
    return new;
  end if;

  if not exists (
    select 1
      from public.product_images
     where product_id = new.product_id
       and is_primary
  ) then
    new.is_primary := true;
  end if;

  return new;
end;
$$;

drop trigger if exists product_images_promote_first on public.product_images;

create trigger product_images_promote_first
  before insert on public.product_images
  for each row execute function public.product_images_promote_first();

-- ===========================================================================
-- Grants. A new function is executable by PUBLIC by default, so this is not
-- optional. Same pattern as the existing RPC lane.
-- ===========================================================================

revoke execute on function public.set_primary_image(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.reorder_product_images(uuid[]) from public, anon, authenticated;
revoke execute on function public.delete_product_image(uuid) from public, anon, authenticated;

grant execute on function public.set_primary_image(uuid, uuid) to authenticated;
grant execute on function public.reorder_product_images(uuid[]) to authenticated;
grant execute on function public.delete_product_image(uuid) to authenticated;

-- The trigger function is not an RPC. Nothing should be able to call it directly
-- (it takes no arguments and returns a trigger type), and every function is
-- executable by PUBLIC until told otherwise, so the default is revoked here too.
revoke execute on function public.product_images_promote_first() from public, anon, authenticated;
