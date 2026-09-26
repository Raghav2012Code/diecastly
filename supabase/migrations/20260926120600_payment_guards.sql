-- Payment guards: cap the POS sale, and make the caps atomic.
--
-- Three defects, all verified against PostgreSQL 18.6 first.
--
-- 1. record_in_person_sale recorded whatever it was handed, with no cap. An
--    overpayment produced a negative balance and a derived status of `paid`,
--    which every consumer hid. The cap added to record_payment in D42 was never
--    applied here, even though the receipt's Math.max(0, ...) clamp is exactly the
--    consumer that hid it.
--
-- 2. record_payment and refund_payment read the balance and then wrote, with no
--    lock on the order. They were the only mutators of order state without one.
--
-- 3. Two tender lines sharing a method and amount collided on the derived
--    payments.idempotency_key and raised an unmapped 23505, rolling the entire
--    sale back.
--
-- The function bodies below are otherwise byte-identical to their previous
-- definitions; only the annotated regions changed.
--
-- Signature note: these are `create or replace`, not drop-and-recreate, so the
-- overload set PostgREST resolves against and the exact-signature grants in
-- 20260925120600_rls_grants.sql are preserved. (The same reason D42's proposed
-- p_allow_overpayment escape hatch was left out.)

-- ===========================================================================
-- record_in_person_sale
-- ===========================================================================

create or replace function public.record_in_person_sale(
  p_items jsonb,
  p_payment_method public.payment_method,
  p_payments jsonb default null,
  p_customer jsonb default null,
  p_notes text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.orders;
  v_order_id uuid;
  v_order_number text;
  v_item jsonb;
  v_product public.products;
  v_product_id uuid;
  v_qty integer;
  v_unit_price numeric(12, 2);
  v_line_discount numeric(12, 2);
  v_unit_cost numeric(12, 2);
  v_qty_after integer;
  -- Unconstrained: rounded once at the end, not at every accumulation, so the
  -- stored subtotal is exactly the sum of the stored line totals.
  v_subtotal numeric := 0;
  v_cost_total numeric := 0;
  v_line_total numeric;
  v_customer_id uuid;
  v_customer_name text;
  v_customer_phone text;
  v_customer_email text;
  v_pay jsonb;
  v_pay_amount numeric(12, 2);
  v_total_paid numeric(12, 2) := 0;
  v_pay_ordinality integer;
begin
  perform public.require_admin();

  if p_idempotency_key is not null then
    select * into v_existing from public.orders where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object(
        'order_id', v_existing.id,
        'order_number', v_existing.order_number,
        'total', v_existing.total,
        'idempotent', true
      );
    end if;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_items' using errcode = '22023';
  end if;

  if p_customer is not null and p_customer <> 'null'::jsonb then
    v_customer_name := nullif(p_customer ->> 'name', '');
    v_customer_phone := public.normalize_phone(nullif(p_customer ->> 'phone', ''));
    v_customer_email := nullif(p_customer ->> 'email', '');

    if v_customer_phone is not null then
      insert into public.customers (name, phone_normalized, email)
      values (v_customer_name, v_customer_phone, v_customer_email)
      on conflict (phone_normalized) do update
        set name = coalesce(excluded.name, public.customers.name),
            email = coalesce(excluded.email, public.customers.email),
            updated_at = now()
      returning id into v_customer_id;
    end if;
  end if;

  v_order_number := public.next_order_number();

  insert into public.orders (
    order_number, channel, status, customer_id, customer_name, customer_phone,
    customer_email, payment_method, notes, idempotency_key, created_by
  )
  values (
    v_order_number, 'in_person', 'completed', v_customer_id, v_customer_name,
    v_customer_phone, v_customer_email, p_payment_method, p_notes, p_idempotency_key,
    auth.uid()
  )
  returning id into v_order_id;

  -- Deterministic lock order avoids deadlocks across concurrent multi-item sales.
  for v_item in
    select value from jsonb_array_elements(p_items) as t(value)
    order by (t.value ->> 'productId')
  loop
    v_product_id := (v_item ->> 'productId')::uuid;
    v_qty := coalesce((v_item ->> 'quantity')::integer, 0);
    v_line_discount := coalesce((v_item ->> 'lineDiscount')::numeric, 0);

    select * into v_product from public.products where id = v_product_id;
    if not found then
      raise exception 'product_not_found' using errcode = 'P0001';
    end if;
    if v_product.status <> 'active' then
      raise exception 'product_inactive' using errcode = 'P0001';
    end if;

    if v_qty <= 0 then
      raise exception 'invalid_quantity' using errcode = '22023';
    end if;

    -- Admin-negotiated price: legitimate here, unlike the online channel.
    v_unit_price := coalesce((v_item ->> 'unitPrice')::numeric, v_product.selling_price);
    if v_unit_price is null or v_unit_price <= 0 then
      raise exception 'invalid_unit_price' using errcode = '22023';
    end if;
    if v_line_discount < 0 or v_line_discount > (v_unit_price * v_qty) then
      raise exception 'invalid_discount' using errcode = '22023';
    end if;

    v_unit_cost := v_product.purchase_cost;

    v_qty_after := public.apply_stock_delta(v_product_id, -v_qty);
    perform public.record_movement(
      v_product_id, -v_qty, v_qty_after, 'sale', 'order', v_order_id, v_unit_cost,
      null, 'admin', null
    );

    insert into public.order_items (
      order_id, product_id, product_name, sku, quantity, unit_price, unit_cost, line_discount
    )
    values (
      v_order_id, v_product_id, v_product.name, v_product.sku, v_qty,
      v_unit_price, v_unit_cost, v_line_discount
    );

    v_line_total := (v_unit_price * v_qty) - v_line_discount;
    v_subtotal := v_subtotal + v_line_total;
    v_cost_total := v_cost_total + (v_unit_cost * v_qty);
  end loop;

  -- No else branch: a sale with no payments records no payment rows. Absence of
  -- payment is a real state, already used by the online channel, and it derives
  -- `unpaid` (or `cod_pending`).
  if p_payments is not null and jsonb_typeof(p_payments) = 'array'
     and jsonb_array_length(p_payments) > 0 then
    -- WITH ORDINALITY so each tender line gets a distinct derived key. The old
    -- key was a function of (method, amount) only, so two lines with the same
    -- method and amount collided on payments.idempotency_key and raised an
    -- unmapped 23505 that rolled the WHOLE sale back -- stock, order and lines.
    for v_pay, v_pay_ordinality in
      select value, ordinality
        from jsonb_array_elements(p_payments) with ordinality as t(value, ordinality)
    loop
      v_pay_amount := coalesce((v_pay ->> 'amount')::numeric, 0);
      if v_pay_amount <= 0 then
        raise exception 'invalid_payment' using errcode = '22023';
      end if;
      insert into public.payments (
        order_id, amount, method, provider, status, reference, received_at,
        recorded_by, idempotency_key
      )
      values (
        v_order_id, v_pay_amount,
        coalesce((v_pay ->> 'method')::public.payment_method, p_payment_method),
        'manual', 'received', v_pay ->> 'reference', now(), auth.uid(),
        case
          when p_idempotency_key is not null
            then p_idempotency_key || ':p' || v_pay_ordinality::text
          else null
        end
      );
      v_total_paid := v_total_paid + v_pay_amount;
    end loop;
  end if;

  -- Cap the recorded payments at the order total, as record_payment already
  -- does. Without it a crafted or stale client could record more than was
  -- owed, and payment state is derived rather than stored (D16, D17), so
  -- nothing raised: it produced a negative balance reported as `paid`.
  --   total=100.00 recorded=5000.00 balance=-4900.00 payment_status=paid
  -- Every consumer then hid it -- the receipt clamps the balance to zero --
  -- so the surplus was invisible on every screen.
  --
  -- This does NOT change what a recorded payment means. The POS already sends
  -- the amount RETAINED (`applied = Math.min(receivedValue, total)`) and shows
  -- the difference as "Change due" (pos-screen.tsx:154-155), so the clamp was
  -- simply UI-only, which docs/security.md section 5 forbids. `net_paid` still
  -- means money received and kept, so the definitions in docs/database.md and
  -- every report are untouched. Cash tendered over the total remains a normal
  -- till event; only the recorded amount was ever in question.
  --
  -- A sale with no payments leaves v_total_paid at 0, which is a real state
  -- (unpaid) and passes this check.
  if v_total_paid > round(v_subtotal, 2) then
    raise exception 'over_payment' using errcode = 'P0001';
  end if;

  update public.orders
     set subtotal = round(v_subtotal, 2)::numeric(12, 2),
         discount_total = (
           select coalesce(sum(line_discount), 0) from public.order_items where order_id = v_order_id
         ),
         total = round(v_subtotal, 2)::numeric(12, 2),
         cost_total = round(v_cost_total, 2)::numeric(12, 2)
   where id = v_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, note, changed_by)
  values (v_order_id, null, 'completed', 'In-person sale recorded', auth.uid());

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'total', round(v_subtotal, 2)::numeric(12, 2),
    'paid', v_total_paid,
    'idempotent', false
  );
