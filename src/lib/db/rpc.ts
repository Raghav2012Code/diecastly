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
