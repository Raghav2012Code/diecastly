-- Behavioural assertions for the order lifecycle, payment and inventory
-- idempotency fixes, in plain SQL.
--
-- This is the pgTAP suite's intent expressed without pgTAP, so it can run in
-- `postgres --single` on a host where no client can connect. It is NOT a
-- replacement for supabase/tests/ — that remains the real suite and the one the
-- gate runs. This exists to verify behaviour where nothing else can run.
--
-- Every check raises an exception on failure. "ALL ASSERTIONS PASSED" is printed
-- only if every check passed.
--
-- Each section is paired with a control, so an assertion cannot pass vacuously.
-- For every "is rejected" claim the control is the "is accepted" case, and for
-- every "nothing changed" claim the control is the operation that does change
-- something. A rejection assertion on its own would pass against an
-- implementation that half-applied before failing.

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000c3', 'orders@test.local')
on conflict (id) do nothing;

insert into public.admin_users (id, email)
values ('00000000-0000-0000-0000-0000000000c3', 'orders@test.local')
on conflict (id) do nothing;

insert into public.products (id, name, slug, sku, selling_price, purchase_cost, status) values
  ('23000000-0000-0000-0000-000000000001', 'Restock A',   'asrt-restock-a', 'RS-A', 100, 40, 'active'),
  ('23000000-0000-0000-0000-000000000002', 'Restock B',   'asrt-restock-b', 'RS-B', 100, 40, 'active'),
  ('23000000-0000-0000-0000-000000000003', 'Dup Lines',   'asrt-dup-lines', 'RS-D', 100, 40, 'active'),
  ('23000000-0000-0000-0000-000000000004', 'Solo Line',   'asrt-solo-line', 'RS-S', 100, 40, 'active'),
  ('23000000-0000-0000-0000-000000000005', 'Tender Split', 'asrt-tender',   'RS-T', 100, 40, 'active')
on conflict (id) do nothing;

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';

select public.set_initial_stock('23000000-0000-0000-0000-000000000001', 10, 40);
select public.set_initial_stock('23000000-0000-0000-0000-000000000002', 10, 40);
select public.set_initial_stock('23000000-0000-0000-0000-000000000003', 5, 40);
select public.set_initial_stock('23000000-0000-0000-0000-000000000004', 5, 40);
-- 50 units: this product is drawn on by four sections below.
select public.set_initial_stock('23000000-0000-0000-0000-000000000005', 50, 40);

-- ===========================================================================
-- 1. cancel_order restocks every unit, even when a product spans two lines.
--
--    The defect: the restock loop iterated order_items ROWS while its
--    idempotence guard was keyed on (reference_id, product_id), so the second
--    line for a product was skipped and its units vanished with no ledger row.
--    Verified before the fix: 5 -> 2 on sale, then only back to 4 on cancel.
-- ===========================================================================
set request.jwt.claims = '{}';

do $$
declare
  v_order uuid;
  v_stock integer;
  v_restocked integer;
begin
  -- Placed as an anonymous shopper, which is how a duplicate product on two
  -- lines is actually reachable.
  v_order := public.place_online_order(
    p_items => '[{"productId":"23000000-0000-0000-0000-000000000003","quantity":2},{"productId":"23000000-0000-0000-0000-000000000003","quantity":1}]'::jsonb,
    p_customer => '{"name":"Dup Buyer","phone":"9900000001"}'::jsonb,
    p_payment_method => 'upi',
    p_shipping_address => '{"addressLine1":"1 St","city":"Pune","state":"MH","postalCode":"411001"}'::jsonb,
    p_notes => null,
    p_idempotency_key => 'asrt-dup-lines-order'
  ) ->> 'order_id';

  select quantity into v_stock from public.inventory_stock
   where product_id = '23000000-0000-0000-0000-000000000003';
  if v_stock <> 2 then
    raise exception 'FAIL sale should have taken 5 to 2, it is %', v_stock;
  end if;

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', false);
  perform public.cancel_order(v_order, 'assertion', true, false, null);

  select quantity into v_stock from public.inventory_stock
   where product_id = '23000000-0000-0000-0000-000000000003';
  if v_stock <> 5 then
    raise exception 'FAIL all 3 units must come back, stock is % not 5', v_stock;
  end if;

  -- The ledger must account for the full quantity, not just the first line.
  select coalesce(sum(delta), 0) into v_restocked
    from public.inventory_movements
   where reference_id = v_order and movement_type = 'order_cancel';
  if v_restocked <> 3 then
    raise exception 'FAIL the restock movement must total 3 units, it totals %', v_restocked;
  end if;

  raise notice 'PASS two lines for one product are fully restocked';
