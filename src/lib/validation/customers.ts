import { z } from "zod";
import { optionalEmail, optionalText } from "@/lib/validation/catalog";
import { normalizePhone } from "@/lib/validation/order";

/**
 * Customer metadata schemas.
 *
 * `phone_normalized` is the customer's permanent linking key: it is what ties an
 * order to a history and what the storefront upsert matches on. The normaliser
 * is therefore **reused** from `validation/order.ts`, which mirrors the
 * database's `normalize_phone(text)`, rather than reimplemented here — a second
 * rule would let an admin save a phone whose stored form differs from the one
 * checkout would compute, and two rows would then exist for one person.
 *
 * The same schema validates the form and the server action, so the client
 * cannot submit something the server would refuse.
 */

const emptyToNull = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? null : value;

/**
 * An Indian mobile is the common case; the server is looser (10–13 digits) so
 * landlines still work. This matches `customerInputSchema` in
 * `validation/order.ts`; both ultimately call the same `normalizePhone`.
 */
export const customerPhoneSchema = z
  .string()
  .trim()
  .min(6, "Enter a phone number.")
  .max(20)
  .refine((value) => {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 13;
  }, "Enter a valid phone number with 10-13 digits.")
  .transform(normalizePhone);

export const customerInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a customer name.").max(120),
  phone: customerPhoneSchema,
  email: optionalEmail,
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(100),
  state: optionalText(100),
  postalCode: optionalText(12),
  // An empty country falls back to India rather than to NULL, mirroring the
  // column's `not null default 'India'`.
  country: z
    .preprocess(emptyToNull, z.string().trim().min(2).max(100).nullish())
    .transform((value) => value ?? "India"),
  notes: optionalText(1000),
  isActive: z.boolean().default(true),
});

export const customerCreateSchema = customerInputSchema;
export const customerUpdateSchema = customerInputSchema;

export const customerIdSchema = z.string().uuid();

/** Archive and restore are the same write with opposite flags. */
export const customerArchiveSchema = z.object({
  customerId: customerIdSchema,
  isActive: z.boolean(),
});

export type CustomerInput = z.infer<typeof customerInputSchema>;
export type CustomerArchiveInput = z.infer<typeof customerArchiveSchema>;
