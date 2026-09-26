-- Inventory idempotency: a key must denote exactly one request.

-- restock_product and adjust_stock looked their key up in a single global unique
-- index and ignored the product entirely, so a key reused for a different product
-- returned the FIRST product's result, reported `idempotent: true`, and never
-- touched the second. Stock was silently lost with no movement row.
--
-- Verified on PostgreSQL 18.6:
--
--   C5 restock A => product=...0001 qty_after=6
--   C5 restock B with the SAME key => idempotent=true product=...0001 qty_after=6
--   C5 product B stock=1 (started 1, asked for +7, expect 8) restock_rows=0
--   C5 VERDICT: DEFECT - B was NOT restocked, still 1
--
-- The index is NOT rescoped. Reusing one rule everywhere -- a key denotes one
-- request, and reusing it for a different request is a conflict -- is worth more
-- than letting the same key mean different things per product, and rescoping to
-- (product_id, idempotency_key) would also stop the leading column serving the
-- lookup below.
--
-- Today only the UI prevents this: keyForIntent in src/lib/validation/inventory.ts
-- mints a UUIDv4 per intent. docs/security.md section 5 requires idempotency to be
-- enforced server-side, never UI-only.
--
-- Bodies are otherwise unchanged.

-- ===========================================================================
-- restock_product
-- ===========================================================================

create or replace function public.restock_product(
  p_product_id uuid,
  p_quantity integer,
  p_unit_cost numeric default null,
  p_set_current_cost boolean default false,
  p_note text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qty integer;
  v_movement_id uuid;
  v_existing public.inventory_movements;
begin
  perform public.require_admin();

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.inventory_movements where idempotency_key = p_idempotency_key;
    if found then
      -- A key denotes exactly ONE request. `record_payment` already enforces
      -- this for the ledger; these two did not, and the index is global on
      -- (idempotency_key) alone, so a key used for one product silently
      -- swallowed a request for another:
      --
      --   restock A => product=A qty_after=6
      --   restock B with the SAME key => idempotent=true product=A qty_after=6
      --   product B stock=1 (asked for +7, expect 8) restock_rows=0
      --
      -- B was never restocked, wrote no movement row, and the caller was told
      -- it succeeded. The movement type is compared too, so an adjustment and a
      -- restock that share a key cannot replay each other either.
      --
      -- The index is deliberately left global rather than rescoped to
      -- (product_id, idempotency_key): one rule across the codebase is worth
      -- more than letting the same key mean different things per product, and
      -- rescoping would also stop the leading column serving this lookup.
      -- `idempotency_conflict` is already a mapped message.
      if v_existing.product_id <> p_product_id
         or v_existing.movement_type <> 'restock' then
        raise exception 'idempotency_conflict' using errcode = 'P0001';
      end if;

      return jsonb_build_object(
        'product_id', v_existing.product_id,
        'quantity', v_existing.quantity_after,
        'movement_id', v_existing.id,
        'idempotent', true
      );
    end if;
  end if;

  v_qty := public.apply_stock_delta(p_product_id, p_quantity);
  v_movement_id := public.record_movement(
    p_product_id, p_quantity, v_qty, 'restock', null, null, p_unit_cost,
    p_note, 'admin', p_idempotency_key
  );

  if p_set_current_cost and p_unit_cost is not null then
    update public.products set purchase_cost = p_unit_cost where id = p_product_id;
  end if;

  return jsonb_build_object(
    'product_id', p_product_id,
    'quantity', v_qty,
    'movement_id', v_movement_id,
    'idempotent', false
  );
end;
$$;

-- ===========================================================================
-- adjust_stock
-- ===========================================================================

create or replace function public.adjust_stock(
  p_product_id uuid,
  p_delta integer,
  p_reason public.movement_type,
  p_note text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qty integer;
  v_movement_id uuid;
  v_existing public.inventory_movements;
begin
  perform public.require_admin();

  if p_delta is null or p_delta = 0 then
    raise exception 'invalid_delta' using errcode = '22023';
  end if;

  if p_reason not in ('adjustment', 'damage', 'loss', 'return') then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.inventory_movements where idempotency_key = p_idempotency_key;
    if found then
      -- A key denotes exactly ONE request. `record_payment` already enforces
      -- this for the ledger; these two did not, and the index is global on
      -- (idempotency_key) alone, so a key used for one product silently
      -- swallowed a request for another:
      --
      --   restock A => product=A qty_after=6
      --   restock B with the SAME key => idempotent=true product=A qty_after=6
      --   product B stock=1 (asked for +7, expect 8) restock_rows=0
      --
      -- B was never restocked, wrote no movement row, and the caller was told
      -- it succeeded. The movement type is compared too, so an adjustment and a
      -- restock that share a key cannot replay each other either.
      --
      -- The index is deliberately left global rather than rescoped to
      -- (product_id, idempotency_key): one rule across the codebase is worth
      -- more than letting the same key mean different things per product, and
      -- rescoping would also stop the leading column serving this lookup.
      -- `idempotency_conflict` is already a mapped message.
      if v_existing.product_id <> p_product_id
         or v_existing.movement_type <> p_reason then
        raise exception 'idempotency_conflict' using errcode = 'P0001';
      end if;

      return jsonb_build_object(
        'product_id', v_existing.product_id,
        'quantity', v_existing.quantity_after,
        'movement_id', v_existing.id,
        'idempotent', true
      );
    end if;
  end if;

  v_qty := public.apply_stock_delta(p_product_id, p_delta);
  v_movement_id := public.record_movement(
    p_product_id, p_delta, v_qty, p_reason, null, null, null,
    p_note, 'admin', p_idempotency_key
  );

  return jsonb_build_object(
    'product_id', p_product_id,
    'quantity', v_qty,
    'movement_id', v_movement_id,
    'idempotent', false
  );
end;
$$;
