"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fromFriendly, fromZod, type ActionResult } from "@/lib/action-result";
import { recordPayment, refundPayment } from "@/lib/db/rpc";
import { recordPaymentSchema, refundPaymentSchema } from "@/lib/validation/order";
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
