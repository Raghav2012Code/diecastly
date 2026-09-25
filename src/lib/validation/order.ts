import { z } from "zod";

export const PAYMENT_METHODS = [
  "cash",
  "upi",
  "cod",
  "card",
  "bank_transfer",
  "other",
] as const;

export const paymentMethodSchema = z.enum(PAYMENT_METHODS);

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
  amount: z.number().positive(),
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
  idempotencyKey: z.string().min(8).max(100),
});

export const onlineOrderInputSchema = z.object({
  items: z.array(posLineSchema).min(1),
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
  idempotencyKey: z.string().min(8).max(100),
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
export type OnlineOrderInput = z.infer<typeof onlineOrderInputSchema>;
