-- Money trust boundary for the two order-placing functions.
--
-- Three defects fixed together because they rewrite the same two function
-- bodies; splitting them would mean transcribing each function twice, and
-- these cannot be exercised on a machine without PostgreSQL.
--
-- 1. place_online_order took its unit price from the caller. It is
--    security definer and granted to anon, so an anonymous caller could set
--    any price it liked: the catalog price was only a coalesce fallback.
--    docs/security.md says never trust client-supplied prices and
--    docs/database.md says order totals are computed server-side. The price
--    now comes from the product row. A caller-supplied line discount is
--    ignored on this channel too; there is no server-side promotion
--    mechanism in v1, so no online discount may come from the client.
--
-- 2. record_in_person_sale inserted a full payment for the whole subtotal
--    whenever p_payments was null *or an empty array*. Both spellings mean
--    "nothing was collected", so a credit sale booked a phantom cash receipt
--    and derived `paid`. Absent and empty payments now create no payment
--    rows at all. The order is still created `completed` and stock is still
--    decremented: fulfilment and payment are independent (D22, D33).
--
-- 3. Both functions accumulated into numeric(12,2) running totals, which
--    rounds at every step, while order_items.line_total is a generated
--    column that rounds once. Rounding a running sum and summing rounded
--    parts are different operations, so the stored subtotal was not
--    guaranteed to equal the sum of its own line totals as
--    docs/database.md states. The accumulators are now unconstrained and
--    rounded once, at the end. Per-line price and discount were already
--    numeric(12,2) before use, so ordinary two-decimal input is unchanged.
--
-- The POS keeps its unit-price override: that caller is an authenticated
-- admin entitled to negotiate at the till. The two channels deliberately
-- differ, and the difference is intentional rather than duplicated.

-- ===========================================================================
-- In-person sale (POS)
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
-- Online order (guest checkout)
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
  v_line_discount numeric(12, 2) := 0;
  v_unit_cost numeric(12, 2);
  v_qty_after integer;
  v_subtotal numeric := 0;
  v_cost_total numeric := 0;
  v_line_total numeric;
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

    -- The price is the catalog's, never the caller's. This function is
    -- security definer and granted to anon, so a supplied unitPrice or
    -- lineDiscount would be the customer's to choose. Any value sent is
    -- ignored rather than validated, because a client that lies about a
    -- field it believes is authoritative cannot be trusted with it at all.
    v_unit_price := v_product.selling_price;
    v_line_discount := 0;

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
     set subtotal = round(v_subtotal, 2)::numeric(12, 2),
         discount_total = (
           select coalesce(sum(line_discount), 0) from public.order_items where order_id = v_order_id
         ),
         total = round(v_subtotal + coalesce(v_shipping_fee, 0), 2)::numeric(12, 2),
         cost_total = round(v_cost_total, 2)::numeric(12, 2)
   where id = v_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, note, changed_by)
  values (v_order_id, null, 'pending', 'Online order placed', null);

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'access_token', (select access_token from public.orders where id = v_order_id),
    'total', round(v_subtotal + coalesce(v_shipping_fee, 0), 2)::numeric(12, 2),
    'payment_method', p_payment_method,
    'expires_at', v_expires_at,
    'idempotent', false
  );
end;
$$;