end;
$$;

-- ===========================================================================
-- record_payment: the cap, now under a lock
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
  v_fin jsonb;
  v_balance numeric(12, 2);
begin
  perform public.require_admin();

  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_payment' using errcode = '22023';
  end if;

  -- Lock the order row for the remainder of the transaction.
  --
  -- The cap below is a read-then-write. Under READ COMMITTED two concurrent
  -- payments for the same order each read the same balance, each pass the cap,
  -- and both insert -- producing exactly the negative balance the cap exists to
  -- prevent. Nothing else stops it: payments.idempotency_key is unique but
  -- nullable and unique only per key, and no constraint forbids
  -- net_paid > orders.total.
  --
  -- update_order_status and cancel_order already take this lock; these two were
  -- the only mutators of order state that did not. Taking it here is safe from
  -- deadlock: neither function writes `orders`, and cancel_order acquires the
  -- same lock, so lock ordering is unchanged.
  --
  -- This replaces an existence probe that established nothing about concurrent
  -- writers. `not found` still works on a PERFORM, so order_not_found is
  -- unchanged.
  perform 1 from public.orders where id = p_order_id for update;
  if not found then
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
  v_balance := (v_fin ->> 'balance')::numeric(12, 2);

  if p_amount > v_balance then
    raise exception 'over_payment' using errcode = 'P0001';
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

-- ===========================================================================
-- refund_payment: the cap, now under a lock
-- ===========================================================================

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

  -- Lock the order row for the remainder of the transaction.
  --
  -- The cap below is a read-then-write. Under READ COMMITTED two concurrent
  -- payments for the same order each read the same balance, each pass the cap,
  -- and both insert -- producing exactly the negative balance the cap exists to
  -- prevent. Nothing else stops it: payments.idempotency_key is unique but
  -- nullable and unique only per key, and no constraint forbids
  -- net_paid > orders.total.
  --
  -- update_order_status and cancel_order already take this lock; these two were
  -- the only mutators of order state that did not. Taking it here is safe from
  -- deadlock: neither function writes `orders`, and cancel_order acquires the
  -- same lock, so lock ordering is unchanged.
  --
  -- This replaces an existence probe that established nothing about concurrent
  -- writers. `not found` still works on a PERFORM, so order_not_found is
  -- unchanged.
  perform 1 from public.orders where id = p_order_id for update;
  if not found then
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
