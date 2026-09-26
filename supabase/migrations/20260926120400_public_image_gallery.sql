-- Public product-image gallery.
--
-- ux.md requires an image gallery on the product detail page, but
-- v_products_public exposes only `primary_image_path` — a single path — and anon
-- has no base-table privileges, so product_images was unreachable. The gallery
-- was therefore not buildable from the existing public surface.
--
-- This adds the missing public view rather than widening an existing grant,
-- because widening `product_images` to anon would expose every column of every
-- image row for every product, including drafts and archived products whose
-- images must stay private.
--
-- It follows the convention documented in 20260925120400_views.sql: public
-- views are deliberately DEFINER views carrying only safe columns, and are the
-- only objects anon is granted. Admin views use security_invoker so base-table
-- RLS applies; this one must not, or anon would need base-table grants and the
-- whole public-surface design would collapse.
--
-- Columns are limited to what a gallery needs. Notably absent: anything from
-- products other than the active-status filter, and anything from
-- inventory_stock — availability is already on v_products_public and must be
-- read from one place, not recomputed here where it could disagree.

create or replace view public.v_product_images_public
as
select
  pi.id,
  pi.product_id,
  pi.storage_path,
  pi.alt_text,
  pi.sort_order,
  pi.is_primary
from public.product_images pi
join public.products p on p.id = pi.product_id
where p.status = 'active';

-- Views get no default PUBLIC privilege (unlike functions, which get EXECUTE),
-- so an explicit grant is all that is required. Mirrors the existing public
-- view grants in 20260925120600_rls_grants.sql.
grant select on public.v_product_images_public to anon, authenticated;
