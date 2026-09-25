"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { actionError, fromFriendly, fromZod, type ActionResult } from "@/lib/action-result";
import { recordInPersonSale } from "@/lib/db/rpc";
import { searchCustomers } from "@/lib/customers/data";
import { searchSellableProducts } from "@/lib/catalog/data";
import { getOrderReceipt } from "@/lib/orders/data";
import { receiptFromOrder, type ReceiptView } from "@/lib/orders/receipt";
import { posSaleInputSchema } from "@/lib/validation/order";
import type { SellableProduct } from "@/lib/types/database.types";

/**
 * Record Sale server actions. The sale itself is one atomic RPC — stock,
 * movements, order, items and payments are written together. The UI never
 * writes orders, order items or payments directly.
 */

export type PosCustomerOption = {
  id: string | null;
  name: string;
  phone: string;
  email: string | null;
};

export type CompletedSale = {
  orderId: string;
  orderNumber: string;
  total: number;
  receipt: ReceiptView;
};

const termSchema = z.string().max(120);

export async function searchSellableProductsAction(
  term: string,
): Promise<ActionResult<SellableProduct[]>> {
  const parsed = termSchema.safeParse(term);
  if (!parsed.success) return fromZod(parsed.error);

  const result = await searchSellableProducts(parsed.data, 30);
  if (!result.ok) return fromFriendly(result.error);
  return { ok: true, data: result.data };
}

export async function searchCustomersAction(
  term: string,
): Promise<ActionResult<PosCustomerOption[]>> {
  const parsed = termSchema.safeParse(term);
  if (!parsed.success) return fromZod(parsed.error);

  const result = await searchCustomers(parsed.data, 8);
  if (!result.ok) return fromFriendly(result.error);

  return {
    ok: true,
    data: result.data.map((customer) => ({
      id: customer.id,
      name: customer.name ?? customer.phone_normalized ?? "Customer",
      phone: customer.phone_normalized ?? "",
      email: customer.email,
    })),
  };
}

export async function completeSaleAction(input: unknown): Promise<ActionResult<CompletedSale>> {
  const parsed = posSaleInputSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const supabase = await createClient();
  const result = await recordInPersonSale(supabase, {
    items: parsed.data.items,
    paymentMethod: parsed.data.paymentMethod,
    payments: parsed.data.payments,
    customer: parsed.data.customer ?? null,
    notes: parsed.data.notes ?? null,
    idempotencyKey: parsed.data.idempotencyKey,
  });
  if (!result.ok) return fromFriendly(result.error);

  const orderId = result.data.order_id;

  // Read the receipt back from the database so the printed slip is exactly what
  // was stored, not what the client believed it sent.
  const receiptResult = await getOrderReceipt(orderId);
  if (!receiptResult.ok) return fromFriendly(receiptResult.error);
  if (!receiptResult.data) return actionError("The sale was recorded but its receipt could not be loaded.");

  revalidatePath("/admin/orders");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin");

  return {
    ok: true,
    data: {
      orderId,
      orderNumber: result.data.order_number,
      total: result.data.total,
      receipt: receiptFromOrder(receiptResult.data),
    },
  };
}
