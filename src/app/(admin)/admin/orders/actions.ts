"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fromFriendly, fromZod, type ActionResult } from "@/lib/action-result";
import { recordPayment, refundPayment } from "@/lib/db/rpc";
import { recordPaymentSchema, refundPaymentSchema } from "@/lib/validation/order";
import { updateOrderStatus, cancelOrder } from "@/lib/db/rpc";
import { actionError } from "@/lib/action-result";
import {
  advanceOrderSchema,
  cancelOrderSchema,
  nextStatus,
  type ForwardStatus,
} from "@/lib/validation/fulfilment";
import type { DerivedPaymentStatus } from "@/lib/types/database.types";

/**
 * Order payment server actions. Payments are append-only and written only by
 * `record_payment` / `refund_payment`; neither touches fulfilment status.
 */

export type PaymentState = {
  netPaid: number;
  balance: number;
  paymentStatus: DerivedPaymentStatus;
};

function revalidateOrder(orderId: string) {
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  revalidatePath("/admin");
}

function toState(financials: {
  net_paid: number;
  balance: number;
  payment_status: DerivedPaymentStatus;
}): PaymentState {
  return {
    netPaid: financials.net_paid,
    balance: financials.balance,
    paymentStatus: financials.payment_status,
  };
}

export async function recordPaymentAction(input: unknown): Promise<ActionResult<PaymentState>> {
  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const supabase = await createClient();
  const result = await recordPayment(supabase, {
    orderId: parsed.data.orderId,
    amount: parsed.data.amount,
    method: parsed.data.method,
    reference: parsed.data.reference ?? null,
    idempotencyKey: parsed.data.idempotencyKey,
  });
  if (!result.ok) return fromFriendly(result.error);

  revalidateOrder(parsed.data.orderId);
  return { ok: true, data: toState(result.data.financials) };
}

export async function refundPaymentAction(input: unknown): Promise<ActionResult<PaymentState>> {
  const parsed = refundPaymentSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const supabase = await createClient();
  const result = await refundPayment(supabase, {
    orderId: parsed.data.orderId,
    amount: parsed.data.amount,
    method: parsed.data.method,
    reason: parsed.data.reason ?? null,
    idempotencyKey: parsed.data.idempotencyKey,
  });
  if (!result.ok) return fromFriendly(result.error);

  revalidateOrder(parsed.data.orderId);
  return { ok: true, data: toState(result.data.financials) };
}

// ---------------------------------------------------------------------------
// Fulfilment
//
// Advancing and cancelling both go through RPCs and nothing else. No order row
// is ever written directly: the status-history row and the stock restock are
// part of the same transaction as the status change, so a direct write would
// silently drop both.
// ---------------------------------------------------------------------------

export async function advanceOrderAction(
  input: unknown,
): Promise<ActionResult<{ status: ForwardStatus }>> {
  const parsed = advanceOrderSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  // The client may say which status it wants, and the RPC checks the transition
  // is legal from where the order actually is. Offering only the single legal
  // next step in the UI is a courtesy; this is the enforcement.
  if (nextStatus(parsed.data.newStatus) === null && parsed.data.newStatus !== "completed") {
    return actionError("That is not a step this order can take.");
  }

  const supabase = await createClient();
  const result = await updateOrderStatus(supabase, {
    orderId: parsed.data.orderId,
    newStatus: parsed.data.newStatus,
    note: parsed.data.note,
    courier: parsed.data.courier,
    tracking: parsed.data.tracking,
  });

  if (!result.ok) {
    return { ok: false, error: result.error.message, field: result.error.field };
  }

  revalidateOrder(parsed.data.orderId);
  return { ok: true, data: { status: parsed.data.newStatus } };
}

export async function cancelOrderAction(input: unknown): Promise<ActionResult<null>> {
  const parsed = cancelOrderSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const supabase = await createClient();
  const result = await cancelOrder(supabase, {
    orderId: parsed.data.orderId,
    reason: parsed.data.reason,
    restock: parsed.data.restock,
    refund: parsed.data.refund,
  });

  if (!result.ok) {
    return { ok: false, error: result.error.message, field: result.error.field };
  }

  revalidateOrder(parsed.data.orderId);
  return { ok: true, data: null };
}
