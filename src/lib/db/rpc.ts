import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, type Result } from "./errors";
import type {
  DerivedPaymentStatus,
  ManualMovementType,
  OrderChannel,
  OrderStatus,
  PaymentMethod,
} from "@/lib/types/database.types";

/**
 * The only place the stock, sale and payment RPC names and argument shapes are
 * declared. Stock, orders, order items, status history and payments are mutated
 * exclusively through these security-definer functions; nothing here writes to
 * those tables directly.
 */

export type StockMutationResult = {
  product_id: string;
  quantity: number;
  movement_id: string;
  idempotent?: boolean;
  already_initialized?: boolean;
};

type Client = SupabaseClient;

export async function setInitialStock(
  client: Client,
  args: { productId: string; quantity: number; unitCost?: number | null },
): Promise<Result<StockMutationResult>> {
  const { data, error } = await client.rpc("set_initial_stock", {
    p_product_id: args.productId,
    p_quantity: args.quantity,
    p_unit_cost: args.unitCost ?? null,
  });
  if (error) return fail(error);
  return ok(data as StockMutationResult);
}

export async function restockProduct(
  client: Client,
  args: {
    productId: string;
    quantity: number;
    unitCost?: number | null;
    setCurrentCost?: boolean;
    note?: string | null;
    idempotencyKey?: string | null;
  },
): Promise<Result<StockMutationResult>> {
  const { data, error } = await client.rpc("restock_product", {
    p_product_id: args.productId,
    p_quantity: args.quantity,
    p_unit_cost: args.unitCost ?? null,
    p_set_current_cost: args.setCurrentCost ?? false,
    p_note: args.note ?? null,
    p_idempotency_key: args.idempotencyKey ?? null,
  });
  if (error) return fail(error);
  return ok(data as StockMutationResult);
}

export async function adjustStock(
  client: Client,
  args: {
    productId: string;
    delta: number;
    reason: ManualMovementType;
    note?: string | null;
    idempotencyKey?: string | null;
  },
): Promise<Result<StockMutationResult>> {
  const { data, error } = await client.rpc("adjust_stock", {
    p_product_id: args.productId,
    p_delta: args.delta,
    p_reason: args.reason,
    p_note: args.note ?? null,
    p_idempotency_key: args.idempotencyKey ?? null,
  });
  if (error) return fail(error);
  return ok(data as StockMutationResult);
}

// ---------------------------------------------------------------------------
// Sales and payments
// ---------------------------------------------------------------------------

export type SaleLineInput = {
  productId: string;
  quantity: number;
  unitPrice: number;
  lineDiscount?: number;
};

export type SalePaymentInput = {
  amount: number;
  method?: PaymentMethod;
  reference?: string | null;
};

export type SaleCustomerInput = {
  name: string;
  phone: string;
  email?: string | null;
};

export type SaleResult = {
  order_id: string;
  order_number: string;
  total: number;
  paid?: number;
  idempotent?: boolean;
};

export type OrderFinancialsJson = {
  total_due: number;
  total_received: number;
  total_refunded: number;
  net_paid: number;
  balance: number;
  payment_status: DerivedPaymentStatus;
};

/** `public.order_json` — the shape every order/payment RPC returns. */
export type OrderMutationResult = {
  order_id: string;
  order_number: string;
  channel: OrderChannel;
  status: OrderStatus;
  payment_method: PaymentMethod | null;
  subtotal: number;
  discount_total: number;
  shipping_fee: number;
  shipping_cost: number;
  total: number;
  cost_total: number;
  expires_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  financials: OrderFinancialsJson;
};

/**
 * Records an in-person sale atomically: stock decremented, `sale` movements
 * written, order created at `completed`, payments appended. The server ignores
 * any client totals; only item ids, quantities, prices and discounts are read.
 */
