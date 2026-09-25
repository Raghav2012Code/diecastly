-- Reporting views (admin) and public storefront views.
--
-- Admin views use security_invoker = true so base-table RLS (is_admin) applies.
-- Public views are deliberately DEFINER views that expose only safe columns and
-- are the ONLY thing anon is granted: anon has no base-table privileges, so
-- sensitive columns (purchase_cost, profit, customer data) are unreachable.

-- ---------------------------------------------------------------------------
-- Admin reporting views
-- ---------------------------------------------------------------------------

create view public.v_product_stock
with (security_invoker = true)
as
select
  p.id as product_id,
  p.name,
  p.sku,
  p.status,
  p.low_stock_threshold,
  coalesce(s.quantity, 0) as quantity,
  (coalesce(s.quantity, 0) = 0) as is_out_of_stock,
  (coalesce(s.quantity, 0) <= p.low_stock_threshold) as is_low_stock,
  p.purchase_cost,
  p.selling_price,
  p.category_id,
  p.supplier_id,
  p.updated_at
from public.products p
left join public.inventory_stock s on s.product_id = p.id;

create view public.v_products_admin
with (security_invoker = true)
as
select
  p.*,
  coalesce(s.quantity, 0) as quantity,
  cat.name as category_name,
  sup.name as supplier_name,
  (
    select pi.storage_path
    from public.product_images pi
    where pi.product_id = p.id and pi.is_primary
    order by pi.sort_order
    limit 1
  ) as primary_image_path
from public.products p
left join public.inventory_stock s on s.product_id = p.id
left join public.categories cat on cat.id = p.category_id
left join public.suppliers sup on sup.id = p.supplier_id;

create view public.v_low_stock
with (security_invoker = true)
as
select * from public.v_product_stock
where status = 'active' and quantity <= low_stock_threshold;

create view public.v_order_financials
with (security_invoker = true)
as
with paid as (
  select
    order_id,
    sum(case when status = 'received' and amount > 0 then amount else 0 end)::numeric(12, 2)
      as total_received,
    sum(case when status = 'refunded' and amount < 0 then -amount else 0 end)::numeric(12, 2)
      as total_refunded
  from public.payments
  group by order_id
)
select
  o.id as order_id,
  o.order_number,
  o.total as total_due,
  coalesce(paid.total_received, 0)::numeric(12, 2) as total_received,
  coalesce(paid.total_refunded, 0)::numeric(12, 2) as total_refunded,
  (coalesce(paid.total_received, 0) - coalesce(paid.total_refunded, 0))::numeric(12, 2) as net_paid,
  (o.total - (coalesce(paid.total_received, 0) - coalesce(paid.total_refunded, 0)))::numeric(12, 2)
    as balance,
  case
    when coalesce(paid.total_refunded, 0) > 0
      and (coalesce(paid.total_received, 0) - coalesce(paid.total_refunded, 0)) <= 0
      then 'refunded'
    when (coalesce(paid.total_received, 0) - coalesce(paid.total_refunded, 0)) >= o.total
      and o.total > 0
      then 'paid'
    when (coalesce(paid.total_received, 0) - coalesce(paid.total_refunded, 0)) > 0
      then 'partial'
    when o.payment_method = 'cod' and o.total > 0
      then 'cod_pending'
    else 'unpaid'
  end as payment_status
from public.orders o
left join paid on paid.order_id = o.id;

create view public.v_order_summary
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
  f.balance
from public.orders o
join public.v_order_financials f on f.order_id = o.id;

create view public.v_sales_daily
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
    as contribution_after_shipping
from public.orders o
where o.status not in ('cancelled', 'returned')
group by 1, 2;

create view public.v_product_profit
with (security_invoker = true)
as
select
  oi.product_id,
  coalesce(oi.product_name, '(deleted product)') as product_name,
  sum(oi.quantity)::integer as units_sold,
  sum(oi.line_total)::numeric(12, 2) as item_revenue,
  sum(oi.unit_cost * oi.quantity)::numeric(12, 2) as cogs,
  sum(oi.line_profit)::numeric(12, 2) as gross_profit
from public.order_items oi
join public.orders o on o.id = oi.order_id
where o.status not in ('cancelled', 'returned')
group by oi.product_id, oi.product_name;

create view public.v_customer_summary
with (security_invoker = true)
as
select
  c.id as customer_id,
  c.name,
  c.phone_normalized,
  c.email,
  count(o.id)::integer as orders_count,
  coalesce(
    sum(case when o.status not in ('cancelled', 'returned') then o.total else 0 end),
    0
  )::numeric(12, 2) as total_spent,
  max(o.created_at) as last_order_at
from public.customers c
left join public.orders o on o.customer_id = c.id
group by c.id;

-- ---------------------------------------------------------------------------
-- Public storefront views (definer; safe columns only)
-- ---------------------------------------------------------------------------

create view public.v_categories_public
as
select id, name, slug, parent_id, sort_order
from public.categories
where is_active = true;

create view public.v_products_public
as
select
  p.id,
  p.name,
  p.slug,
  p.brand,
  p.model,
  p.series,
  p.description,
  p.selling_price,
  p.category_id,
  p.is_featured,
  p.created_at,
  coalesce(s.quantity, 0) as quantity,
  (coalesce(s.quantity, 0) = 0) as is_out_of_stock,
  (coalesce(s.quantity, 0) <= p.low_stock_threshold) as is_low_stock,
  (
    select pi.storage_path
    from public.product_images pi
    where pi.product_id = p.id and pi.is_primary
    order by pi.sort_order
    limit 1
  ) as primary_image_path
from public.products p
left join public.inventory_stock s on s.product_id = p.id
where p.status = 'active';

create view public.v_public_settings
as
select
  business_name,
  business_phone,
  business_email,
  upi_id,
  upi_qr_path,
  currency,
  cod_enabled,
  default_shipping_fee,
  order_prefix
from public.settings
where id = true;
