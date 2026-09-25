-- Atomic business operations and their security-definer helpers.
--
-- Rules enforced here:
--  * Stock changes and their movement rows are written in one transaction.
--  * Conditional atomic stock updates make overselling impossible.
--  * Every stock change produces exactly one movement.
--  * Payments are append-only; payment state is derived, never stored.
--  * record_payment/refund_payment never change fulfilment status.
--  * Admin RPCs re-check authorization; helpers are never client-callable.

-- ===========================================================================
-- Helpers (internal only)
-- ===========================================================================

create or replace function public.normalize_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_phone is null then null
    when length(regexp_replace(p_phone, '\D', '', 'g')) = 10
      then '+91' || regexp_replace(p_phone, '\D', '', 'g')
    when length(regexp_replace(p_phone, '\D', '', 'g')) = 12
      and left(regexp_replace(p_phone, '\D', '', 'g'), 2) = '91'
      then '+' || regexp_replace(p_phone, '\D', '', 'g')
    else '+' || regexp_replace(p_phone, '\D', '', 'g')
  end;
$$;

create or replace function public.require_admin()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.next_order_number()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
begin
  select order_prefix into v_prefix from public.settings where id = true;
  v_prefix := coalesce(v_prefix, 'DC');
  return v_prefix || '-' || to_char(now(), 'YYYY') || '-'
    || lpad(nextval('public.order_number_seq')::text, 5, '0');
end;
$$;