end
$$;

-- CONTROL: a single-line order of the same shape still restocks exactly once.
do $$
declare
  v_order uuid;
  v_stock integer;
  v_restocked integer;
begin
  v_order := public.place_online_order(
    p_items => '[{"productId":"23000000-0000-0000-0000-000000000004","quantity":3}]'::jsonb,
    p_customer => '{"name":"Solo Buyer","phone":"9900000002"}'::jsonb,
    p_payment_method => 'upi',
    p_shipping_address => '{"addressLine1":"1 St","city":"Pune","state":"MH","postalCode":"411001"}'::jsonb,
    p_notes => null,
    p_idempotency_key => 'asrt-solo-line-order'
  ) ->> 'order_id';

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', false);
  perform public.cancel_order(v_order, 'assertion', true, false, null);

  select quantity into v_stock from public.inventory_stock
   where product_id = '23000000-0000-0000-0000-000000000004';
  select coalesce(sum(delta), 0) into v_restocked
    from public.inventory_movements
   where reference_id = v_order and movement_type = 'order_cancel';

  if v_stock <> 5 then
    raise exception 'FAIL control: stock is % not 5', v_stock;
  end if;
  if v_restocked <> 3 then
    raise exception 'FAIL control: restock movement totals % not 3', v_restocked;
  end if;
  raise notice 'PASS control: a single-line order restocks exactly 3 units';
end
$$;

-- CONTROL: cancelling twice does not restock twice.
do $$
declare
  v_order uuid;
  v_stock integer;
begin
  v_order := public.place_online_order(
    p_items => '[{"productId":"23000000-0000-0000-0000-000000000004","quantity":1}]'::jsonb,
    p_customer => '{"name":"Twice Buyer","phone":"9900000003"}'::jsonb,
    p_payment_method => 'upi',
    p_shipping_address => '{"addressLine1":"1 St","city":"Pune","state":"MH","postalCode":"411001"}'::jsonb,
    p_notes => null,
    p_idempotency_key => 'asrt-twice-order'
  ) ->> 'order_id';

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', false);
  perform public.cancel_order(v_order, 'assertion', true, false, null);
  perform public.cancel_order(v_order, 'assertion again', true, false, null);

  select quantity into v_stock from public.inventory_stock
   where product_id = '23000000-0000-0000-0000-000000000004';
  if v_stock <> 5 then
    raise exception 'FAIL a repeat cancel must not restock again, stock is % not 5', v_stock;
  end if;
  raise notice 'PASS control: a repeat cancel does not restock twice';
end
$$;

-- ===========================================================================
-- 2. An idempotency key denotes exactly one request.
--
--    The defect: place_online_order replayed ANY matching key and returned that
--    order's access_token, which is the sole credential for reading an order.
--    Two buyers sharing a key meant the second received the first's token.
-- ===========================================================================
do $$
declare
  v_first jsonb;
  v_replay jsonb;
  v_conflict boolean := false;
  v_second_orders integer;
begin
  v_first := public.place_online_order(
    p_items => '[{"productId":"23000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb,
    p_customer => '{"name":"First Buyer","phone":"9900000011"}'::jsonb,
    p_payment_method => 'upi',
    p_shipping_address => '{"addressLine1":"1 St","city":"Pune","state":"MH","postalCode":"411001"}'::jsonb,
    p_notes => null,
    p_idempotency_key => 'asrt-shared-key'
  );

  -- A DIFFERENT customer, different payment method, same key.
  begin
    v_replay := public.place_online_order(
      p_items => '[{"productId":"23000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb,
      p_customer => '{"name":"Second Buyer","phone":"9900000012"}'::jsonb,
      p_payment_method => 'cod',
      p_shipping_address => '{"addressLine1":"9 St","city":"Delhi","state":"DL","postalCode":"110001"}'::jsonb,
      p_notes => null,
      p_idempotency_key => 'asrt-shared-key'
    );
  exception when others then
    v_conflict := true;
  end;

  if not v_conflict then
    raise exception 'FAIL a key reused for a different request must raise idempotency_conflict';
  end if;

  -- The other buyer's order must not have been created at all.
  select count(*) into v_second_orders from public.orders
   where idempotency_key = 'asrt-shared-key' and customer_phone = '+919900000012';
  if v_second_orders <> 0 then
    raise exception 'FAIL the second buyer''s order must not exist';
  end if;
  raise notice 'PASS a key reused for a different request is refused';
end
$$;

-- CONTROL: a genuine retry of the SAME request still replays the same order.
do $$
declare
  v_first jsonb;
  v_replay jsonb;
