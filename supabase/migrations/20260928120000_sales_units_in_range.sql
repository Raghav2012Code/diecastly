-- Units sold, scoped to the same day range as every other sales figure.
--
-- THE DEFECT THIS FIXES
--
-- v_product_profit groups by product and carries no date column at all, so
-- summing it yields a LIFETIME unit count. getSalesTotals() takes a range and
-- honoured it for revenue, profit and COGS, but returned that lifetime number as
-- `unitsSold` inside the range. So the dashboard KPI rendered an all-time figure
-- under a header reading "Today", and /admin/sales printed it beneath a
-- from/to header - and nothing reconciled the two, because every money figure
-- was range-scoped and that one was not. The Orders card was a ratio of two
-- different populations.
--
-- WHY THE VIEW IS CHANGED RATHER THAN THE QUERY
--
-- D61 chose v_product_profit because v_sales_daily counts ORDERS, and labelling
-- an order count "units" would overstate every multi-item order by its line
-- count. That reasoning is still correct. The fix is therefore to make the daily
-- view report units *as well as* orders, so both figures come from one
-- range-scoped source and cannot disagree about which orders are in scope.
-- Switching the query to a differently-shaped view would have left the same trap
-- one refactor away.
--
-- THREE THINGS THAT ARE LOAD-BEARING HERE
--
-- 1. The lateral aggregates per order with no GROUP BY, so it returns exactly one
--    row per order and the outer grain stays (sale_date, channel). Adding
--    order_items to the outer FROM would have multiplied orders_count by the
--    line count - the precise error D61 was written to avoid.
-- 2. It is a LEFT join. An inner join would silently drop any order with no items
--    and quietly corrupt orders_count, revenue and profit with it.
-- 3. CREATE OR REPLACE VIEW drops the view's ACL. 20260925120600_rls_grants.sql
--    granted SELECT on this view to `authenticated`, so that grant has to be
--    re-issued below or every admin report fails with a permission error. The
--    column is also appended last, which is the only position CREATE OR REPLACE
--    permits.

create or replace view public.v_sales_daily
with (security_invoker = true)
as
select
  (o.created_at at time zone 'Asia/Kolkata')::date as sale_date,
  o.channel,
  count(*)::integer as orders_count,
  sum(o.subtotal)::numeric(12, 2) as item_revenue,
  sum(o.shipping_fee)::numeric(12, 2) as shipping_revenue,
  sum(o.total)::numeric(12, 2) as revenue,
  sum(o.cost_total)::numeric(12, 2) as cogs,
  sum(o.subtotal - o.cost_total)::numeric(12, 2) as gross_profit,
  sum((o.subtotal - o.cost_total) + o.shipping_fee - o.shipping_cost)::numeric(12, 2)
    as contribution_after_shipping,
  sum(u.units)::integer as units_sold
from public.orders o
left join lateral (
  select coalesce(sum(oi.quantity), 0)::integer as units
  from public.order_items oi
  where oi.order_id = o.id
) u on true
where o.status not in ('cancelled', 'returned')
group by 1, 2;

-- Not optional: see point 3 above.
grant select on public.v_sales_daily to authenticated;