-- Atomic, lock-taking stock mutation. Returns the quantity after the change.
-- A negative delta that would go below zero raises insufficient_stock.
create or replace function public.apply_stock_delta(p_product_id uuid, p_delta integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qty integer;
begin
  if p_delta = 0 then
    raise exception 'invalid_delta' using errcode = '22023';
  end if;

  update public.inventory_stock
     set quantity = quantity + p_delta,
         updated_at = now()
   where product_id = p_product_id
     and (p_delta > 0 or quantity + p_delta >= 0)
  returning quantity into v_qty;

  if not found then
    if not exists (select 1 from public.inventory_stock where product_id = p_product_id) then
      raise exception 'product_not_found' using errcode = 'P0001';
    end if;
    raise exception 'insufficient_stock' using errcode = 'P0001';
  end if;

  return v_qty;
end;
$$;

create or replace function public.record_movement(
  p_product_id uuid,
  p_delta integer,
  p_quantity_after integer,
  p_movement_type public.movement_type,
  p_reference_type text,
  p_reference_id uuid,
  p_unit_cost numeric,
  p_note text,
  p_source text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.inventory_movements (
    product_id, delta, quantity_after, movement_type, reference_type, reference_id,
    unit_cost, note, source, actor_id, idempotency_key
  )
  values (
    p_product_id, p_delta, p_quantity_after, p_movement_type, p_reference_type, p_reference_id,
    p_unit_cost, p_note, p_source, auth.uid(), p_idempotency_key
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Derived payment state for one order. Never stored.
create or replace function public.order_financials(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with paid as (
    select
      coalesce(sum(case when status = 'received' and amount > 0 then amount else 0 end), 0)
        as received,
      coalesce(sum(case when status = 'refunded' and amount < 0 then -amount else 0 end), 0)
        as refunded
    from public.payments
    where order_id = p_order_id
  )
  select jsonb_build_object(
    'total_due', o.total,
    'total_received', p.received,
    'total_refunded', p.refunded,
    'net_paid', p.received - p.refunded,
    'balance', o.total - (p.received - p.refunded),
    'payment_status', case
      when p.refunded > 0 and (p.received - p.refunded) <= 0 then 'refunded'
      when (p.received - p.refunded) >= o.total and o.total > 0 then 'paid'
      when (p.received - p.refunded) > 0 then 'partial'
      when o.payment_method = 'cod' and o.total > 0 then 'cod_pending'
      else 'unpaid'
    end
  )
  from public.orders o, paid p
  where o.id = p_order_id;
$$;

-- ===========================================================================
-- Opening stock (idempotent)
-- ===========================================================================

create or replace function public.set_initial_stock(
  p_product_id uuid,
  p_quantity integer,
  p_unit_cost numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.inventory_movements;
  v_qty integer;
  v_movement_id uuid;
begin
  perform public.require_admin();

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;

  select * into v_existing
  from public.inventory_movements
  where product_id = p_product_id and movement_type = 'initial'
  limit 1;

  if found then
    return jsonb_build_object(
      'product_id', p_product_id,
      'quantity', (select quantity from public.inventory_stock where product_id = p_product_id),
      'movement_id', v_existing.id,
      'already_initialized', true
    );
  end if;

  v_qty := public.apply_stock_delta(p_product_id, p_quantity);
  v_movement_id := public.record_movement(
    p_product_id, p_quantity, v_qty, 'initial', null, null, p_unit_cost,
    'Opening stock', 'admin', null
  );

  if p_unit_cost is not null then
    update public.products set purchase_cost = p_unit_cost where id = p_product_id;
  end if;

  return jsonb_build_object(
    'product_id', p_product_id,
    'quantity', v_qty,
    'movement_id', v_movement_id,
    'already_initialized', false
  );
end;
$$;

-- ===========================================================================
-- Restock / adjust
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

-- ===========================================================================
-- In-person sale (POS). Order is fulfilled (completed) at recording; payment
-- status is derived independently.
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
  v_subtotal numeric(12, 2) := 0;
  v_cost_total numeric(12, 2) := 0;
  v_line_total numeric(12, 2);
  v_customer_id uuid;
  v_customer_name text;
  v_customer_phone text;
  v_customer_email text;
  v_pay jsonb;
  v_pay_amount numeric(12, 2);
  v_total_paid numeric(12, 2) := 0;
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

  if p_payments is not null and jsonb_typeof(p_payments) = 'array'
     and jsonb_array_length(p_payments) > 0 then
    for v_pay in select value from jsonb_array_elements(p_payments) as t(value) loop
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
            then p_idempotency_key || ':' || coalesce(v_pay ->> 'method', p_payment_method::text)
              || ':' || v_pay_amount::text
          else null
        end
      );
      v_total_paid := v_total_paid + v_pay_amount;
    end loop;
  else
    insert into public.payments (
      order_id, amount, method, provider, status, received_at, recorded_by, idempotency_key
    )
    values (
      v_order_id, v_subtotal::numeric(12, 2), p_payment_method, 'manual', 'received',
      now(), auth.uid(),
      case when p_idempotency_key is not null then p_idempotency_key || ':default' else null end
    );
    v_total_paid := v_subtotal;
  end if;

  update public.orders
     set subtotal = v_subtotal,
         discount_total = (
           select coalesce(sum(line_discount), 0) from public.order_items where order_id = v_order_id
         ),
         total = v_subtotal,
         cost_total = v_cost_total
   where id = v_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, note, changed_by)
  values (v_order_id, null, 'completed', 'In-person sale recorded', auth.uid());

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'total', v_subtotal,
    'paid', v_total_paid,
    'idempotent', false
  );
end;
$$;

-- ===========================================================================
-- Online order (guest checkout). Stock is decremented at placement and the
-- order is held for settings.online_order_hold_hours.
-- ===========================================================================

create or replace function public.place_online_order(
  p_items jsonb,
  p_customer jsonb,
  p_payment_method public.payment_method,
  p_shipping_address jsonb default null,
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
  v_subtotal numeric(12, 2) := 0;
  v_cost_total numeric(12, 2) := 0;
  v_line_total numeric(12, 2);
  v_customer_id uuid;
  v_customer_name text;
  v_customer_phone text;
  v_customer_email text;
  v_shipping_fee numeric(12, 2);
  v_hold_hours integer;
  v_cod_enabled boolean;
  v_expires_at timestamptz;
begin
  if p_idempotency_key is not null then
    select * into v_existing from public.orders where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object(
        'order_id', v_existing.id,
        'order_number', v_existing.order_number,
        'access_token', v_existing.access_token,
        'total', v_existing.total,
        'payment_method', v_existing.payment_method,
        'expires_at', v_existing.expires_at,
        'idempotent', true
      );
    end if;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_items' using errcode = '22023';
  end if;

  if p_payment_method not in ('upi', 'cod') then
    raise exception 'invalid_payment_method' using errcode = '22023';
  end if;

  if p_customer is null then
    raise exception 'customer_required' using errcode = '22023';
  end if;

  v_customer_name := nullif(p_customer ->> 'name', '');
  v_customer_phone := public.normalize_phone(nullif(p_customer ->> 'phone', ''));
  v_customer_email := nullif(p_customer ->> 'email', '');

  if v_customer_name is null or v_customer_phone is null then
    raise exception 'customer_name_phone_required' using errcode = '22023';
  end if;

  if p_shipping_address is null or p_shipping_address = 'null'::jsonb then
    raise exception 'shipping_address_required' using errcode = '22023';
  end if;

  select default_shipping_fee, online_order_hold_hours, cod_enabled
    into v_shipping_fee, v_hold_hours, v_cod_enabled
  from public.settings where id = true;

  if p_payment_method = 'cod' and not coalesce(v_cod_enabled, false) then
    raise exception 'cod_disabled' using errcode = 'P0001';
  end if;

  insert into public.customers (name, phone_normalized, email)
  values (v_customer_name, v_customer_phone, v_customer_email)
  on conflict (phone_normalized) do update
    set name = coalesce(excluded.name, public.customers.name),
        email = coalesce(excluded.email, public.customers.email),
        updated_at = now()
  returning id into v_customer_id;

  v_expires_at := now() + make_interval(hours => coalesce(v_hold_hours, 48));
  v_order_number := public.next_order_number();

  insert into public.orders (
    order_number, channel, status, customer_id, customer_name, customer_phone,
    customer_email, shipping_address, payment_method, shipping_fee, expires_at,
    notes, idempotency_key
  )
  values (
    v_order_number, 'online', 'pending', v_customer_id, v_customer_name,
    v_customer_phone, v_customer_email, p_shipping_address, p_payment_method,
    coalesce(v_shipping_fee, 0), v_expires_at, p_notes, p_idempotency_key
  )
  returning id into v_order_id;

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
      null, 'storefront', null
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

  update public.orders
     set subtotal = v_subtotal,
         discount_total = (
           select coalesce(sum(line_discount), 0) from public.order_items where order_id = v_order_id
         ),
         total = v_subtotal + coalesce(v_shipping_fee, 0),
         cost_total = v_cost_total
   where id = v_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, note, changed_by)
  values (v_order_id, null, 'pending', 'Online order placed', null);

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'access_token', (select access_token from public.orders where id = v_order_id),
    'total', v_subtotal + coalesce(v_shipping_fee, 0),
    'payment_method', p_payment_method,
    'expires_at', v_expires_at,
    'idempotent', false
  );
end;
$$;
