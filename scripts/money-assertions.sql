-- Behavioural assertions for the money trust boundary, in plain SQL.
--
-- This is the pgTAP suite's intent expressed without pgTAP, so it can run in
-- `postgres --single` on a host where no client can connect. It is NOT a
-- replacement for supabase/tests/08_money_trust_boundary.sql — that remains the
-- real suite and the one the gate runs. This exists to verify behaviour where
-- nothing else can run.
--
-- Every check raises an exception on failure, so a non-zero exit or an ERROR in
-- the output means a real failure. "ALL ASSERTIONS PASSED" is printed only if
-- every check passed.

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'owner@test.local')
on conflict (id) do nothing;

insert into public.admin_users (id, email)
values ('00000000-0000-0000-0000-0000000000c1', 'owner@test.local')
on conflict (id) do nothing;

insert into public.products (id, name, slug, sku, selling_price, purchase_cost, status) values
  ('21000000-0000-0000-0000-000000000001', 'Online Priced', 'asrt-online', 'AS-001', 500, 200, 'active'),
  ('21000000-0000-0000-0000-000000000002', 'Second',       'asrt-second',  'AS-002', 300, 100, 'active'),
  ('21000000-0000-0000-0000-000000000003', 'Zero Price',   'asrt-zero',    'AS-003', 0,   50,  'active'),
  ('21000000-0000-0000-0000-000000000004', 'Credit Sale',  'asrt-credit',  'AS-004', 250, 100, 'active'),
  ('21000000-0000-0000-0000-000000000005', 'Cap Target',   'asrt-cap',     'AS-005', 400, 150, 'active')
on conflict (id) do nothing;

-- Opening stock needs an admin session.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

select public.set_initial_stock('21000000-0000-0000-0000-000000000001', 20, 200);
select public.set_initial_stock('21000000-0000-0000-0000-000000000002', 20, 100);
select public.set_initial_stock('21000000-0000-0000-0000-000000000003', 20, 50);
select public.set_initial_stock('21000000-0000-0000-0000-000000000004', 20, 100);
select public.set_initial_stock('21000000-0000-0000-0000-000000000005', 20, 150);

-- Drop back to anonymous for the storefront assertions.
set request.jwt.claims = '{}';

-- ---------------------------------------------------------------------------
-- 1. An anonymous caller cannot set the price of an online order.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_price numeric(12,2);
  v_total numeric(12,2);
  v_discount numeric(12,2);
  v_stock integer;
begin
  -- Under-charging: one rupee instead of the catalog's 500.
  select (public.place_online_order(
    '[{"productId":"21000000-0000-0000-0000-000000000001","quantity":1,"unitPrice":1}]'::jsonb,
    '{"name":"Tamper Low","phone":"9876500001"}'::jsonb,
    'upi'::public.payment_method,
    '{"line1":"1 Test St","city":"Bengaluru","state":"KA","postal_code":"560001","country":"India"}'::jsonb,
    null, 'asrt-price-low'::text)) ->> 'order_id'
  into v_id;

  select unit_price into v_price from public.order_items where order_id = v_id;
  if v_price is distinct from 500::numeric(12,2) then
    raise exception 'FAIL tampered price stored as %, expected 500', v_price;
  end if;

  select total into v_total from public.orders where id = v_id;
  if v_total is distinct from 500::numeric(12,2) then
    raise exception 'FAIL tampered price reached the order total: %', v_total;
  end if;

  -- Over-charging must be ignored too, not just under-charging.
  select (public.place_online_order(
    '[{"productId":"21000000-0000-0000-0000-000000000001","quantity":1,"unitPrice":999999}]'::jsonb,
    '{"name":"Tamper High","phone":"9876500002"}'::jsonb,
    'upi'::public.payment_method,
    '{"line1":"1 Test St","city":"Bengaluru","state":"KA","postal_code":"560001","country":"India"}'::jsonb,
    null, 'asrt-price-high'::text)) ->> 'order_id'
  into v_id;

  select total into v_total from public.orders where id = v_id;
  if v_total is distinct from 500::numeric(12,2) then
    raise exception 'FAIL inflated price reached the order total: %', v_total;
  end if;

  -- A tampered line discount must not survive either.
  select (public.place_online_order(
    '[{"productId":"21000000-0000-0000-0000-000000000001","quantity":1,"lineDiscount":400}]'::jsonb,
    '{"name":"Tamper Discount","phone":"9876500003"}'::jsonb,
    'upi'::public.payment_method,
    '{"line1":"1 Test St","city":"Bengaluru","state":"KA","postal_code":"560001","country":"India"}'::jsonb,
    null, 'asrt-price-disc'::text)) ->> 'order_id'
  into v_id;

  select discount_total into v_discount from public.orders where id = v_id;
  if v_discount is distinct from 0::numeric(12,2) then
    raise exception 'FAIL tampered line discount stored as %', v_discount;
  end if;

  -- The storefront lane stays open: stock is still decremented, once per order.
  -- Three genuine anonymous orders were placed above (low, high, discount), so
  -- 20 - 3 = 17. The zero-price attempt in the next block must not decrement.
  select quantity into v_stock from public.inventory_stock
   where product_id = '21000000-0000-0000-0000-000000000001';
  if v_stock <> 17 then
    raise exception 'FAIL expected 17 in stock after 3 genuine orders, got %', v_stock;
  end if;

  raise notice 'PASS anonymous price tampering ignored (under, over, discount); stock decremented';
