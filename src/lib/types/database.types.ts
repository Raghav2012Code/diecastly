/**
 * Hand-maintained mirror of the Phase 1 schema (until `supabase gen types` can
 * run against a live local stack). Only the tables and views Phase 2 consumes
 * are declared here; the shapes follow `supabase/migrations` exactly.
 */

export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const MOVEMENT_TYPES = [
  "initial",
  "restock",
  "sale",
  "order_cancel",
  "adjustment",
  "damage",
  "loss",
  "return",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** The subset of movement types an admin may create by hand (adjust_stock). */
export const MANUAL_MOVEMENT_TYPES = ["adjustment", "damage", "loss", "return"] as const;
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

export type ProductRow = {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  model: string | null;
  series: string | null;
  category_id: string | null;
  supplier_id: string | null;
  description: string | null;
  sku: string | null;
  barcode: string | null;
  purchase_cost: number;
  selling_price: number;
  low_stock_threshold: number;
  status: ProductStatus;
  is_featured: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type SupplierRow = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ProductImageRow = {
  id: string;
  product_id: string;
  storage_path: string;
  alt_text: string | null;
  sort_order: number;
  is_primary: boolean;
  created_at: string;
};

/** `v_products_admin` — product metadata plus stock, names and primary image. */
export type VProductsAdminRow = ProductRow & {
  quantity: number;
  category_name: string | null;
  supplier_name: string | null;
  primary_image_path: string | null;
};

/** `v_product_stock` — the authoritative per-product stock read model. */
export type VProductStockRow = {
  product_id: string;
  name: string;
  sku: string | null;
  status: ProductStatus;
  low_stock_threshold: number;
  quantity: number;
  is_out_of_stock: boolean;
  is_low_stock: boolean;
  purchase_cost: number;
  selling_price: number;
  category_id: string | null;
  supplier_id: string | null;
  updated_at: string;
};

export type InventoryMovementRow = {
  id: string;
  product_id: string;
  delta: number;
  quantity_after: number;
  movement_type: MovementType;
  reference_type: "order" | "manual" | null;
  reference_id: string | null;
  unit_cost: number | null;
  note: string | null;
  source: "admin" | "storefront" | "system";
  actor_id: string | null;
  idempotency_key: string | null;
  created_at: string;
};

export type InventoryMovementWithProduct = InventoryMovementRow & {
  products: { name: string; sku: string | null } | null;
};

/** Inventory list row: stock view enriched with catalog display fields. */
export type InventoryRow = VProductStockRow & {
  brand: string | null;
  slug: string | null;
  supplier_name: string | null;
  primary_image_path: string | null;
};
