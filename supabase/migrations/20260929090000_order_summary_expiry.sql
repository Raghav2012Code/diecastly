-- Surface the stock-hold expiry on the admin order summary.
--
-- THE GAP THIS CLOSES
--
-- D18 created orders.expires_at to mark stock held by unpaid online orders, and
-- v_order_summary is the view every admin list and queue reads — but it never
-- selected that column. So the admin could see a pending order and never the
-- deadline they were meant to review it against. The queue UI (Stage 4) reads
-- through listOpenOrders, which selects from this view, so the column has to
-- live here rather than in a second query — one mechanism, not two.
--
-- TWO THINGS THAT ARE LOAD-BEARING HERE
--
-- 1. CREATE OR REPLACE VIEW drops the view's ACL. 20260925120600_rls_grants.sql
--    granted SELECT on this view to `authenticated`, so that grant is re-issued
--    below or the orders list, the queue and the dashboard all fail with a
--    permission error.
-- 2. The column is appended last. CREATE OR REPLACE matches columns by
--    position, not by name, so inserting expires_at after created_at renames
--    every column below it (verified: "cannot change name of view column
--    subtotal to expires_at"). Appending last is the only position it permits.

create or replace view public.v_order_summary
with (security_invoker = true)
as
select
  o.id as order_id,
  o.order_number,
  o.channel,
  o.status,
  o.customer_id,
  o.customer_name,
  o.customer_phone,
  o.payment_method,
  o.created_at,
  o.subtotal,
  o.discount_total,
  o.shipping_fee,
  o.shipping_cost,
  o.total,
  o.cost_total,
  (o.subtotal - o.cost_total)::numeric(12, 2) as gross_profit,
  ((o.subtotal - o.cost_total) + o.shipping_fee - o.shipping_cost)::numeric(12, 2)
    as contribution_after_shipping,
  f.payment_status,
  f.net_paid,
  f.balance,
  o.expires_at
from public.orders o
join public.v_order_financials f on f.order_id = o.id;

-- Not optional: see point 1 above.
grant select on public.v_order_summary to authenticated;
