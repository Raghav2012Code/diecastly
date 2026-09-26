import { z } from "zod";
import { PAYMENT_METHODS } from "@/lib/types/database.types";

export { PAYMENT_METHODS };

export const paymentMethodSchema = z.enum(PAYMENT_METHODS);

/** Largest single money value accepted from the client, in rupees. */
const MAX_AMOUNT = 10_000_000;

const idempotencyKeySchema = z.string().min(8).max(100);

/**
 * POS line. v1 requires a strictly positive unit price: zero-value lines are
 * not allowed. Mirrored by a database CHECK (unit_price > 0).
 */
export const posLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  unitPrice: z
    .number()
    .positive({ message: "Unit price must be greater than zero" }),
  lineDiscount: z.number().min(0).default(0),
});

export const paymentInputSchema = z.object({
  amount: z.number().positive().max(MAX_AMOUNT),
  method: paymentMethodSchema,
  reference: z.string().max(200).optional(),
});

export const customerInputSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(6).max(20),
  email: z.string().email().max(200).optional(),
});

export const posSaleInputSchema = z.object({
  items: z.array(posLineSchema).min(1),
  paymentMethod: paymentMethodSchema,
  payments: z.array(paymentInputSchema).min(1).optional(),
  customer: customerInputSchema.optional(),
  notes: z.string().max(1000).optional(),
  idempotencyKey: idempotencyKeySchema,
});

/**
 * Recording a payment against an existing order. Always appends to the ledger;
 * never changes fulfilment status (enforced by the RPC).
 */
export const recordPaymentSchema = z.object({
  orderId: z.string().uuid(),
  amount: z.number().positive().max(MAX_AMOUNT),
  method: paymentMethodSchema,
  reference: z.string().max(200).optional(),
  idempotencyKey: idempotencyKeySchema,
});

/** A compensating refund entry, capped at what was actually received. */
export const refundPaymentSchema = z.object({
  orderId: z.string().uuid(),
  amount: z.number().positive().max(MAX_AMOUNT),
  method: paymentMethodSchema.default("other"),
  reason: z.string().max(200).optional(),
  idempotencyKey: idempotencyKeySchema,
});

/**
 * Online checkout line. Deliberately has **no** unit price: `place_online_order`
 * is `security definer` and granted to `anon`, so the catalog price is the only
 * price an anonymous caller may be given. Sending one is ignored by the server,
 * so the contract does not ask for it. The POS keeps its override because that
 * caller is an authenticated admin entitled to negotiate.
 */
export const onlineLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
});

export const onlineOrderInputSchema = z.object({
  items: z.array(onlineLineSchema).min(1),
  customer: customerInputSchema.extend({
    addressLine1: z.string().min(1).max(200),
    addressLine2: z.string().max(200).optional(),
    city: z.string().min(1).max(100),
    state: z.string().min(1).max(100),
    postalCode: z.string().min(3).max(12),
    country: z.string().min(2).max(100).default("India"),
  }),
  paymentMethod: z.enum(["upi", "cod"]),
  notes: z.string().max(1000).optional(),
  idempotencyKey: idempotencyKeySchema,
});

/**
 * Phone is a linking key, never a credential. Normalize to a stable form so
 * orders can be linked to one customer record.
 */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

export type PosLineInput = z.infer<typeof posLineSchema>;
export type PosSaleInput = z.infer<typeof posSaleInputSchema>;
export type OnlineLineInput = z.infer<typeof onlineLineSchema>;
export type OnlineOrderInput = z.infer<typeof onlineOrderInputSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;