begin
  v_first := public.place_online_order(
    p_items => '[{"productId":"23000000-0000-0000-0000-000000000002","quantity":1}]'::jsonb,
    p_customer => '{"name":"Retry Buyer","phone":"9900000013"}'::jsonb,
    p_payment_method => 'upi',
    p_shipping_address => '{"addressLine1":"1 St","city":"Pune","state":"MH","postalCode":"411001"}'::jsonb,
    p_notes => null,
    p_idempotency_key => 'asrt-genuine-retry'
  );

  v_replay := public.place_online_order(
    p_items => '[{"productId":"23000000-0000-0000-0000-000000000002","quantity":1}]'::jsonb,
    p_customer => '{"name":"Retry Buyer","phone":"9900000013"}'::jsonb,
    p_payment_method => 'upi',
    p_shipping_address => '{"addressLine1":"1 St","city":"Pune","state":"MH","postalCode":"411001"}'::jsonb,
    p_notes => null,
    p_idempotency_key => 'asrt-genuine-retry'
  );

  if (v_replay ->> 'idempotent') <> 'true' then
    raise exception 'FAIL a genuine retry must replay, idempotent was %', coalesce(v_replay ->> 'idempotent','NULL');
  end if;
  if (v_replay ->> 'order_id') <> (v_first ->> 'order_id') then
    raise exception 'FAIL a genuine retry must return the SAME order';
  end if;
  if (v_replay ->> 'access_token') <> (v_first ->> 'access_token') then
    raise exception 'FAIL a genuine retry must return the same token it issued first';
  end if;
  raise notice 'PASS a genuine retry still replays the same order and token';
end
$$;

-- CONTROL: the same quantities split differently across lines is still a retry.
-- The fingerprint sums per product precisely so this is not a false conflict.
do $$
declare
  v_first jsonb;
  v_replay jsonb;
begin
  v_first := public.place_online_order(
    p_items => '[{"productId":"23000000-0000-0000-0000-000000000002","quantity":1},{"productId":"23000000-0000-0000-0000-000000000002","quantity":2}]'::jsonb,
    p_customer => '{"name":"Split Buyer","phone":"9900000014"}'::jsonb,
    p_payment_method => 'upi',
    p_shipping_address => '{"addressLine1":"1 St","city":"Pune","state":"MH","postalCode":"411001"}'::jsonb,
    p_notes => null,
    p_idempotency_key => 'asrt-split-retry'
  );

  v_replay := public.place_online_order(
    p_items => '[{"productId":"23000000-0000-0000-0000-000000000002","quantity":3}]'::jsonb,
    p_customer => '{"name":"Split Buyer","phone":"9900000014"}'::jsonb,
    p_payment_method => 'upi',
    p_shipping_address => '{"addressLine1":"1 St","city":"Pune","state":"MH","postalCode":"411001"}'::jsonb,
    p_notes => null,
    p_idempotency_key => 'asrt-split-retry'
  );

  if (v_replay ->> 'order_id') <> (v_first ->> 'order_id') then
    raise exception 'FAIL re-splitting the same quantities must count as a retry, not a conflict';
  end if;
  raise notice 'PASS re-splitting the same quantities across lines is still a retry';
end
$$;

-- ===========================================================================
-- 3. An anonymous caller cannot overwrite a customer record.
-- ===========================================================================
insert into public.customers (name, phone_normalized, email)
values ('Real Name', '+919900000020', 'real@example.test')
on conflict (phone_normalized) do nothing;

do $$
declare
  v_name text;
  v_email text;
begin
  perform public.place_online_order(
    p_items => '[{"productId":"23000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb,
    p_customer => '{"name":"ATTACKER","phone":"9900000020","email":"attacker@evil.test"}'::jsonb,
    p_payment_method => 'upi',
    p_shipping_address => '{"addressLine1":"1 St","city":"Pune","state":"MH","postalCode":"411001"}'::jsonb,
    p_notes => null,
    p_idempotency_key => 'asrt-customer-clobber'
  );

  select name, email into v_name, v_email
    from public.customers where phone_normalized = '+919900000020';

  if v_name <> 'Real Name' then
    raise exception 'FAIL the customer name was overwritten to %', coalesce(v_name,'NULL');
  end if;
  if v_email is distinct from 'real@example.test' then
    raise exception 'FAIL the customer email was overwritten to %', coalesce(v_email,'NULL');
  end if;
  raise notice 'PASS an anonymous order cannot overwrite the customer record';
end
$$;

