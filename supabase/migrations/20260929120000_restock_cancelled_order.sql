-- Restock an order that was cancelled WITHOUT restocking.
--
-- THE DEFECT
--
-- cancel_order takes p_restock, and an admin can cancel with it false. The
-- restock loop is guarded by that same flag, and the function returns early for
-- an order already in a terminal state:
--
--   if v_order.status in ('cancelled', 'returned') then
--     return public.order_json(p_order_id);
--
-- So a cancelled-without-restock order could never be restocked by reference
-- again. Re-cancelling is a no-op, and the only recovery was a manual
-- adjust_stock in which an admin types a quantity the system cannot derive. That
-- weakens D20 — "expiry must reuse cancel_order, one authoritative
-- cancel/restock path" — because the case where you most want to correct the
-- ledger afterwards is the one case the system refuses.
--
-- Why it happens: a restock checkbox is a plausible thing to un-tick. An admin
-- who un-ticks it to avoid touching stock while they check something, then
-- cancels for a different reason, has no way back.
--
-- WHY A NEW RPC RATHER THAN A CHANGE TO cancel_order
--
-- cancel_order is the function the money and idempotency work pinned its
-- behaviour to. Its transition rules, reversal window and refund cap have been
-- the subject of several fixes; relaxing or re-branching it risks re-opening
-- them. This adds a separate entry point for the correction case and leaves
-- cancel_order's semantics exactly as they are, which is what the audit asked
-- for.
--
-- WHY IT WRITES movement_type = 'order_cancel'
--
-- So it inherits the guarantee instead of creating a new one. The partial
-- unique index on (reference_id, product_id) where movement_type = 'order_cancel'
-- already means "a sale is restocked at most once", it is already asserted, and
-- writing that movement type subjects this function to it for free. A new
-- movement type would have needed its own index and its own proof that it
-- could not double-restock.
--
-- Idempotency is structural rather than advisory, but the two mechanisms do
-- DIFFERENT jobs and it is worth being precise about which is which — measured,
-- not assumed. Remove the per-product guard below and the suite still fails safe:
-- the partial unique index rejects the second insert, and because the caller's
-- `begin ... exception` is a subtransaction, the apply_stock_delta that ran
-- just before it rolls back with it. Stock is correct either way.
--
-- What the guard buys is that the repeat is CLEAN. Without it the second call
-- raises 23505 duplicate key on inventory_movements_one_cancel_idx, which is not
-- a mapped code and would reach the admin as "Something went wrong". With it,
-- the call returns restocked_products = 0. So the index is the backstop that
-- makes the guarantee unbreakable, and the guard is what makes the ordinary case
-- a no-op rather than an error.
--
-- That is also why there is deliberately no p_idempotency_key argument: a key
-- would be belt on top of braces, and a globally-unique key reused by accident
-- would raise idempotency_conflict for a request that was merely a repeat.
--
-- No row is written to order_status_history. Restocking is not a fulfilment
-- transition — the order stays cancelled — and that table is rendered as a
-- status timeline, so a cancelled -> cancelled entry would read as a status
-- change that did not happen. The append-only movement row, carrying actor_id
-- and its own note, is the record.

create or replace function public.restock_cancelled_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_item record;
  v_qty_after integer;
  v_restocked integer := 0;
  v_skipped integer := 0;
  v_products jsonb;
begin
  perform public.require_admin();

  -- Same lock as cancel_order, so this cannot interleave with a cancellation of
  -- the same order and restock half of it.
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;

  if v_order.status <> 'cancelled' then
    raise exception 'order_not_cancelled' using errcode = 'P0001';
  end if;

  v_products := '[]'::jsonb;

  -- Grouped by product, exactly as cancel_order does, so a product on two lines
  -- is returned once for the summed quantity.
  for v_item in
    select oi.product_id, sum(oi.quantity)::integer as quantity
      from public.order_items oi
     where oi.order_id = p_order_id
       and oi.product_id is not null
     group by oi.product_id
     order by oi.product_id
  loop
    -- Already returned to stock, either by the original cancellation or by a
    -- previous call to this function. Skipping rather than raising is what makes
    -- a repeat harmless.
    if exists (
      select 1 from public.inventory_movements
       where reference_id = p_order_id
         and product_id = v_item.product_id
         and movement_type = 'order_cancel'
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_qty_after := public.apply_stock_delta(v_item.product_id, v_item.quantity);
    perform public.record_movement(
      v_item.product_id, v_item.quantity, v_qty_after, 'order_cancel', 'order',
      p_order_id, null, 'Cancelled order restocked', 'admin', null
    );

    v_restocked := v_restocked + 1;
    v_products := v_products || jsonb_build_object(
      'product_id', v_item.product_id, 'quantity', v_item.quantity, 'quantity_after', v_qty_after
    );
  end loop;

  return jsonb_build_object(
    'order_id', p_order_id,
    'order_number', v_order.order_number,
    'restocked_products', v_restocked,
    'already_restocked_products', v_skipped,
    'products', v_products
  );
end;
$$;

-- Every function here is executable by PUBLIC until told otherwise.
revoke execute on function public.restock_cancelled_order(uuid)
  from public, anon, authenticated;
grant execute on function public.restock_cancelled_order(uuid) to authenticated;
