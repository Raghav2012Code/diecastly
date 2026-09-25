import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/lib/db/errors";
import type {
  InventoryMovementWithProduct,
  InventoryRow,
  MovementType,
  VProductStockRow,
  VProductsAdminRow,
} from "@/lib/types/database.types";

/**
 * Inventory data module: stock reads, movement reads, and the three stock RPCs
 * (wrapped in `lib/db/rpc.ts`). Inventory tables are never written directly.
 */

export type InventoryScope = "all" | "low" | "out" | "archived";
export type InventorySort = "name" | "stock" | "threshold" | "newest";

export type InventoryListParams = {
  search?: string;
  scope?: InventoryScope;
  categoryId?: string | null;
  supplierId?: string | null;
  sort?: InventorySort;
  page?: number;
  pageSize?: number;
};

export type InventoryPage = {
  rows: InventoryRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type MovementListParams = {
  productId?: string | null;
  movementType?: MovementType | null;
  source?: "admin" | "storefront" | "system" | null;
  page?: number;
  pageSize?: number;
};

export type MovementPage = {
  rows: InventoryMovementWithProduct[];
  total: number;
  page: number;
  pageSize: number;
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function clampPage(pageSize: number | undefined): number {
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

async function enrichWithCatalog(
  supabase: SupabaseClient,
  stockRows: VProductStockRow[],
): Promise<Result<InventoryRow[]>> {
  if (stockRows.length === 0) return ok([]);

  const ids = stockRows.map((row) => row.product_id);
  const { data, error } = await supabase
    .from("v_products_admin")
    .select("id, brand, slug, supplier_name, primary_image_path")
    .in("id", ids);
  if (error) return fail(error);

  const meta = new Map(
    ((data ?? []) as Pick<
      VProductsAdminRow,
      "id" | "brand" | "slug" | "supplier_name" | "primary_image_path"
    >[]).map((row) => [row.id, row]),
  );

  return ok(
    stockRows.map((row) => {
      const extra = meta.get(row.product_id);
      return {
        ...row,
        brand: extra?.brand ?? null,
        slug: extra?.slug ?? null,
        supplier_name: extra?.supplier_name ?? null,
        primary_image_path: extra?.primary_image_path ?? null,
      };
    }),
  );
}

export async function listInventory(params: InventoryListParams = {}): Promise<Result<InventoryPage>> {
  const supabase = await createClient();
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const pageSize = clampPage(params.pageSize);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase.from("v_product_stock").select("*", { count: "exact" });

  switch (params.scope) {
    case "low":
      query = query.eq("is_low_stock", true);
      break;
    case "out":
      query = query.eq("is_out_of_stock", true);
      break;
    case "archived":
      query = query.eq("status", "archived");
      break;
    default:
      break;
  }

  if (params.scope !== "archived" && params.categoryId) query = query.eq("category_id", params.categoryId);
  if (params.scope !== "archived" && params.supplierId) query = query.eq("supplier_id", params.supplierId);

  const term = params.search ? sanitizeSearch(params.search) : "";
  if (term) query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%`);

  switch (params.sort) {
    case "stock":
      query = query.order("quantity", { ascending: true });
      break;
    case "threshold":
      query = query.order("low_stock_threshold", { ascending: false });
      break;
    case "newest":
      query = query.order("updated_at", { ascending: false });
      break;
    default:
      query = query.order("name", { ascending: true });
      break;
  }

  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) return fail(error);

  const enriched = await enrichWithCatalog(supabase, (data ?? []) as VProductStockRow[]);
  if (!enriched.ok) return enriched;

  return ok({ rows: enriched.data, total: count ?? 0, page, pageSize });
}

export async function listMovements(params: MovementListParams = {}): Promise<Result<MovementPage>> {
  const supabase = await createClient();
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const pageSize = clampPage(params.pageSize);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("inventory_movements")
    .select("*, products(name, sku)", { count: "exact" })
    .order("created_at", { ascending: false });

  if (params.productId) query = query.eq("product_id", params.productId);
  if (params.movementType) query = query.eq("movement_type", params.movementType);
  if (params.source) query = query.eq("source", params.source);

  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) return fail(error);

  return ok({
    rows: (data ?? []) as InventoryMovementWithProduct[],
    total: count ?? 0,
    page,
    pageSize,
  });
}

export async function getProductMovements(
  productId: string,
  limit = 50,
): Promise<Result<InventoryMovementWithProduct[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_movements")
    .select("*, products(name, sku)")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(Math.min(200, Math.max(1, limit)));
  if (error) return fail(error);
  return ok((data ?? []) as InventoryMovementWithProduct[]);
}

/** Lightweight options for the inventory filters. */
export async function listInventoryCategoryOptions(): Promise<
  Result<{ id: string; name: string }[]>
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, name")
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error) return fail(error);
  return ok((data ?? []) as { id: string; name: string }[]);
}

export async function listInventorySupplierOptions(): Promise<
  Result<{ id: string; name: string }[]>
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error) return fail(error);
  return ok((data ?? []) as { id: string; name: string }[]);
}
