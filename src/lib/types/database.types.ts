/**
 * Hand-maintained mirror of the Phase 1 schema (until `supabase gen types` can
 * run against a live local stack). Only the tables and views the app consumes
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
  is_out_of_stock: boolean;
  is_low_stock: boolean;
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
  /** Later of products.updated_at and inventory_stock.updated_at. */
  stock_changed_at: string;
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
  is_out_of_stock: boolean;
  is_low_stock: boolean;
};

// ---------------------------------------------------------------------------
// Orders, payments, customers and settings
// ---------------------------------------------------------------------------

export const ORDER_CHANNELS = ["in_person", "online"] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "packed",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
  "returned",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_METHODS = [
  "cash",
  "upi",
  "cod",
  "card",
  "bank_transfer",
  "other",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_RECORD_STATUSES = [
  "pending",
  "authorized",
  "received",
  "failed",
  "refunded",
] as const;
export type PaymentRecordStatus = (typeof PAYMENT_RECORD_STATUSES)[number];

/** Derived from the payments ledger (`v_order_financials`); never stored. */
export const DERIVED_PAYMENT_STATUSES = [
  "unpaid",
  "partial",
  "paid",
  "refunded",
  "cod_pending",
] as const;
export type DerivedPaymentStatus = (typeof DERIVED_PAYMENT_STATUSES)[number];

export const MOVEMENT_SOURCES = ["admin", "storefront", "system"] as const;
export type MovementSource = (typeof MOVEMENT_SOURCES)[number];

export type ShippingAddress = {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  [key: string]: unknown;
};

export type OrderRow = {
  id: string;
  order_number: string;
  channel: OrderChannel;
  status: OrderStatus;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  shipping_address: ShippingAddress | null;
  payment_method: PaymentMethod | null;
  shipping_fee: number;
  shipping_cost: number;
  courier: string | null;
  tracking_number: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  subtotal: number;
  discount_total: number;
  total: number;
  cost_total: number;
  access_token: string;
  expires_at: string | null;
  idempotency_key: string | null;
  notes: string | null;
  created_by: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  sku: string | null;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  line_discount: number;
  line_total: number;
  line_profit: number;
  created_at: string;
};

export type PaymentRow = {
  id: string;
  order_id: string;
  amount: number;
  method: PaymentMethod;
  provider: "manual" | "razorpay" | "stripe";
  status: PaymentRecordStatus;
  reference: string | null;
  provider_payment_id: string | null;
  provider_order_id: string | null;
  provider_payload: unknown;
  idempotency_key: string | null;
  received_at: string | null;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderStatusHistoryRow = {
  id: string;
  order_id: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  note: string | null;
  changed_by: string | null;
  created_at: string;
};

export type CustomerRow = {
  id: string;
  name: string | null;
  phone_normalized: string | null;
  email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SettingsRow = {
  id: boolean;
  business_name: string;
  business_phone: string | null;
  business_email: string | null;
  upi_id: string | null;
  upi_qr_path: string | null;
  currency: string;
  cod_enabled: boolean;
  default_shipping_fee: number;
  low_stock_threshold_default: number;
  order_prefix: string;
  online_order_hold_hours: number;
  in_person_reversal_window_hours: number;
  updated_at: string;
};

/** `v_order_financials` — the derived payment state for one order. */
// ---------------------------------------------------------------------------
// Public storefront view shapes
//
// These mirror the DEFINER views in `20260925120400_views.sql` and
// `20260926120400_public_image_gallery.sql`. They carry only safe columns: no
// purchase cost, no profit, no customer data, no stock ledger.
//
// Availability is read from `v_products_public`'s own flags and never
// recomputed, so the catalog grid and the product page cannot disagree about
// whether something is in stock.
// ---------------------------------------------------------------------------

/** `v_public_settings` — the business details a shopper is allowed to see. */
export type PublicSettingsRow = {
  business_name: string;
  business_phone: string | null;
  business_email: string | null;
  upi_id: string | null;
  upi_qr_path: string | null;
  currency: string;
  cod_enabled: boolean;
  default_shipping_fee: number;
  order_prefix: string;
};

/** `v_categories_public` — active categories only, for the catalog filter. */
export type PublicCategoryRow = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  sort_order: number;
};

/**
 * `v_products_public` — an active product, as a shopper may see it.
 *
 * `quantity` is the live stock figure; `is_out_of_stock` and `is_low_stock`
 * are derived from it in SQL, and the storefront trusts those flags rather than
 * re-deriving thresholds, so "Sold out" means the same thing on every page.
 */
export type VProductsPublicRow = {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  model: string | null;
  series: string | null;
  description: string | null;
  selling_price: number;
  category_id: string | null;
  is_featured: boolean;
  created_at: string;
  quantity: number;
  is_out_of_stock: boolean;
  is_low_stock: boolean;
  primary_image_path: string | null;
};

/**
 * `v_product_images_public` — one image of an active product, for the gallery.
 *
 * Only images of active products are exposed, so a draft or archived product's
 * photography is unreachable. A separate view rather than a column on
 * `v_products_public` because the gallery is fetched per product while the
 * catalog is fetched per page, and a jsonb column would repeat every image path
 * on every row of every catalog page.
 */
export type VProductImagesPublicRow = {
  id: string;
  product_id: string;
  storage_path: string;
  alt_text: string | null;
  sort_order: number;
  is_primary: boolean;
};

export type VOrderFinancialsRow = {
  order_id: string;
  order_number: string;
  total_due: number;
  total_received: number;
  total_refunded: number;
  net_paid: number;
  balance: number;
  payment_status: DerivedPaymentStatus;
};

/** `v_order_summary` — order list row with money and derived payment state. */
export type VOrderSummaryRow = {
  order_id: string;
  order_number: string;
  channel: OrderChannel;
  status: OrderStatus;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  payment_method: PaymentMethod | null;
  created_at: string;
  subtotal: number;
  discount_total: number;
  shipping_fee: number;
  shipping_cost: number;
  total: number;
  cost_total: number;
  gross_profit: number;
  contribution_after_shipping: number;
  payment_status: DerivedPaymentStatus;
  net_paid: number;
  balance: number;
};

/** `v_customer_summary` — customer with derived order metrics. */
export type VCustomerSummaryRow = {
  customer_id: string;
  name: string | null;
  phone_normalized: string | null;
  email: string | null;
  orders_count: number;
  total_spent: number;
  last_order_at: string | null;
};

/** Sellable product for the till: metadata and stock, never cost-sensitive fields. */
export type SellableProduct = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  brand: string | null;
  series: string | null;
  selling_price: number;
  quantity: number;
  low_stock_threshold: number;
  primary_image_path: string | null;
  status: ProductStatus;
};

export type OrderDetail = {
  order: OrderRow;
  financials: VOrderFinancialsRow;
  items: OrderItemRow[];
  payments: PaymentRow[];
  history: OrderStatusHistoryRow[];
};

export type OrderReceipt = {
  order: OrderRow;
  items: OrderItemRow[];
  payments: PaymentRow[];
  business: SettingsRow | null;
};