export async function recordInPersonSale(
  client: Client,
  args: {
    items: SaleLineInput[];
    paymentMethod: PaymentMethod;
    payments?: SalePaymentInput[];
    customer?: SaleCustomerInput | null;
    notes?: string | null;
    idempotencyKey?: string | null;
  },
): Promise<Result<SaleResult>> {
  const { data, error } = await client.rpc("record_in_person_sale", {
    p_items: args.items,
    p_payment_method: args.paymentMethod,
    p_payments: args.payments ?? null,
    p_customer: args.customer ?? null,
    p_notes: args.notes ?? null,
    p_idempotency_key: args.idempotencyKey ?? null,
  });
  if (error) return fail(error);
  return ok(data as SaleResult);
}

/** Appends a received payment. Never changes fulfilment status. */
export async function recordPayment(
  client: Client,
  args: {
    orderId: string;
    amount: number;
    method: PaymentMethod;
    reference?: string | null;
    idempotencyKey?: string | null;
  },
): Promise<Result<OrderMutationResult>> {
  const { data, error } = await client.rpc("record_payment", {
    p_order_id: args.orderId,
    p_amount: args.amount,
    p_method: args.method,
    p_reference: args.reference ?? null,
    p_idempotency_key: args.idempotencyKey ?? null,
  });
  if (error) return fail(error);
  return ok(data as OrderMutationResult);
}

/** Appends a compensating negative payment. Never changes fulfilment status. */
export async function refundPayment(
  client: Client,
  args: {
    orderId: string;
    amount: number;
    method?: PaymentMethod;
    reason?: string | null;
    idempotencyKey?: string | null;
  },
): Promise<Result<OrderMutationResult>> {
  const { data, error } = await client.rpc("refund_payment", {
    p_order_id: args.orderId,
    p_amount: args.amount,
    p_method: args.method ?? "other",
    p_reason: args.reason ?? null,
    p_idempotency_key: args.idempotencyKey ?? null,
  });
  if (error) return fail(error);
  return ok(data as OrderMutationResult);
}

// ---------------------------------------------------------------------------
// Storefront (callable without authentication)
//
// These two are reachable by `anon`. Everything above re-checks `is_admin()`;
// these do not, and must not. Neither accepts a price from the caller —
// `placeOnlineOrder` reads the catalog price inside the function, because the
// caller is anonymous and has no authority to set one.
// ---------------------------------------------------------------------------

export type OnlineOrderItemInput = {
  productId: string;
  quantity: number;
};

export type OnlineOrderResult = {
  order_id: string;
  order_number: string;
  access_token: string;
  total: number;
  payment_method: "upi" | "cod";
  expires_at: string | null;
  idempotent?: boolean;
};

export async function placeOnlineOrder(
  client: Client,
  args: {
    items: OnlineOrderItemInput[];
    customer: {
      name: string;
      phone: string;
      email?: string | null;
      addressLine1: string;
      addressLine2?: string | null;
      city: string;
      state: string;
      postalCode: string;
      country?: string | null;
    };
    paymentMethod: "upi" | "cod";
    idempotencyKey?: string | null;
    notes?: string | null;
  },
): Promise<Result<OnlineOrderResult>> {
  const { data, error } = await client.rpc("place_online_order", {
    p_items: args.items,
    p_customer: args.customer,
    p_payment_method: args.paymentMethod,
    p_shipping_address: {
      line1: args.customer.addressLine1,
      line2: args.customer.addressLine2 ?? null,
      city: args.customer.city,
      state: args.customer.state,
      postal_code: args.customer.postalCode,
      country: args.customer.country ?? "India",
    },
    p_notes: args.notes ?? null,
    p_idempotency_key: args.idempotencyKey ?? null,
  });
  if (error) return fail(error);
  return ok(data as OnlineOrderResult);
}

