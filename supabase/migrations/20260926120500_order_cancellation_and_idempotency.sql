-- Order cancellation, idempotency scoping, and the customer link.
--
-- Three defects in the order domain, all verified against PostgreSQL 18.6 before
-- being written up. Each is independent; they are grouped only because they all
-- belong to the order lifecycle.
--
-- 1. cancel_order restocked one line PER PRODUCT, not per unit.
-- 2. place_online_order replayed any matching idempotency key, handing back
--    another request's access_token.
-- 3. place_online_order let an anonymous caller overwrite a customer's record.
--
-- ===========================================================================
-- 1. cancel_order: aggregate the restock by product
-- ===========================================================================
--
-- The restock loop iterated order_items ROWS while its idempotence guard was
-- keyed on (reference_id, product_id). One product on two lines of an order
-- therefore restocked the first line and silently skipped the second, so those
-- units never returned to stock and no movement row explained the loss:
--
--   CONTROL single line: stock_after_cancel=5 order_cancel_rows=1   => OK
--   DUP two lines:       stock_after_cancel=4 order_cancel_rows=1   => 1 unit lost
--
-- Aggregating by product makes one order_cancel row per product carry the full
-- quantity, which is what "a sale is restocked at most once" was always meant to
-- mean (docs/database.md, D6).
--
-- Duplicate lines are still permitted on an order, and that is now harmless: the
-- sale decrements per line, the order shows per line, and the cancellation
-- reverses the total per product. Two lines for one product is also a
-- reasonable thing for a customer to do.

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
    -- Grouped by product, so a product appearing on several lines is restocked
    -- once for the summed quantity rather than once for its first line.
    for v_item in
      select oi.product_id, sum(oi.quantity)::integer as quantity
        from public.order_items oi
       where oi.order_id = p_order_id
         and oi.product_id is not null
       group by oi.product_id
       order by oi.product_id
    loop
      -- Unreachable given the early return above, but it is what makes a retry
      -- harmless if that guard is ever relaxed.
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
-- 2. Idempotency: a key must denote exactly one request
-- ===========================================================================
--
-- place_online_order looked its key up in a single global unique column and, on
-- any hit, returned that order's order_number and access_token. access_token is
-- the sole credential for reading an order (docs/security.md section 6, D10), so
-- a key collision disclosed another customer's order. Two different buyers with
-- one shared key produced:
--
--   C4 first  => order=DC-2026-00002 token=ff4cd32a-...
--   C4 replay => order=DC-2026-00002 token=ff4cd32a-... method=upi idempotent=true
--
-- The second buyer received the first buyer's token, and their own order was
-- never created at all.
--
-- The rule now enforced is the one record_payment already follows: a key denotes
-- one request, and reusing it for a different request is a conflict rather than
-- a replay. `idempotency_conflict` is already a mapped message.
--
-- No new column is needed. An order already stores its channel, payment method,
-- customer phone and its lines, so "is this the same request?" is answerable
-- from the stored order itself. That is preferable to adding a fingerprint
-- column: there is one fewer thing to keep in sync, and a request that was
-- written before this migration still compares correctly.

-- Normalises REQUESTED lines to `product:total-quantity` tokens, summed per
-- product and sorted. Summing means two requests that differ only in how the
-- same quantities were split across lines compare equal, so this stays correct
-- whether or not duplicate lines are ever collapsed at insert time.
--
-- The quantity is read defensively: a malformed value contributes 0 rather than
-- raising an unmapped 22P02 out of a comparison that is only trying to decide
-- whether this is a retry.
create or replace function public.order_item_fingerprint(p_items jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(string_agg(t.product_id || ':' || t.qty, ',' order by t.product_id), '')
    from (
      select e.value ->> 'productId' as product_id,
             sum(
               case
                 when e.value ->> 'quantity' ~ '^[0-9]+$'
                   then (e.value ->> 'quantity')::bigint
                 else 0
               end
             ) as qty
        from jsonb_array_elements(p_items) as e(value)
       group by 1
    ) t;
$$;

-- The same token format, built from the lines actually stored on an order.
create or replace function public.stored_order_item_fingerprint(p_order_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(string_agg(t.product_id || ':' || t.qty, ',' order by t.product_id), '')
    from (
      select oi.product_id::text as product_id, sum(oi.quantity)::bigint as qty
        from public.order_items oi
       where oi.order_id = p_order_id
         and oi.product_id is not null
       group by oi.product_id
    ) t;
$$;

-- ===========================================================================
-- 3. place_online_order: scope the replay, and link the customer
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

  -- Replay, but only for the request that actually owns the key.
  --
  -- This sits AFTER input validation, where it used to sit before, because the
  -- comparison needs a normalised phone and a valid item array. A genuine retry
  -- sends byte-identical input so it still replays; a corrupt retry now raises
  -- the specific validation error instead of silently returning someone else's
  -- order.
  --
  -- The shipping address is deliberately NOT compared. It is the one field a
  -- re-rendered checkout form might legitimately present differently, and a false
  -- `idempotency_conflict` on a real retry is a worse failure than the marginal
  -- disclosure risk: matching channel, phone, payment method and the exact set of
  -- lines already identifies the request.
  if p_idempotency_key is not null then
    select * into v_existing from public.orders where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.channel <> 'online'
         or v_existing.payment_method is distinct from p_payment_method
         or v_existing.customer_phone is distinct from v_customer_phone
         or public.stored_order_item_fingerprint(v_existing.id)
              is distinct from public.order_item_fingerprint(p_items)
      then
        raise exception 'idempotency_conflict' using errcode = 'P0001';
      end if;

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

  select default_shipping_fee, online_order_hold_hours, cod_enabled
    into v_shipping_fee, v_hold_hours, v_cod_enabled
  from public.settings where id = true;

  if p_payment_method = 'cod' and not coalesce(v_cod_enabled, false) then
    raise exception 'cod_disabled' using errcode = 'P0001';
  end if;

  -- Link to the customer record WITHOUT overwriting it.
  --
  -- `customers` is admin-only under RLS, but this function is security definer
  -- and granted to anon, so RLS does not apply to this write. The previous
  -- `on conflict do update set name = coalesce(excluded.name, customers.name)`
  -- let any anonymous caller rewrite the stored name and email of any customer
  -- whose phone number they could guess, and the admin customer list then showed
  -- the attacker's values. Verified: name became "ATTACKER", email
  -- "attacker@evil.test" on a pre-existing row.
  --
  -- Nothing is lost by not updating. The order snapshots customer_name and
  -- customer_email at write time, and editing a customer record is the admin
  -- metadata lane's job (`customers_admin_all`).
  --
  -- Insert-then-reselect rather than a no-op DO UPDATE, so a repeat order does
  -- not bump the customer's updated_at and imply a change that did not happen.
  -- The handler covers two callers racing to create the same new phone number.
  begin
    insert into public.customers (name, phone_normalized, email)
    values (v_customer_name, v_customer_phone, v_customer_email)
    returning id into v_customer_id;
  exception when unique_violation then
    select id into v_customer_id
      from public.customers
     where phone_normalized = v_customer_phone;
  end;

  v_expires_at := now() + make_interval(hours => coalesce(v_hold_hours, 48));
  v_order_number := public.next_order_number();

  insert into public.orders (
    order_number, channel, status, customer_id, customer_name, customer_phone,
    customer_email, shipping_address, payment_method, shipping_fee, expires_at,
    notes, idempotency_key
  )
  values (
    v_order_number, 'online', 'pending', v_customer_id, v_customer_name, v_customer_phone,
    v_customer_email, p_shipping_address, p_payment_method,
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
