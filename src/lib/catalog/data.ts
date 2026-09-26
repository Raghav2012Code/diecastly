import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import * as rpc from "@/lib/db/rpc";
import { fail, ok, type Result } from "@/lib/db/errors";
import {
  slugify,
  type CategoryInput,
  type ProductCreateInput,
  type ProductInput,
  type ProductUpdateInput,
  type SupplierInput,
} from "@/lib/validation/catalog";
import type {
  CategoryRow,
  ProductImageRow,
  ProductRow,
  ProductStatus,
  SellableProduct,
  SupplierRow,
  VProductsAdminRow,
} from "@/lib/types/database.types";
import { PRODUCT_IMAGE_BUCKET } from "@/lib/storage";

/**
 * Catalog data module. Reads use the admin view; metadata writes go through
 * RLS-guarded table access. Stock is never touched here — that is the
 * inventory module's job via the atomic RPCs.
 */

export type ProductStockFilter = "low" | "out";
export type ProductSort = "newest" | "name" | "price" | "cost" | "stock";

export type ProductListParams = {
  search?: string;
  status?: ProductStatus | "all";
  categoryId?: string | null;
  brand?: string | null;
  stock?: ProductStockFilter | null;
  sort?: ProductSort;
  page?: number;
  pageSize?: number;
};

export type ProductListPage = {
  rows: VProductsAdminRow[];
  total: number;
  page: number;
  pageSize: number;
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function clampPageSize(pageSize: number | undefined): number {
  if (!pageSize || Number.isNaN(pageSize)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(pageSize)));
}