end
$$;

-- ---------------------------------------------------------------------------
-- 2. A product with no sellable price is refused, not sold at a tampered one.
-- ---------------------------------------------------------------------------
do $$
declare
  v_failed boolean := false;
begin
  begin
    perform public.place_online_order(
      '[{"productId":"21000000-0000-0000-0000-000000000003","quantity":1,"unitPrice":1}]'::jsonb,
      '{"name":"Zero Price","phone":"9876500004"}'::jsonb,
      'upi'::public.payment_method,
      '{"line1":"1 Test St","city":"Bengaluru","state":"KA","postal_code":"560001","country":"India"}'::jsonb,
      null, 'asrt-price-zero'::text);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL a zero-price product was sold at a tampered price';
  end if;
  raise notice 'PASS a zero catalog price is refused rather than sold';
end
$$;

-- ---------------------------------------------------------------------------
-- 3. A sale with no payment records no payment and derives unpaid.
-- ---------------------------------------------------------------------------
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

do $$
declare
  v_null_id uuid;
  v_empty_id uuid;
  v_payments integer;
  v_status text;
  v_fulfilled text;
  v_movements integer;
begin
  select (public.record_in_person_sale(
    '[{"productId":"21000000-0000-0000-0000-000000000004","quantity":1,"unitPrice":250}]'::jsonb,
    'cash'::public.payment_method, null, null, null, 'asrt-no-pay-null'::text)) ->> 'order_id'
  into v_null_id;

  select (public.record_in_person_sale(
    '[{"productId":"21000000-0000-0000-0000-000000000004","quantity":1,"unitPrice":250}]'::jsonb,
    'cash'::public.payment_method, '[]'::jsonb, null, null, 'asrt-no-pay-empty'::text)) ->> 'order_id'
  into v_empty_id;

  select count(*) into v_payments from public.payments
   where order_id in (v_null_id, v_empty_id);
  if v_payments <> 0 then
    raise exception 'FAIL a sale with no payments created % payment rows', v_payments;
  end if;

  select payment_status::text into v_status from public.v_order_financials
   where order_id = v_null_id;
  if v_status <> 'unpaid' then
    raise exception 'FAIL a no-payment sale derived %, expected unpaid', v_status;
  end if;

  -- Fulfilment is independent of payment: the goods changed hands regardless.
  select status::text into v_fulfilled from public.orders where id = v_null_id;
  if v_fulfilled <> 'completed' then
    raise exception 'FAIL an unpaid in-person sale is %, expected completed', v_fulfilled;
  end if;

  select count(*) into v_movements from public.inventory_movements
   where movement_type = 'sale' and reference_id = v_null_id;
  if v_movements <> 1 then
    raise exception 'FAIL an unpaid sale wrote % movements, expected 1', v_movements;
  end if;

  -- The unpaid state is settleable, not terminal.
  if (public.record_payment(v_null_id, 250, 'cash', 'settled later', 'asrt-settle'::text))
       #>> '{financials,payment_status}' <> 'paid' then
    raise exception 'FAIL an unpaid sale could not be settled by the normal payment path';
  end if;

  raise notice 'PASS no payment (null and empty) creates no rows, derives unpaid, still fulfilled and settleable';