-- CONTROL: a genuinely new phone number still creates the customer, and the
-- order is linked to it.
do $$
declare
  v_customer_id uuid;
  v_order_customer uuid;
begin
  perform public.place_online_order(
    p_items => '[{"productId":"23000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb,
    p_customer => '{"name":"Brand New","phone":"9900000021","email":"new@example.test"}'::jsonb,
    p_payment_method => 'upi',
    p_shipping_address => '{"addressLine1":"1 St","city":"Pune","state":"MH","postalCode":"411001"}'::jsonb,
    p_notes => null,
    p_idempotency_key => 'asrt-new-customer'
  );

  select id into v_customer_id from public.customers where phone_normalized = '+919900000021';
  if v_customer_id is null then
    raise exception 'FAIL a new phone number must still create a customer';
  end if;

  select customer_id into v_order_customer from public.orders
   where idempotency_key = 'asrt-new-customer';
  if v_order_customer is distinct from v_customer_id then
    raise exception 'FAIL the order must be linked to the customer it created';
  end if;
  raise notice 'PASS control: a new customer is created and linked';
end
$$;

-- ===========================================================================
-- 4. The POS sale cannot record more than the order total.
--
--    The defect: total=100.00 recorded=5000.00 gave balance=-4900.00 with a
--    derived payment_status of "paid", which every consumer hid.
-- ===========================================================================
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';

do $$
declare
  v_rejected boolean := false;
begin
  begin
    perform public.record_in_person_sale(
      p_items => '[{"productId":"23000000-0000-0000-0000-000000000005","quantity":1,"unitPrice":100}]'::jsonb,
      p_payment_method => 'cash',
      p_payments => '[{"amount":5000,"method":"cash"}]'::jsonb,
      p_customer => null,
      p_notes => 'over the total',
      p_idempotency_key => 'asrt-pos-over'
    );
  exception when others then
    v_rejected := sqlerrm = 'over_payment';
  end;

  if not v_rejected then
    raise exception 'FAIL a payment above the total must raise over_payment';
  end if;

  -- Nothing may be left behind: the whole sale is one transaction.
  if exists (select 1 from public.orders where idempotency_key = 'asrt-pos-over') then
    raise exception 'FAIL the rejected sale left an order behind';
  end if;
  if (select quantity from public.inventory_stock
       where product_id = '23000000-0000-0000-0000-000000000005') <> 50 then
    raise exception 'FAIL the rejected sale moved stock';
  end if;
  raise notice 'PASS an over-payment is refused and leaves nothing behind';
end
$$;

-- CONTROL: a payment equal to the total is accepted and leaves a zero balance.
do $$
declare
  v_order uuid;
  v_balance numeric;
begin
  v_order := public.record_in_person_sale(
    p_items => '[{"productId":"23000000-0000-0000-0000-000000000005","quantity":1,"unitPrice":100}]'::jsonb,
    p_payment_method => 'cash',
    p_payments => '[{"amount":100,"method":"cash"}]'::jsonb,
    p_customer => null,
    p_notes => 'exact',
    p_idempotency_key => 'asrt-pos-exact'
  ) ->> 'order_id';

  select balance into v_balance from public.v_order_financials where order_id = v_order;
  if v_balance <> 0 then
    raise exception 'FAIL control: an exact payment must leave a zero balance, got %', v_balance;
  end if;
  raise notice 'PASS control: a payment equal to the total is accepted';
end
$$;

-- CONTROL: two partial payments summing to the total are accepted.
do $$
declare
  v_order uuid;
  v_balance numeric;
begin
  v_order := public.record_in_person_sale(
    p_items => '[{"productId":"23000000-0000-0000-0000-000000000005","quantity":1,"unitPrice":100}]'::jsonb,
    p_payment_method => 'cash',
    p_payments => '[{"amount":30,"method":"cash"},{"amount":70,"method":"cash"}]'::jsonb,
    p_customer => null,
    p_notes => 'split',
    p_idempotency_key => 'asrt-pos-split'
  ) ->> 'order_id';

  select balance into v_balance from public.v_order_financials where order_id = v_order;
  if v_balance <> 0 then
    raise exception 'FAIL control: split payments summing to the total must be accepted, balance %', v_balance;
  end if;
  raise notice 'PASS control: split payments summing to the total are accepted';
end
$$;

-- CONTROL: a sale with no payments at all is a real state and is accepted.
do $$
declare
  v_order uuid;
  v_status text;
