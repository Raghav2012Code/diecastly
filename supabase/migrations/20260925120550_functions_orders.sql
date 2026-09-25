-- Payments, order status transitions, cancellation/reversal and guest access.
-- These functions never couple payment writes to fulfilment status:
-- record_payment/refund_payment only append to the payments ledger.

create or replace function public.order_json(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'order_id', o.id,
    'order_number', o.order_number,
    'channel', o.channel,
    'status', o.status,
    'payment_method', o.payment_method,
    'subtotal', o.subtotal,
    'discount_total', o.discount_total,
    'shipping_fee', o.shipping_fee,
    'shipping_cost', o.shipping_cost,
    'total', o.total,
    'cost_total', o.cost_total,
    'expires_at', o.expires_at,
    'cancelled_at', o.cancelled_at,
    'cancel_reason', o.cancel_reason,
    'financials', public.order_financials(o.id)
  )
  from public.orders o
  where o.id = p_order_id;
$$;

-- ===========================================================================
-- Payments (append-only; never mutate fulfilment status)
-- ===========================================================================

create or replace function public.record_payment(
  p_order_id uuid,
  p_amount numeric,
  p_method public.payment_method,
  p_reference text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.payments;
begin
  perform public.require_admin();

  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_payment' using errcode = '22023';
  end if;

  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.payments where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.order_id <> p_order_id then
        raise exception 'idempotency_conflict' using errcode = 'P0001';
      end if;
      return public.order_json(p_order_id);
    end if;
  end if;

  insert into public.payments (
    order_id, amount, method, provider, status, reference, received_at,
    recorded_by, idempotency_key
  )
  values (
    p_order_id, p_amount, p_method, 'manual', 'received', p_reference, now(),
    auth.uid(), p_idempotency_key
  );

  return public.order_json(p_order_id);
end;
$$;

create or replace function public.refund_payment(
  p_order_id uuid,
  p_amount numeric,
  p_method public.payment_method default 'other',
  p_reason text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.payments;
  v_fin jsonb;
  v_net numeric(12, 2);
begin
  perform public.require_admin();

  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_payment' using errcode = '22023';
  end if;

  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.payments where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.order_id <> p_order_id then
        raise exception 'idempotency_conflict' using errcode = 'P0001';
      end if;
      return public.order_json(p_order_id);
    end if;
  end if;

  v_fin := public.order_financials(p_order_id);
  v_net := (v_fin ->> 'net_paid')::numeric;

  if v_net <= 0 then
    raise exception 'nothing_to_refund' using errcode = 'P0001';
  end if;
  if p_amount > v_net then
    raise exception 'over_refund' using errcode = 'P0001';
  end if;

  insert into public.payments (
    order_id, amount, method, provider, status, reference, received_at,
    recorded_by, idempotency_key
  )
  values (
    p_order_id, -p_amount, p_method, 'manual', 'refunded', p_reason, now(),
    auth.uid(), p_idempotency_key
  );

  return public.order_json(p_order_id);
end;
$$;

-- ===========================================================================
-- Fulfilment status transitions (independent of payments)
-- ===========================================================================

create or replace function public.update_order_status(
  p_order_id uuid,
  p_new_status public.order_status,
  p_note text default null,
  p_courier text default null,
  p_tracking text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  perform public.require_admin();

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;

  if p_new_status in ('cancelled', 'returned') then
    raise exception 'use_cancel_order' using errcode = 'P0001';
  end if;

  if not (
    (v_order.status = 'pending' and p_new_status = 'confirmed')
    or (v_order.status = 'confirmed' and p_new_status = 'packed')
    or (v_order.status = 'packed' and p_new_status = 'shipped')
    or (v_order.status = 'shipped' and p_new_status = 'delivered')
    or (v_order.status = 'delivered' and p_new_status = 'completed')
  ) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  update public.orders
     set status = p_new_status,
         courier = coalesce(p_courier, courier),
         tracking_number = coalesce(p_tracking, tracking_number),
         shipped_at = case when p_new_status = 'shipped' then now() else shipped_at end,
         delivered_at = case when p_new_status = 'delivered' then now() else delivered_at end
   where id = p_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, note, changed_by)
  values (p_order_id, v_order.status, p_new_status, p_note, auth.uid());

  return public.order_json(p_order_id);
end;
$$;

-- ===========================================================================
-- Cancellation / in-person reversal.
-- Reversal is allowed only for a completed in-person sale within the
-- configured window; the check is enforced here, never by the UI.
-- ===========================================================================

create or replace function public.cancel_order(
  p_order_id uuid,
  p_reason text,
  p_restock boolean default true,
  p_refund boolean default true,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_window integer;
  v_eligible boolean;
  v_item record;
  v_qty_after integer;
  v_fin jsonb;
  v_net numeric(12, 2);
begin
  perform public.require_admin();

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;

  -- Idempotent: a retry or repeat cancel returns the existing result.
  if v_order.status in ('cancelled', 'returned') then
    return public.order_json(p_order_id);
  end if;

  select in_person_reversal_window_hours into v_window from public.settings where id = true;
  v_window := coalesce(v_window, 24);

  v_eligible :=
    v_order.status in ('pending', 'confirmed', 'packed')
    or (
      v_order.status = 'completed'
      and v_order.channel = 'in_person'
      and v_order.created_at >= now() - make_interval(hours => v_window)
    );

  if not v_eligible then
    if v_order.status = 'completed' then
      raise exception 'outside_reversal_window' using errcode = 'P0001';
    end if;
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  if p_restock then
    for v_item in
      select product_id, quantity
      from public.order_items
      where order_id = p_order_id
      order by product_id
    loop
      if v_item.product_id is null then
        continue;
      end if;
      -- The partial unique index is the ultimate guard; this keeps the loop idempotent.
      if exists (
        select 1 from public.inventory_movements
        where reference_id = p_order_id
          and product_id = v_item.product_id
          and movement_type = 'order_cancel'
      ) then
        continue;
      end if;

      v_qty_after := public.apply_stock_delta(v_item.product_id, v_item.quantity);
      perform public.record_movement(
        v_item.product_id, v_item.quantity, v_qty_after, 'order_cancel', 'order',
        p_order_id, null, 'Order cancelled: restock', 'admin', null
      );
    end loop;
  end if;

  if p_refund then
    v_fin := public.order_financials(p_order_id);
    v_net := (v_fin ->> 'net_paid')::numeric;
    if v_net > 0 then
      insert into public.payments (
        order_id, amount, method, provider, status, reference, received_at, recorded_by
      )
      values (
        p_order_id, -v_net, coalesce(v_order.payment_method, 'other'), 'manual',
        'refunded', 'Order cancelled', now(), auth.uid()
      );
    end if;
  end if;

  update public.orders
     set status = 'cancelled',
         cancel_reason = p_reason,
         cancelled_at = now()
   where id = p_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, note, changed_by)
  values (p_order_id, v_order.status, 'cancelled', p_reason, auth.uid());

  return public.order_json(p_order_id);
end;
$$;

-- ===========================================================================
-- Non-financial admin edit
-- ===========================================================================

create or replace function public.update_order_notes(p_order_id uuid, p_notes text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();

  update public.orders set notes = p_notes where id = p_order_id;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;

  return public.order_json(p_order_id);
end;
$$;

-- ===========================================================================
-- Guest order access (anon). Requires BOTH order number and access token.
-- Phone/email never authorise access.
-- ===========================================================================

create or replace function public.get_order_by_access(p_order_number text, p_access_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order
  from public.orders
  where order_number = p_order_number
    and access_token = p_access_token;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'channel', v_order.channel,
    'created_at', v_order.created_at,
    'customer_name', v_order.customer_name,
    'payment_method', v_order.payment_method,
    'subtotal', v_order.subtotal,
    'shipping_fee', v_order.shipping_fee,
    'total', v_order.total,
    'expires_at', v_order.expires_at,
    'courier', v_order.courier,
    'tracking_number', v_order.tracking_number,
    'items', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'name', oi.product_name,
            'quantity', oi.quantity,
            'unit_price', oi.unit_price,
            'line_total', oi.line_total
          )
          order by oi.created_at
        ),
        '[]'::jsonb
      )
      from public.order_items oi
      where oi.order_id = v_order.id
    ),
    'financials', public.order_financials(v_order.id),
    'business', (
      select jsonb_build_object(
        'business_name', business_name,
        'upi_id', upi_id,
        'upi_qr_path', upi_qr_path,
        'cod_enabled', cod_enabled
      )
      from public.settings
      where id = true
    )
  );
end;
$$;