end
$$;

-- ---------------------------------------------------------------------------
-- 4. The stored subtotal is exactly the sum of the stored line totals.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_subtotal numeric(12,2);
  v_line_sum numeric(12,2);
  v_cost numeric(12,2);
  v_cost_sum numeric(12,2);
begin
  -- Sub-paisa precision in the request is the input that used to make the two
  -- rounding paths disagree.
  select (public.record_in_person_sale(
    '[{"productId":"21000000-0000-0000-0000-000000000002","quantity":3,"lineDiscount":0.005}, {"productId":"21000000-0000-0000-0000-000000000002","quantity":1,"lineDiscount":0}]'::jsonb,
    'cash'::public.payment_method, null, null, null, 'asrt-rounding'::text)) ->> 'order_id'
  into v_id;

  select subtotal into v_subtotal from public.orders where id = v_id;
  select sum(line_total) into v_line_sum from public.order_items where order_id = v_id;
  if v_subtotal is distinct from v_line_sum then
    raise exception 'FAIL subtotal % <> sum of line totals %', v_subtotal, v_line_sum;
  end if;

  select cost_total into v_cost from public.orders where id = v_id;
  select sum(unit_cost * quantity) into v_cost_sum from public.order_items where order_id = v_id;
  if v_cost is distinct from v_cost_sum then
    raise exception 'FAIL cost_total % <> sum of line costs %', v_cost, v_cost_sum;
  end if;

  raise notice 'PASS stored subtotal and cost_total equal the sum of the stored lines';
end
$$;

-- ---------------------------------------------------------------------------
-- 5. A recorded payment may not exceed the outstanding balance.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_capped boolean := false;
  v_refund_capped boolean := false;
  v_balance numeric(12,2);
  v_rows integer;
begin
  select (public.record_in_person_sale(
    '[{"productId":"21000000-0000-0000-0000-000000000005","quantity":1,"unitPrice":400}]'::jsonb,
    'cash'::public.payment_method,
    '[{"amount":100,"method":"cash"}]'::jsonb, null, null, 'asrt-cap'::text)) ->> 'order_id'
  into v_id;

  -- Exactly the balance is the boundary, and must be accepted.
  if (public.record_payment(v_id, 300, 'cash', 'settle', 'asrt-cap-settle'::text))
       #>> '{financials,payment_status}' <> 'paid' then
    raise exception 'FAIL a payment equal to the balance was not accepted';
  end if;

  select balance into v_balance from public.v_order_financials where order_id = v_id;
  if v_balance <> 0::numeric(12,2) then
    raise exception 'FAIL settling the balance left %', v_balance;
  end if;

  -- One rupee over must be refused.
  begin
    perform public.record_payment(v_id, 1, 'cash', 'one too many', 'asrt-cap-over'::text);
  exception when others then
    v_capped := true;
  end;
  if not v_capped then
    raise exception 'FAIL a payment above the outstanding balance was accepted';
  end if;

  -- The refund cap must still hold.
  begin
    perform public.refund_payment(v_id, 500, 'cash', 'too much', 'asrt-over-refund'::text);
  exception when others then
    v_refund_capped := true;
  end;
  if not v_refund_capped then
    raise exception 'FAIL the refund cap was weakened by the payment cap';
  end if;

  -- A retry of a settled payment still returns the original result.
  if (public.record_payment(v_id, 300, 'cash', 'again', 'asrt-cap-settle'::text))
       #>> '{financials,payment_status}' <> 'paid' then
    raise exception 'FAIL retrying a settled payment did not succeed';
  end if;
  select count(*) into v_rows from public.payments where idempotency_key = 'asrt-cap-settle';
  if v_rows <> 1 then
    raise exception 'FAIL retrying a settled payment wrote % rows, expected 1', v_rows;
  end if;

  raise notice 'PASS payment capped at the balance, refund cap intact, retry still idempotent';
end
$$;

-- A bare RAISE goes to the server log, not stdout, and in single-user mode stdout is
-- all the runner can see. A SELECT is echoed as a result row, so it is the only
-- reliable success signal here.
select 'ALL ASSERTIONS PASSED' as result;