function sanitizeSearch(term: string): string {
  return term
    .trim()
    .replace(/[,()*%\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Column predicates for the stock filters, applied inside the paginated query.
 *
 * This used to fetch the id of *every* matching product with no limit and then
 * pass that whole list to `.in()`, which embeds it in the request URL. Past a
 * few thousand matching products the request outgrew what the query layer
 * accepts and the product list stopped loading. Filtering in the query keeps
 * the request bounded and the count exact; capping the id list instead would
 * silently truncate the results and report a count that is not the true count.
 */
const STOCK_FILTER_COLUMN = {
  low: "is_low_stock",
  out: "is_out_of_stock",
} as const;

export async function listProducts(params: ProductListParams = {}): Promise<Result<ProductListPage>> {
  const supabase = await createClient();
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const pageSize = clampPageSize(params.pageSize);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase.from("v_products_admin").select("*", { count: "exact" });
  if (params.stock) query = query.eq(STOCK_FILTER_COLUMN[params.stock], true);
  if (params.status && params.status !== "all") query = query.eq("status", params.status);
  if (params.categoryId) query = query.eq("category_id", params.categoryId);
  if (params.brand) query = query.ilike("brand", params.brand.trim());

  const term = params.search ? sanitizeSearch(params.search) : "";
  if (term) {
    query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%`);
  }

  switch (params.sort) {
    case "name":
      query = query.order("name", { ascending: true });
      break;
    case "price":
      query = query.order("selling_price", { ascending: false });
      break;
    case "cost":
      query = query.order("purchase_cost", { ascending: false });
      break;
    case "stock":
      query = query.order("quantity", { ascending: true });
      break;
    default:
      query = query.order("created_at", { ascending: false });
      break;
  }

  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) return fail(error);

  return ok({
    rows: (data ?? []) as VProductsAdminRow[],
    total: count ?? 0,
    page,
    pageSize,
  });
}

export async function getProduct(id: string): Promise<Result<VProductsAdminRow | null>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("v_products_admin").select("*").eq("id", id).maybeSingle();
  if (error) return fail(error);
  return ok((data as VProductsAdminRow | null) ?? null);
}

// ---------------------------------------------------------------------------
// Sellable catalog (Record Sale / POS)
// ---------------------------------------------------------------------------

/** Upper bound on the working catalog streamed to the till. */
export const SELLABLE_LIMIT = 2000;

const SELLABLE_COLUMNS =
  "id, name, sku, barcode, brand, series, selling_price, quantity, low_stock_threshold, primary_image_path, status";

export type SellableCatalog = {
  items: SellableProduct[];
  total: number;
  capped: boolean;
};

/**
 * The active catalog for the till, loaded once so search is instant and a
 * barcode scanner (type + Enter) needs no round-trip. `capped` tells the client
 * whether it must fall back to `searchSellableProducts` for a term that has no
 * local match.
 */
export async function listSellableProducts(): Promise<Result<SellableCatalog>> {
  const supabase = await createClient();
  const { data, error, count } = await supabase
    .from("v_products_admin")
    .select(SELLABLE_COLUMNS, { count: "exact" })
    .eq("status", "active")
    .order("name", { ascending: true })
    .range(0, SELLABLE_LIMIT - 1);
  if (error) return fail(error);

  const items = (data ?? []) as unknown as SellableProduct[];
  const total = count ?? items.length;
  return ok({ items, total, capped: total > items.length });
}

/** Server-side search, used only when the local catalog has been capped. */
export async function searchSellableProducts(
  term: string,
  limit = 30,
): Promise<Result<SellableProduct[]>> {
  const supabase = await createClient();
  const cleaned = sanitizeSearch(term);
  const capped = Math.min(50, Math.max(1, Math.trunc(limit)));

  let query = supabase
    .from("v_products_admin")
    .select(SELLABLE_COLUMNS)
    .eq("status", "active")
    .order("name", { ascending: true })
    .limit(capped);

  if (cleaned) {
    query = query.or(
      `name.ilike.%${cleaned}%,sku.ilike.%${cleaned}%,barcode.ilike.%${cleaned}%,brand.ilike.%${cleaned}%`,
    );
  }

  const { data, error } = await query;
  if (error) return fail(error);
  return ok((data ?? []) as unknown as SellableProduct[]);
}

export async function listProductImages(productId: string): Promise<Result<ProductImageRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_images")
    .select("*")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return fail(error);
  return ok((data ?? []) as ProductImageRow[]);
}

export async function hasInitialStock(productId: string): Promise<Result<boolean>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_movements")
    .select("id")
    .eq("product_id", productId)
    .eq("movement_type", "initial")
    .limit(1)
    .maybeSingle();
  if (error) return fail(error);
  return ok(Boolean(data));
}

export async function listBrands(): Promise<Result<string[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("brand")
    .not("brand", "is", null)
    .order("brand", { ascending: true });
  if (error) return fail(error);
  const brands = Array.from(
    new Set(((data ?? []) as { brand: string | null }[]).map((row) => row.brand).filter(Boolean) as string[]),
  );
  return ok(brands);
}

/**
 * Finds a slug that is free to use.
 *
 * `excludeId` is the row being updated. Without it the helper treats the row's
 * own current slug as a collision, so saving a product with an empty slug field
 * rewrote its public URL from `ferrari-458` to `ferrari-458-2` — silently, and
 * breaking any existing link to the product.
 */
async function uniqueSlug(
  supabase: SupabaseClient,
  table: "products" | "categories",
  base: string,
  excludeId?: string,
): Promise<Result<string>> {
  const safeBase = base || "item";
  let candidate = safeBase;
  // Start at the first variant so the sequence has no gap, and stay
  // deterministic: a slug must be reproducible, so there is no timestamp
  // fallback.
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .eq("slug", candidate)
      .neq("id", excludeId ?? "00000000-0000-0000-0000-000000000000");
    if (error) return fail(error);
    if (!data) return ok(candidate);
    candidate = `${safeBase}-${attempt}`;
  }
  return fail({
    message: `Could not find a free slug for "${safeBase}" after 50 attempts. Set one explicitly.`,
  });
}

function productColumns(input: ProductInput, slug: string) {
  return {
    name: input.name,
    slug,
    brand: input.brand,
    model: input.model,
    series: input.series,
    category_id: input.categoryId,
    supplier_id: input.supplierId,
    description: input.description,
    sku: input.sku,
    barcode: input.barcode,
    purchase_cost: input.purchaseCost,
    selling_price: input.sellingPrice,
    low_stock_threshold: input.lowStockThreshold,
    status: input.status,
    is_featured: input.isFeatured,
  };
}

export async function createProduct(input: ProductCreateInput): Promise<Result<ProductRow>> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  const slugResult = await uniqueSlug(supabase, "products", input.slug ?? slugify(input.name));
  if (!slugResult.ok) return slugResult;

  const { data, error } = await supabase
    .from("products")
    .insert({ ...productColumns(input, slugResult.data), created_by: userData.user?.id ?? null })
    .select("*")
    .single();
  if (error) return fail(error);
  return ok(data as ProductRow);
}

export async function updateProduct(id: string, input: ProductUpdateInput): Promise<Result<ProductRow>> {
  const supabase = await createClient();

  let slug = input.slug;
  if (!slug) {
    const slugResult = await uniqueSlug(supabase, "products", slugify(input.name), id);
    if (!slugResult.ok) return slugResult;
    slug = slugResult.data;
  }

  const { data, error } = await supabase
    .from("products")
    .update(productColumns(input, slug))
    .eq("id", id)
    .select("*")
    .single();
  if (error) return fail(error);
  return ok(data as ProductRow);
}

export async function setProductStatus(id: string, status: ProductStatus): Promise<Result<ProductRow>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .update({ status })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return fail(error);
  return ok(data as ProductRow);
}

export async function updateProductThreshold(
  productId: string,
  lowStockThreshold: number,
): Promise<Result<ProductRow>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .update({ low_stock_threshold: lowStockThreshold })
    .eq("id", productId)
    .select("*")
    .single();
  if (error) return fail(error);
  return ok(data as ProductRow);
}

/** Toggles the featured flag without touching any other metadata. */
export async function setProductFeatured(id: string, isFeatured: boolean): Promise<Result<ProductRow>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .update({ is_featured: isFeatured })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return fail(error);
  return ok(data as ProductRow);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listCategories(includeInactive = false): Promise<Result<CategoryRow[]>> {
  const supabase = await createClient();
  let query = supabase.from("categories").select("*").order("sort_order", { ascending: true }).order("name");
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) return fail(error);
  return ok((data ?? []) as CategoryRow[]);
}

export async function createCategory(input: CategoryInput): Promise<Result<CategoryRow>> {
  const supabase = await createClient();
  const slugResult = await uniqueSlug(supabase, "categories", input.slug ?? slugify(input.name));
  if (!slugResult.ok) return slugResult;

  const { data, error } = await supabase
    .from("categories")
    .insert({
      name: input.name,
      slug: slugResult.data,
      parent_id: input.parentId,
      sort_order: input.sortOrder,
      is_active: input.isActive,
    })
    .select("*")
    .single();
  if (error) return fail(error);
  return ok(data as CategoryRow);
}

export async function updateCategory(id: string, input: CategoryInput): Promise<Result<CategoryRow>> {
  const supabase = await createClient();

  let slug = input.slug;
  if (!slug) {
    const slugResult = await uniqueSlug(supabase, "categories", slugify(input.name), id);
    if (!slugResult.ok) return slugResult;
    slug = slugResult.data;
  }

  const { data, error } = await supabase
    .from("categories")
    .update({
      name: input.name,
      slug,
      parent_id: input.parentId,
      sort_order: input.sortOrder,
      is_active: input.isActive,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return fail(error);
  return ok(data as CategoryRow);
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export async function listSuppliers(includeInactive = false): Promise<Result<SupplierRow[]>> {
  const supabase = await createClient();
  let query = supabase.from("suppliers").select("*").order("name", { ascending: true });
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) return fail(error);
  return ok((data ?? []) as SupplierRow[]);
}

export async function createSupplier(input: SupplierInput): Promise<Result<SupplierRow>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      name: input.name,
      contact_name: input.contactName,
      phone: input.phone,
      email: input.email,
      notes: input.notes,
      is_active: input.isActive,
    })
    .select("*")
    .single();
  if (error) return fail(error);
  return ok(data as SupplierRow);
}

export async function updateSupplier(id: string, input: SupplierInput): Promise<Result<SupplierRow>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .update({
      name: input.name,
      contact_name: input.contactName,
      phone: input.phone,
      email: input.email,
      notes: input.notes,
      is_active: input.isActive,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return fail(error);
  return ok(data as SupplierRow);
}

// ---------------------------------------------------------------------------
// Product images
//
// All three mutations delegate to security-definer RPCs so each is one
// transaction. They are RPCs for ATOMICITY, not encapsulation: product_images is
// metadata, and D4 otherwise keeps metadata on the RLS lane. See D47.
//
// Each was broken as a sequence of independent client statements:
//
//   * set-primary cleared every primary then set the new one. The partial unique
//     index forbids the reverse order, so a failure between the two left the
//     product with no primary at all.
//   * reorder issued one UPDATE per image, so a mid-loop failure left the order
//     half-applied while the action reported failure.
//   * delete promoted the successor BEFORE deleting the old primary, which the
//     unique index forbids outright. Verified against PostgreSQL 18.6: the
//     promotion raised a unique violation, the function returned an error, and
//     the delete never ran - so deleting a primary image did nothing at all.
// ---------------------------------------------------------------------------

/**
 * Makes `imageId` the product's primary image. The database guarantees exactly
 * one primary afterwards, so there is no window with none.
 */
export async function setPrimaryImage(productId: string, imageId: string): Promise<Result<null>> {
  const supabase = await createClient();
  return rpc.setPrimaryImage(supabase, { productId, imageId });
}

export async function addProductImage(input: {
  productId: string;
  storagePath: string;
  altText: string | null;
  isPrimary: boolean;
}): Promise<Result<ProductImageRow>> {
  const supabase = await createClient();

  const { data: last } = await supabase
    .from("product_images")
    .select("sort_order")
    .eq("product_id", input.productId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = ((last as { sort_order: number } | null)?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("product_images")
    .insert({
      product_id: input.productId,
      storage_path: input.storagePath,
      alt_text: input.altText,
      sort_order: nextOrder,
      // Never ask for the primary flag on insert. A BEFORE INSERT trigger makes a
      // product's FIRST image its primary automatically, so a product can never
      // end up holding an image with no primary. Claiming the flag here instead
      // would collide with the partial unique index whenever the product already
      // had a primary. Changing which image is primary goes through
      // setPrimaryImage, which is one transaction.
      is_primary: false,
    })
    .select("*")
    .single();
  if (error) return fail(error);

  const row = data as ProductImageRow;
  if (input.isPrimary) {
    const primary = await setPrimaryImage(input.productId, row.id);
    if (!primary.ok) return primary;
    row.is_primary = true;
  }
  return ok(row);
}

export async function updateImageAlt(
  imageId: string,
  altText: string | null,
): Promise<Result<null>> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("product_images")
    .update({ alt_text: altText })
    .eq("id", imageId);
  if (error) return fail(error);
  return ok(null);
}

/**
 * Sets the display order of a product's images.
 *
 * The ids must be exactly that product's images, in the wanted order. A partial
 * or foreign set is rejected and nothing is written, rather than silently
 * dropping the omitted images out of the ordering. The product is derived from
 * the ids, so the action payload is unchanged.
 *
 * `sortOrder` is not sent: the database assigns position from the array order,
 * so a caller cannot produce two images sharing a sort_order.
 */
export async function reorderProductImages(
  images: { id: string; sortOrder: number }[],
): Promise<Result<null>> {
  if (images.length === 0) return ok(null);
  const supabase = await createClient();
  return rpc.reorderProductImages(supabase, { imageIds: images.map((image) => image.id) });
}

/**
 * Deletes an image, promoting a successor in the same transaction if it was the
 * primary - so a product with images always has a primary image.
 *
 * The storage object is removed afterwards rather than inside the transaction: a
 * failure there leaves an orphaned file, which is recoverable, whereas the
 * reverse order would leave a row pointing at a file that no longer exists.
 */
export async function deleteProductImage(imageId: string): Promise<Result<null>> {
  const supabase = await createClient();

  const deleted = await rpc.deleteProductImage(supabase, { imageId });
  if (!deleted.ok) return deleted;

  if (deleted.data) {
    await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([deleted.data]);
  }
  return ok(null);
}
