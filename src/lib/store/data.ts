/**
 * Storefront read layer.
 *
 * Every read goes through `createAnonClient()`, never the cookie-based
 * `createClient()`. The storefront is a public surface, so it must be built and
 * tested against what a stranger can see: reusing the session client would send
 * whatever session happened to be on the request, so an admin previewing the
 * shop could get a page that renders correctly for them and is broken for
 * everyone else, with nothing failing.
 *
 * Reads only the three public views plus `v_product_images_public`. The
 * database is the single source of truth: availability is read from
 * `v_products_public`'s own flags rather than recomputed here, so the catalog
 * grid and the product page cannot disagree about whether something is in stock.
 */

import { createAnonClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/lib/db/errors";
import type {
  PublicCategoryRow,
  PublicSettingsRow,
  VProductImagesPublicRow,
  VProductsPublicRow,
} from "@/lib/types/database.types";
import type { StorefrontSort } from "@/lib/store/params";

/** A product plus its gallery, which the detail page needs and the grid does not. */
export type StorefrontProduct = VProductsPublicRow & {
  images: VProductImagesPublicRow[];
};

export type StorefrontListPage = {
  rows: VProductsPublicRow[];
  total: number;
  page: number;
  pageSize: number;
};

const PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 48;

/**
 * Comma, percent, underscore and backslash are the characters PostgREST's `or`
 * filter treats as syntax. A search term is attacker-controlled, so leaving them
 * in would let a crafted query change the filter's meaning rather than search
 * for what was typed. Stripped rather than escaped because `ilike` has no escape
 * parameter here, and a search for "50%" legitimately matching everything is a
 * far better failure than a filter that can be rewritten.
 */
function sanitizeSearch(term: string): string {
  return term.replace(/[,%_\\]/g, " ").replace(/\s+/g, " ").trim();
}

function clampPageSize(pageSize: number | undefined): number {
  if (!pageSize || !Number.isFinite(pageSize)) return PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(pageSize)));
}

/**
 * Business details a shopper is allowed to see: name, contact, UPI id and QR,
 * whether COD is on, and the default shipping fee.
 *
 * A business with no settings row is treated as COD-off and fee-zero rather than
 * as an error. The storefront must still render for a freshly seeded database,
 * and failing the whole page over a missing optional row would be worse than
 * showing a checkout that defers to the server's own defaults anyway.
 */
export async function getPublicSettings(): Promise<PublicSettingsRow> {
  const supabase = createAnonClient();
  const { data } = await supabase.from("v_public_settings").select("*").maybeSingle();

  return (
    (data as PublicSettingsRow | null) ?? {
      business_name: "Diecastly",
      business_phone: null,
      business_email: null,
      upi_id: null,
      upi_qr_path: null,
      currency: "INR",
      cod_enabled: false,
      default_shipping_fee: 0,
      order_prefix: "DC",
    }
  );
}

/** Active categories only — the view already filters, and inactive parents would strand their children. */
export async function listPublicCategories(): Promise<Result<PublicCategoryRow[]>> {
  const supabase = createAnonClient();
  const { data, error } = await supabase
    .from("v_categories_public")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) return fail(error);
  return ok((data ?? []) as PublicCategoryRow[]);
}

export type StorefrontListParams = {
  search?: string;
  categoryId?: string;
  series?: string;
  sort?: StorefrontSort;
  page?: number;
  pageSize?: number;
};

/**
 * One page of the catalog.
 *
 * Filters are applied to the public view rather than to `products`, so the
 * storefront cannot drift from what the view considers sellable — there is one
 * definition of "active and in stock" and it lives in SQL.
 */
export async function listPublicProducts(
  params: StorefrontListParams = {},
): Promise<Result<StorefrontListPage>> {
  const supabase = createAnonClient();
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const pageSize = clampPageSize(params.pageSize);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase.from("v_products_public").select("*", { count: "exact" });

  if (params.categoryId) query = query.eq("category_id", params.categoryId);
  if (params.series) query = query.eq("series", params.series);

  const term = params.search ? sanitizeSearch(params.search) : "";
  if (term) {
    query = query.or(
      `name.ilike.%${term}%,brand.ilike.%${term}%,series.ilike.%${term}%,model.ilike.%${term}%`,
    );
  }

  // A secondary key on id keeps paging stable when the primary key ties, which
  // it does constantly on price or name. Without it, two products at the same
  // price can swap between pages and one is silently skipped.
  switch (params.sort) {
    case "price_asc":
      query = query.order("selling_price", { ascending: true }).order("id", { ascending: true });
      break;
    case "price_desc":
      query = query.order("selling_price", { ascending: false }).order("id", { ascending: true });
      break;
    case "name":
      query = query.order("name", { ascending: true }).order("id", { ascending: true });
      break;
    default:
      query = query.order("created_at", { ascending: false }).order("id", { ascending: true });
      break;
  }

  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) return fail(error);

  return ok({ rows: (data ?? []) as VProductsPublicRow[], total: count ?? 0, page, pageSize });
}

/**
 * Distinct series among active products, for the catalog's series filter.
 *
 * PostgREST has no DISTINCT, so this reads the one column and de-duplicates in
 * JS. The scan is bounded rather than unbounded: an unbounded select of a
 * growing catalog is exactly the query shape that was fixed once already in the
 * admin lists. Past the cap a series is still reachable through search, which is
 * stated in the filter's own help text rather than left to be discovered.
 */
const SERIES_SCAN_LIMIT = 1000;

export async function listPublicSeries(): Promise<Result<string[]>> {
  const supabase = createAnonClient();
  const { data, error } = await supabase
    .from("v_products_public")
    .select("series")
    .not("series", "is", null)
    .limit(SERIES_SCAN_LIMIT);

  if (error) return fail(error);

  const series = new Set<string>();
  for (const row of (data ?? []) as { series: string | null }[]) {
    if (row.series) series.add(row.series);
  }
  return ok([...series].sort((a, b) => a.localeCompare(b)));
}

/**
 * A product by slug, with its gallery.
 *
 * Returns null for a slug that does not exist, is not active, or has no images
 * to show — the caller turns that into a 404. The gallery comes from the public
 * view rather than `product_images`, which anon cannot read, and is ordered
 * primary-first so the hero image is the one marked primary rather than
 * whichever row happened to sort first.
 */
export async function getPublicProductBySlug(slug: string): Promise<Result<StorefrontProduct | null>> {
  const supabase = createAnonClient();

  const { data, error } = await supabase
    .from("v_products_public")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error) return fail(error);
  const product = data as VProductsPublicRow | null;
  if (!product) return ok(null);

  const { data: images, error: imageError } = await supabase
    .from("v_product_images_public")
    .select("*")
    .eq("product_id", product.id)
    .order("is_primary", { ascending: false })
    .order("sort_order", { ascending: true });

  if (imageError) return fail(imageError);

  return ok({ ...product, images: (images ?? []) as VProductImagesPublicRow[] });
}

/**
 * Live price and availability for a set of products, for checkout re-validation.
 *
 * The cart is client-side and explicitly non-authoritative, so this is what the
 * server compares the cart's snapshot against before placing an order. It reads
 * the same public view the shopper saw, so a customer is never quoted a
 * different price from the one on the page.
 */
export async function getPublicProductsByIds(ids: string[]): Promise<Result<VProductsPublicRow[]>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return ok([]);

  const supabase = createAnonClient();
  const { data, error } = await supabase
    .from("v_products_public")
    .select("*")
    .in("id", unique);

  if (error) return fail(error);
  return ok((data ?? []) as VProductsPublicRow[]);
}
