-- Add the stock flags to the admin product view.
--
-- listProducts applied its low/out-of-stock filter by first fetching the id of
-- every matching product with no limit and then passing that whole list to an
-- `in` filter, which embeds it in the request URL. Past a few thousand
-- matching products the request outgrew what PostgREST accepts and the product
-- list stopped loading.
--
-- The flags now live on the view the product list already queries, so the
-- filter is a predicate on the same paginated read and the count stays exact.
-- This is additive: the two columns are appended, and no existing column moves,
-- so `create or replace` is valid and every current consumer is unaffected.
--
-- The same two expressions already exist on v_product_stock; they are repeated
-- rather than joined because a view may not reference another view's columns in
-- its select list without a join, and a join here would duplicate the product
-- scan.

create or replace view public.v_products_admin
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
  ) as primary_image_path,
  (coalesce(s.quantity, 0) = 0) as is_out_of_stock,
  (coalesce(s.quantity, 0) <= p.low_stock_threshold) as is_low_stock
from public.products p
left join public.inventory_stock s on s.product_id = p.id
left join public.categories cat on cat.id = p.category_id
left join public.suppliers sup on sup.id = p.supplier_id;

-- The inventory list's "Recently changed" sort ordered by v_product_stock.updated_at,
-- which is products.updated_at. That column only moves on a *metadata* write,
-- via the products update trigger. A restock, adjustment, opening-stock entry or
-- sale updates inventory_stock.updated_at instead, so restocking fifteen
-- products and sorting by "Recently changed" produced no reordering at all —
-- the option promised something the query did not deliver.
--
-- stock_changed_at is the later of the two, so the sort means "changed" in the
-- sense an admin reading the label would expect: either a metadata edit or a
-- stock movement. Appended, so no existing column moves.
create or replace view public.v_product_stock
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
  p.updated_at,
  greatest(p.updated_at, coalesce(s.updated_at, p.updated_at)) as stock_changed_at
from public.products p
left join public.inventory_stock s on s.product_id = p.id;