begin
  v_order := public.record_in_person_sale(
    p_items => '[{"productId":"23000000-0000-0000-0000-000000000005","quantity":1,"unitPrice":100}]'::jsonb,
    p_payment_method => 'cash',
    p_payments => null,
    p_customer => null,
    p_notes => 'unpaid',
    p_idempotency_key => 'asrt-pos-unpaid'
  ) ->> 'order_id';

  select payment_status into v_status from public.v_order_financials where order_id = v_order;
  if v_status <> 'unpaid' then
    raise exception 'FAIL control: an unpaid sale must derive "unpaid", got %', coalesce(v_status,'NULL');
  end if;
  raise notice 'PASS control: a sale with no payments derives "unpaid"';
end
$$;

-- ===========================================================================
-- 5. Two tender lines sharing a method and amount are both recorded.
--
--    The defect: the derived payments key was a function of (method, amount)
--    with no array position, so the pair collided and an unmapped 23505 rolled
--    the entire sale back.
-- ===========================================================================
do $$
declare
  v_order uuid;
  v_payments integer;
  v_keys integer;
  v_distinct integer;
begin
  v_order := public.record_in_person_sale(
    p_items => '[{"productId":"23000000-0000-0000-0000-000000000005","quantity":1,"unitPrice":100}]'::jsonb,
    p_payment_method => 'cash',
    p_payments => '[{"amount":50,"method":"cash"},{"amount":50,"method":"cash"}]'::jsonb,
    p_customer => null,
    p_notes => 'two identical tender lines',
    p_idempotency_key => 'asrt-tender-identical'
  ) ->> 'order_id';

  select count(*) into v_payments from public.payments where order_id = v_order;
  if v_payments <> 2 then
    raise exception 'FAIL both tender lines must be recorded, found %', v_payments;
  end if;

  select count(*), count(distinct idempotency_key) into v_keys, v_distinct
    from public.payments where order_id = v_order;
  if v_distinct <> v_keys then
    raise exception 'FAIL the two tender lines share an idempotency key (% of % distinct)', v_distinct, v_keys;
  end if;
  raise notice 'PASS two identical tender lines are both recorded with distinct keys';
end
$$;

-- CONTROL: retrying that whole sale must still replay, not duplicate.
do $$
declare
  v_replay jsonb;
  v_orders integer;
begin
  v_replay := public.record_in_person_sale(
    p_items => '[{"productId":"23000000-0000-0000-0000-000000000005","quantity":1,"unitPrice":100}]'::jsonb,
    p_payment_method => 'cash',
    p_payments => '[{"amount":50,"method":"cash"},{"amount":50,"method":"cash"}]'::jsonb,
    p_customer => null,
    p_notes => 'two identical tender lines',
    p_idempotency_key => 'asrt-tender-identical'
  );

  if (v_replay ->> 'idempotent') <> 'true' then
    raise exception 'FAIL control: retrying the sale must replay';
  end if;
  select count(*) into v_orders from public.orders where idempotency_key = 'asrt-tender-identical';
  if v_orders <> 1 then
    raise exception 'FAIL control: the retry created % orders, expected 1', v_orders;
  end if;
  raise notice 'PASS control: retrying a split-tender sale replays rather than duplicating';
end
$$;

-- ===========================================================================
-- 6. An inventory idempotency key cannot be reused for another product.
--
--    The defect: restock B with A's key returned A's result, reported
--    idempotent=true, and never restocked B.
-- ===========================================================================
do $$
declare
  v_a jsonb;
  v_conflict boolean := false;
  v_b_before integer;
  v_b_after integer;
  v_b_moves integer;
begin
  v_a := public.restock_product(
    '23000000-0000-0000-0000-000000000001', 5, 40, false, 'assertion A', 'asrt-inv-key'
  );
  if (v_a ->> 'idempotent') <> 'false' then
    raise exception 'FAIL the first restock must not be a replay';
  end if;

  -- Observed now, not assumed: earlier sections legitimately sold from B.
  select quantity into v_b_before from public.inventory_stock
   where product_id = '23000000-0000-0000-0000-000000000002';

  begin
    perform public.restock_product(
      '23000000-0000-0000-0000-000000000002', 7, 40, false, 'assertion B', 'asrt-inv-key'
    );
  exception when others then
    v_conflict := sqlerrm = 'idempotency_conflict';
  end;

  if not v_conflict then
    raise exception 'FAIL reusing a key for another product must raise idempotency_conflict';
  end if;

  select quantity into v_b_after from public.inventory_stock
   where product_id = '23000000-0000-0000-0000-000000000002';
  select count(*) into v_b_moves from public.inventory_movements
   where product_id = '23000000-0000-0000-0000-000000000002' and movement_type = 'restock';

  if v_b_after <> v_b_before then
    raise exception 'FAIL the refused restock moved product B from % to %', v_b_before, v_b_after;
  end if;
  if v_b_moves <> 0 then
    raise exception 'FAIL product B must have no restock movement, found %', v_b_moves;
  end if;
  raise notice 'PASS an inventory key cannot be reused for another product';
