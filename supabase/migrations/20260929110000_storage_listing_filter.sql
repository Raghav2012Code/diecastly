-- Stop anon from ENUMERATING images of non-active products through Storage.
--
-- THE DEFECT
--
-- security.md §3 justifies v_product_images_public by saying that widening a
-- grant on product_images "would expose every column of every image row for
-- every product, including drafts and archived products, whose photography must
-- stay private". The view keeps that promise: it filters to status = 'active'.
--
-- But the promise was broken one layer up. The bucket is `public = true`, and
-- 20260925120700 granted anon a SELECT policy over every row in it:
--
--   create policy product_images_public_read on storage.objects
--     for select to anon, authenticated using (bucket_id = 'product-images');
--
-- That policy is what authorises the Storage API's object-listing endpoint, so
-- anon could list every image path in the bucket, including draft and archived
-- products, and then read any of them by URL — without ever touching the view.
-- The view's row filter was doing nothing for the surface that actually served
-- the files.
--
-- WHY A POLICY CANNOT JUST JOIN product_images
--
-- The obvious policy is `and exists (select 1 from public.product_images ...)`,
-- and it does not work: RLS policy expressions are evaluated as the INVOKING
-- role, and `anon` has no SELECT on public.product_images — deliberately, since
-- that grant is the very hole being closed. Measured, not assumed: the first
-- attempt at this migration's assertion failed with "permission denied for table
-- product_images" the moment anon could reach the storage schema at all. Giving
-- anon that grant to make a policy work would recreate the vulnerability.
--
-- So the check is a `security definer` helper instead — the same pattern as
-- is_admin() and require_admin(), which are already used inside policies in
-- this schema for the same reason.
--
-- WHAT THIS DOES AND DOES NOT ACHIEVE — stated plainly
--
-- It removes ENUMERABILITY. It does not make a draft photo private: the bucket
-- is `public = true`, so anyone who already knows a path can still fetch the
-- bytes, and the RLS policy does not gate that. The realistic way a path becomes
-- known is by listing the bucket, so closing the listing closes the practical
-- exposure, but the two are different claims and the second is not achieved
-- here. Genuinely private draft photography would need a non-public bucket,
-- which changes delivery for the storefront as well (no CDN, signed URLs) and
-- is a product decision rather than a hardening fix.
--
-- The helper is deliberately shaped as "is this path listable" rather than "is
-- this product active", so a path belonging to no product row at all — the UPI
-- QR in settings.upi_qr_path lives in this same bucket — is still listable and
-- the storefront keeps rendering it. Only paths known to belong to a non-active
-- product are hidden, so this change cannot affect active product images.
--
-- The disclosure the EXECUTE grant creates is one boolean about a path the
-- caller must already have guessed; object names are `<product-uuid>/<random>.<ext>`,
-- and a public bucket already serves any known path regardless of what this
-- function says. It therefore reveals nothing the bucket does not.

create or replace function public.is_listable_product_image(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
      from public.product_images pi
      join public.products p on p.id = pi.product_id
     where pi.storage_path = p_name
       and p.status <> 'active'
  );
$$;

-- Same rule as every other function here: executable by PUBLIC by default, and
-- executable by nothing except the two roles whose policies call it.
revoke execute on function public.is_listable_product_image(text)
  from public, anon, authenticated;
grant execute on function public.is_listable_product_image(text) to anon, authenticated;

drop policy if exists product_images_public_read on storage.objects;
create policy product_images_public_read on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'product-images'
    and public.is_listable_product_image(name)
  );

-- Admin sees everything in the bucket, unfiltered. A policy restricting anon
-- must not quietly restrict the seller: an admin has to be able to list and
-- preview a draft's images before publishing it. Separate policies, because RLS
-- policies are permissive-OR'd per role, so this one applies only when
-- `authenticated` acts and leaves the anon policy above intact.
--
-- This split is asserted in scripts/catalog-assertions.sql §11 — the first
-- version of this migration put both roles in one policy and the admin control
-- failed, which is the whole reason the control exists.
drop policy if exists product_images_admin_read on storage.objects;
create policy product_images_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'product-images');
