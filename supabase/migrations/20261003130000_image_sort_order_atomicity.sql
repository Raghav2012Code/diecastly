-- Atomic image ordering on insert, and a backstop that cannot be violated by
-- a partial write.
--
-- THE DEFECT
--
-- `addProductImage` computed the new row's `sort_order` by reading the current
-- maximum and adding one, then inserting:
--
--   select sort_order ... order by sort_order desc limit 1   -- probe
--   insert ... sort_order = nextOrder
--
-- Those are two statements, so two admins uploading to the same product at the
-- same moment both read the same maximum and both insert the same `sort_order`.
-- The result is two images claiming the same position in the gallery: the
-- storefront's ordering becomes arbitrary between them, and `reorder_product_images`
-- can no longer express the order the admin actually sees, because it requires a
-- complete, duplicate-free set.
--
-- The probe error WAS checked — that fix is already in place and is not undone
-- here. But checking the error only stops a *failed read* from producing a
-- duplicate. Two *successful* reads racing each other are not an error at all,
-- so no client-side check can catch it. Only the database can.
--
-- WHY AN RPC RATHER THAN A TRANSACTION IN THE CLIENT
--
-- Exactly the reasoning as D47, which is why the three existing image RPCs are
-- already functions. A plpgsql body is one transaction, so "read the maximum,
-- then insert" becomes indivisible. `reorder_product_images` could not be used
-- for this because it demands the complete existing set, which a brand-new
-- upload does not have.
--
-- WHY THE ROW LOCK IS ON products, NOT product_images
--
-- Locking the image rows would serialise adds against each other but would not
-- exclude a concurrent insert, because a row that does not exist yet cannot be
-- locked. The product row exists, is a stable single row per product, and every
-- add touches its product, so `for update` on it makes "compute the next order"
-- and "insert that row" mutually exclusive per product. Two products still add
-- concurrently, which is the point of a per-row lock rather than a table lock.
--
-- WHY THE CONSTRAINT IS DEFERRABLE
--
-- `reorder_product_images` assigns the new order by UPDATE in a loop, one row
-- per iteration. Swapping the first two images transiently assigns the same
-- `sort_order` to two rows mid-loop — correct at every commit, wrong at every
-- intermediate step. A plain UNIQUE constraint would reject that legitimate
-- reorder, which is the D47 atomicity work regressing for the sake of an
-- index. DEFERRABLE INITIALLY DEFERRED moves the check to COMMIT, where the
-- loop's final state is what matters, so reorder keeps working AND the
-- invariant is still enforced on every committed transaction.
--
-- The constraint is therefore a backstop, not the primary mechanism: the lock
-- is what makes adds correct, the constraint is what makes a future writer that
-- bypasses this function fail loudly rather than silently duplicate.

-- Defensive: if any product already carries duplicate sort_orders the
-- constraint cannot be added. Re-number first so the migration is safe on a
-- database that has already been raced, rather than failing where it could fix.
with ranked as (
  select id,
         row_number() over (partition by product_id order by sort_order, created_at, id) - 1 as new_order
    from public.product_images
)
update public.product_images pi
   set sort_order = ranked.new_order
  from ranked
 where pi.id = ranked.id
   and pi.sort_order <> ranked.new_order;

alter table public.product_images
  drop constraint if exists product_images_product_sort_order_key;
alter table public.product_images
  add constraint product_images_product_sort_order_key
  unique (product_id, sort_order)
  deferrable initially deferred;

create or replace function public.add_product_image(
  p_product_id uuid,
  p_storage_path text,
  p_alt_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next integer;
  v_row public.product_images;
begin
  perform public.require_admin();

  -- Serialises against every other add for this product. See the header for why
  -- the lock is on the product rather than the image rows.
  perform 1 from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product_not_found' using errcode = 'P0001';
  end if;

  -- Inside the lock, so this maximum already accounts for any add that
  -- committed a moment ago. -1 makes the first image sort_order 0, which is
  -- what the 0-based ordering `reorder_product_images` writes.
  select coalesce(max(sort_order), -1) + 1 into v_next
    from public.product_images
   where product_id = p_product_id;

  insert into public.product_images (
    product_id, storage_path, alt_text, sort_order, is_primary
  ) values (
    p_product_id, p_storage_path, p_alt_text, v_next, false
  )
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

-- Every function here is executable by PUBLIC until told otherwise.
revoke execute on function public.add_product_image(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.add_product_image(uuid, text, text) to authenticated;