end
$$;

-- CONTROL: the SAME product and key still replays.
do $$
declare
  v_replay jsonb;
  v_moves integer;
begin
  v_replay := public.restock_product(
    '23000000-0000-0000-0000-000000000001', 5, 40, false, 'assertion A', 'asrt-inv-key'
  );
  if (v_replay ->> 'idempotent') <> 'true' then
    raise exception 'FAIL control: the same product and key must replay';
  end if;
  select count(*) into v_moves from public.inventory_movements
   where product_id = '23000000-0000-0000-0000-000000000001'
     and idempotency_key = 'asrt-inv-key';
  if v_moves <> 1 then
    raise exception 'FAIL control: the replay wrote % movements, expected 1', v_moves;
  end if;
  raise notice 'PASS control: the same product and key replays without a second movement';
end
$$;

-- CONTROL: an adjustment and a restock sharing a key do not replay each other.
do $$
declare
  v_conflict boolean := false;
begin
  begin
    perform public.adjust_stock(
      '23000000-0000-0000-0000-000000000001', -1, 'adjustment', 'assertion', 'asrt-inv-key'
    );
  exception when others then
    v_conflict := sqlerrm = 'idempotency_conflict';
  end;
  if not v_conflict then
    raise exception 'FAIL an adjustment must not replay a restock that shares its key';
  end if;
  raise notice 'PASS control: an adjustment cannot replay a restock sharing its key';
end
$$;

-- ===========================================================================
-- 7. record_payment still refuses more than the outstanding balance.
--
--    The concurrency half of this fix (the order row lock) cannot be expressed
--    here: `postgres --single` runs a single backend, so there is no second
--    transaction to race. The non-concurrent behaviour is pinned below and the
--    race belongs in supabase/tests/, where a second connection exists.
-- ===========================================================================
do $$
declare
  v_order uuid;
  v_rejected boolean := false;
  v_balance numeric;
begin
  v_order := public.record_in_person_sale(
    p_items => '[{"productId":"23000000-0000-0000-0000-000000000005","quantity":1,"unitPrice":100}]'::jsonb,
    p_payment_method => 'cash',
    p_payments => '[{"amount":40,"method":"cash"}]'::jsonb,
    p_customer => null,
    p_notes => 'part payment',
    p_idempotency_key => 'asrt-pay-order'
  ) ->> 'order_id';

  begin
    perform public.record_payment(v_order, 100, 'cash', 'too much', 'asrt-pay-over');
  exception when others then
    v_rejected := sqlerrm = 'over_payment';
  end;
  if not v_rejected then
    raise exception 'FAIL a payment above the balance must raise over_payment';
  end if;

  -- The refused payment must not have been written.
  select balance into v_balance from public.v_order_financials where order_id = v_order;
  if v_balance <> 60 then
    raise exception 'FAIL the refused payment changed the balance to %', v_balance;
  end if;

  -- CONTROL: the exact remaining balance is accepted.
  perform public.record_payment(v_order, 60, 'cash', 'settles', 'asrt-pay-rest');
  select balance into v_balance from public.v_order_financials where order_id = v_order;
  if v_balance <> 0 then
    raise exception 'FAIL control: settling the balance must leave 0, got %', v_balance;
  end if;
  raise notice 'PASS the payment cap still holds, and the exact balance is accepted';
end
$$;

-- CONTROL: a refund above what was received is refused, and the exact amount works.
do $$
declare
  v_order uuid;
  v_rejected boolean := false;
  v_net numeric;
begin
  v_order := public.record_in_person_sale(
    p_items => '[{"productId":"23000000-0000-0000-0000-000000000005","quantity":1,"unitPrice":100}]'::jsonb,
    p_payment_method => 'cash',
    p_payments => '[{"amount":100,"method":"cash"}]'::jsonb,
    p_customer => null,
    p_notes => 'refund subject',
    p_idempotency_key => 'asrt-refund-order'
  ) ->> 'order_id';

  begin
    perform public.refund_payment(v_order, 500, 'cash', 'too much', 'asrt-refund-over');
  exception when others then
    v_rejected := sqlerrm = 'over_refund';
  end;
  if not v_rejected then
    raise exception 'FAIL a refund above net_paid must raise over_refund';
  end if;

  perform public.refund_payment(v_order, 100, 'cash', 'full refund', 'asrt-refund-ok');
  select net_paid into v_net from public.v_order_financials where order_id = v_order;
  if v_net <> 0 then
    raise exception 'FAIL control: a full refund must leave net_paid 0, got %', v_net;
  end if;
  raise notice 'PASS the refund cap still holds, and a full refund is accepted';