/** Guest order lookup. Requires BOTH the order number and the access token. */
export async function getOrderByAccess(
  client: Client,
  args: { orderNumber: string; accessToken: string },
): Promise<Result<Record<string, unknown>>> {
  const { data, error } = await client.rpc("get_order_by_access", {
    p_order_number: args.orderNumber,
    p_access_token: args.accessToken,
  });
  if (error) return fail(error);
  return ok((data ?? {}) as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Fulfilment (admin only)
// ---------------------------------------------------------------------------

/**
 * Advances fulfilment one step. The transition table is enforced in the
 * function; cancelling and reversing go through `cancelOrder` instead. Never
 * touches the payments ledger (D33).
 */
export async function updateOrderStatus(
  client: Client,
  args: {
    orderId: string;
    newStatus: Exclude<OrderStatus, "cancelled" | "returned">;
    note?: string | null;
    courier?: string | null;
    tracking?: string | null;
  },
): Promise<Result<OrderMutationResult>> {
  const { data, error } = await client.rpc("update_order_status", {
    p_order_id: args.orderId,
    p_new_status: args.newStatus,
    p_note: args.note ?? null,
    p_courier: args.courier ?? null,
    p_tracking: args.tracking ?? null,
  });
  if (error) return fail(error);
  return ok(data as OrderMutationResult);
}

/**
 * Cancels an order, optionally restocking and/or refunding. Reversal of a
 * recent in-person sale is the same operation; the window is enforced in the
 * function from settings, never by the UI (D35).
 */
export async function cancelOrder(
  client: Client,
  args: {
    orderId: string;
    reason: string;
    restock?: boolean;
    refund?: boolean;
    idempotencyKey?: string | null;
  },
): Promise<Result<OrderMutationResult>> {
  const { data, error } = await client.rpc("cancel_order", {
    p_order_id: args.orderId,
    p_reason: args.reason,
    p_restock: args.restock ?? true,
    p_refund: args.refund ?? true,
    p_idempotency_key: args.idempotencyKey ?? null,
  });
  if (error) return fail(error);
  return ok(data as OrderMutationResult);
}

/** Non-financial admin edit. */
export async function updateOrderNotes(
  client: Client,
  args: { orderId: string; notes: string | null },
): Promise<Result<OrderMutationResult>> {
  const { data, error } = await client.rpc("update_order_notes", {
    p_order_id: args.orderId,
    p_notes: args.notes ?? null,
  });
  if (error) return fail(error);
  return ok(data as OrderMutationResult);
}

// ---------------------------------------------------------------------------
// Product images
//
// These three are RPCs rather than direct table writes for ATOMICITY, not
// encapsulation - see D47. Each was previously a sequence of independent client
// statements, and each could be interrupted into a broken state:
//
//   * set-primary cleared every primary then set the new one. The partial unique
//     index forbids the reverse order, so a failure between them left the
//     product with no primary at all.
//   * reorder issued one UPDATE per image, so a mid-loop failure left the order
//     half-applied while reporting failure.
//   * delete promoted the successor BEFORE deleting the old primary, which the
//     unique index forbids outright - so deleting a primary image did nothing.
//
// A plpgsql function body is one transaction, so each is now all-or-nothing.
// ---------------------------------------------------------------------------

/** Makes imageId the product's primary image. Exactly one primary afterwards. */
export async function setPrimaryImage(
  client: Client,
  args: { productId: string; imageId: string },
): Promise<Result<null>> {
  const { error } = await client.rpc("set_primary_image", {
    p_product_id: args.productId,
    p_image_id: args.imageId,
  });
  if (error) return fail(error);
  return ok(null);
}

/**
 * Sets the display order of a product's images. The product is derived from the
 * ids, and imageIds must be exactly that product's images - a partial or foreign
 * set is rejected rather than silently dropping images out of the ordering.
 */
export async function reorderProductImages(
  client: Client,
  args: { imageIds: string[] },
): Promise<Result<null>> {
  const { error } = await client.rpc("reorder_product_images", {
    p_image_ids: args.imageIds,
  });
  if (error) return fail(error);
  return ok(null);
}

/**
 * Deletes an image, promoting a successor in the same transaction if it was the
 * primary. Returns the storage path so the caller can remove the file; storage
 * cleanup cannot join the database transaction.
 */
export async function deleteProductImage(
  client: Client,
  args: { imageId: string },
): Promise<Result<string | null>> {
  const { data, error } = await client.rpc("delete_product_image", {
    p_image_id: args.imageId,
  });
  if (error) return fail(error);
  return ok((data as string | null) ?? null);
}