end
$$;

-- Lifecycle edge cases. Appended to the order suite.
--
-- The happy path is covered above; these are the transitions that must be
-- REFUSED, and the pair that must be idempotent. Each refusal is paired with a
-- control that shows the operation works when it is legal, because an assertion
-- that only proves something is rejected passes just as well against a function
-- that rejects everything.

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000c4', 'edge@test.local')
on conflict (id) do nothing;
insert into public.admin_users (id, email)
values ('00000000-0000-0000-0000-0000000000c4', 'edge@test.local')
on conflict (id) do nothing;

insert into public.products (id, name, slug, sku, selling_price, purchase_cost, status) values
  ('24000000-0000-0000-0000-000000000001', 'Edge Item', 'edge-item', 'EG-1', 100, 40, 'active')
on conflict (id) do nothing;

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c4","role":"authenticated"}';
select public.set_initial_stock('24000000-0000-0000-0000-000000000001', 20, 40);
set request.jwt.claims = '{}';

-- ---------------------------------------------------------------------------
-- 8. The transition table refuses everything that is not the next step.
-- ---------------------------------------------------------------------------
do $$
declare
  v_order uuid;
  v_status text;
  v_rejected text := '';
begin
  v_order := public.place_online_order(
    p_items => '[{"productId":"24000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
    p_customer => '{"name":"Edge Buyer","phone":"9900000090"}'::jsonb,
    p_payment_method => 'upi',
    p_shipping_address => '{"addressLine1":"1 St","city":"Pune","state":"MH","postalCode":"411001"}'::jsonb,
    p_notes => null,
    p_idempotency_key => 'asrt-edge-order'
  ) ->> 'order_id';
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c4","role":"authenticated"}', false);

  -- pending -> shipped skips two steps and must be refused.
  begin
    perform public.update_order_status(v_order, 'shipped', null, null, null);
  exception when others then
    v_rejected := sqlerrm;
  end;
  if v_rejected <> 'invalid_transition' then
    raise exception 'FAIL skipping steps must raise invalid_transition, got %', coalesce(nullif(v_rejected,''),'no error');
  end if;

  -- Control: the legal single step is accepted.
  perform public.update_order_status(v_order, 'confirmed', null, null, null);
  select status into v_status from public.orders where id = v_order;
  if v_status <> 'confirmed' then
    raise exception 'FAIL control: pending -> confirmed must be accepted, status is %', v_status;
  end if;

  -- Going backwards is not a transition either.
  begin
    perform public.update_order_status(v_order, 'pending', null, null, null);
  exception when others then
    v_rejected := sqlerrm;
  end;
  if v_rejected <> 'invalid_transition' then
    raise exception 'FAIL going backwards must raise invalid_transition, got %', coalesce(nullif(v_rejected,''),'no error');
  end if;

  -- And the same target twice is refused the second time, because the order has
  -- already moved on.
  begin
    perform public.update_order_status(v_order, 'confirmed', null, null, null);
  exception when others then
    v_rejected := sqlerrm;
  end;
  if v_rejected <> 'invalid_transition' then
    raise exception 'FAIL repeating a completed step must be refused, got %', coalesce(nullif(v_rejected,''),'no error');
  end if;

  raise notice 'PASS only the single next step is accepted';
end
$$;

-- ---------------------------------------------------------------------------
-- 9. cancelled and returned are refused by update_order_status and must go
--    through cancel_order instead.
-- ---------------------------------------------------------------------------
do $$
declare
  v_order uuid;
  v_code text := '';
begin
  v_order := public.place_online_order(
    p_items => '[{"productId":"24000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb,
    p_customer => '{"name":"Route Buyer","phone":"9900000091"}'::jsonb,
    p_payment_method => 'upi',
    p_shipping_address => '{"addressLine1":"1 St","city":"Pune","state":"MH","postalCode":"411001"}'::jsonb,
    p_notes => null,
    p_idempotency_key => 'asrt-route-order'
  ) ->> 'order_id';
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c4","role":"authenticated"}', false);

  foreach v_code in array array['cancelled', 'returned'] loop
    declare
      v_err text := '';
    begin
      begin
        perform public.update_order_status(v_order, v_code::public.order_status, null, null, null);
      exception when others then
        v_err := sqlerrm;
      end;
      if v_err <> 'use_cancel_order' then
        raise exception 'FAIL % must raise use_cancel_order, got %', v_code, coalesce(nullif(v_err,''),'no error');
      end if;
    end;
  end loop;

  raise notice 'PASS cancelled and returned are routed to cancel_order';
end
$$;

-- ---------------------------------------------------------------------------
-- 10. A shipped order can no longer be cancelled.
-- ---------------------------------------------------------------------------
do $$
declare
  v_order uuid;
  v_stock integer;
  v_err text := '';
  v_rejected boolean := false;
begin
  v_order := public.place_online_order(
    p_items => '[{"productId":"24000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb,
    p_customer => '{"name":"Shipped Buyer","phone":"9900000092"}'::jsonb,
    p_payment_method => 'upi',
    p_shipping_address => '{"addressLine1":"1 St","city":"Pune","state":"MH","postalCode":"411001"}'::jsonb,
    p_notes => null,
    p_idempotency_key => 'asrt-shipped-order'
  ) ->> 'order_id';

  -- Walk it up to shipped: confirmed -> packed -> shipped.
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c4","role":"authenticated"}', false);
  perform public.update_order_status(v_order, 'confirmed', null, null, null);
  perform public.update_order_status(v_order, 'packed', null, null, null);
  perform public.update_order_status(v_order, 'shipped', null, 'Delhivery', 'TRK-1');

  select quantity into v_stock from public.inventory_stock
   where product_id = '24000000-0000-0000-0000-000000000001';

  begin
    perform public.cancel_order(v_order, 'too late', true, true, null);
  exception when others then
    v_rejected := sqlerrm = 'invalid_transition';
    v_err := sqlerrm;
  end;

  if not v_rejected then
    raise exception 'FAIL a shipped order must not be cancellable, got %', coalesce(nullif(v_err,''),'no error');
  end if;

  -- Nothing may have moved: the refusal happens before the restock.
  if (select quantity from public.inventory_stock
       where product_id = '24000000-0000-0000-0000-000000000001') <> v_stock then
    raise exception 'FAIL the refused cancel moved stock';
  end if;

  raise notice 'PASS a shipped order cannot be cancelled and nothing moved';
end
$$;

-- ---------------------------------------------------------------------------
-- 11. Cancelling an in-person sale outside the reversal window is refused.
--
--     The window is compared against the order's own timestamp, so this needs
--     the order to be old. Rewriting created_at is a direct table write, which is
--     fine here: this is a test arranging a fixture, not the application moving
--     an order.
-- ---------------------------------------------------------------------------
do $$
declare
  v_order uuid;
  v_stock integer;
  v_err text := '';
  v_rejected boolean := false;
begin

  v_order := public.record_in_person_sale(
    p_items => '[{"productId":"24000000-0000-0000-0000-000000000001","quantity":1,"unitPrice":100}]'::jsonb,
    p_payment_method => 'cash',
    p_payments => null,
    p_customer => null,
    p_notes => 'old sale',
    p_idempotency_key => 'asrt-old-sale'
  ) ->> 'order_id';
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c4","role":"authenticated"}', false);

  -- Age it well past the 24-hour default window.
  update public.orders set created_at = now() - interval '10 days' where id = v_order;

  select quantity into v_stock from public.inventory_stock
   where product_id = '24000000-0000-0000-0000-000000000001';

  begin
    perform public.cancel_order(v_order, 'too late', true, true, null);
  exception when others then
    v_rejected := sqlerrm = 'outside_reversal_window';
    v_err := sqlerrm;
  end;

  if not v_rejected then
    raise exception 'FAIL a 10-day-old in-person sale must raise outside_reversal_window, got %',
      coalesce(nullif(v_err,''),'no error');
  end if;

  if (select quantity from public.inventory_stock
       where product_id = '24000000-0000-0000-0000-000000000001') <> v_stock then
    raise exception 'FAIL the refused reversal moved stock';
  end if;

  -- CONTROL: the same sale inside the window IS reversible.
  update public.orders set created_at = now() - interval '1 hour' where id = v_order;
  perform public.cancel_order(v_order, 'customer changed mind', true, false, null);
  if (select status from public.orders where id = v_order) <> 'cancelled' then
    raise exception 'FAIL control: a sale inside the window must be reversible';
  end if;

  raise notice 'PASS the reversal window is enforced server-side, in both directions';
end
$$;

-- RAISE NOTICE is invisible in single-user mode; the success signal is a SELECT
-- because single-user echoes result rows to stdout.
select 'ALL ASSERTIONS PASSED' as result;
