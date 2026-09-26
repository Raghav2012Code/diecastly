import { z } from "zod";
import type { ZodError } from "zod";
import { MANUAL_MOVEMENT_TYPES } from "@/lib/types/database.types";
import { lowStockThresholdSchema } from "@/lib/validation/catalog";

/**
 * Shared inventory schemas. Quantities are strictly positive integers; a stock
 * change can never be zero (the database rejects a zero delta too).
 */

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const optionalNote = z
  .preprocess(emptyToUndefined, z.string().trim().max(500).optional())
  .transform((value) => value ?? null);

export const optionalUnitCost = z
  .preprocess(emptyToUndefined, z.coerce.number().nonnegative("Cost cannot be negative.").optional())
  .transform((value) => value ?? null);

export const movementReasonSchema = z.enum(MANUAL_MOVEMENT_TYPES);

export const initialStockSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.coerce.number().int("Use a whole number.").positive("Quantity must be greater than zero."),
  unitCost: optionalUnitCost,
});

export const restockSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.coerce.number().int("Use a whole number.").positive("Quantity must be greater than zero."),
  unitCost: optionalUnitCost,
  setCurrentCost: z.boolean().default(false),
  note: optionalNote,
  idempotencyKey: z.string().min(8).max(100),
});

export const adjustSchema = z
  .object({
    productId: z.string().uuid(),
    direction: z.enum(["increase", "decrease"]),
    quantity: z.coerce.number().int("Use a whole number.").positive("Quantity must be greater than zero."),
    reason: movementReasonSchema,
    note: optionalNote,
    idempotencyKey: z.string().min(8).max(100),
  })
  .superRefine((value, ctx) => {
    if ((value.reason === "damage" || value.reason === "loss") && value.direction !== "decrease") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["direction"],
        message: "Damage and loss reduce stock.",
      });
    }
    if (value.reason === "return" && value.direction !== "increase") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["direction"],
        message: "A return puts stock back.",
      });
    }
  });

export const thresholdSchema = z.object({
  productId: z.string().uuid(),
  // Re-exported rather than re-declared. This used to be a second, independent
  // copy of the same rule with a different ceiling from the product form's,
  // which had none — so one screen accepted a threshold the other refused, and
  // both disagreed with the int4 column. One column, one definition.
  lowStockThreshold: lowStockThresholdSchema,
});

export type InitialStockInput = z.infer<typeof initialStockSchema>;
export type RestockInput = z.infer<typeof restockSchema>;
export type AdjustInput = z.infer<typeof adjustSchema>;

/**
 * A failure plus the field it belongs to, or `field: null` when it belongs to
 * no single input (an insufficient-stock rejection, a dropped connection).
 *
 * The stock dialogs used to hold one error string and render it under the Note
 * field while marking the quantity input invalid, so a cost error appeared
 * beneath the wrong input and was announced against the wrong one. Carrying
 * the field makes placement and the invalid marking derive from one source.
 */
export type FieldError = { field: string | null; message: string };

/** Maps a Zod failure onto the field that caused it. */
export function fieldErrorFromZod(error: ZodError): FieldError {
  const issue = error.issues[0];
  const path = issue?.path[0];
  return {
    field: path === undefined ? null : String(path),
    message: issue?.message ?? "Check the form and try again.",
  };
}

/** The message to show under `field`, or undefined when the error is elsewhere. */
export function errorForField(error: FieldError | null, field: string): string | undefined {
  return error && error.field === field ? error.message : undefined;
}

/** Whether `field` is the one the error belongs to. Drives aria-invalid. */
export function isErrorField(error: FieldError | null, field: string): boolean {
  return Boolean(error) && error?.field === field;
}

/** Signed delta for `adjust_stock` from a direction + positive quantity. */
export function adjustDelta(input: Pick<AdjustInput, "direction" | "quantity">): number {
  return input.direction === "increase" ? input.quantity : -input.quantity;
}

/**
 * The fields that define what a stock mutation is *asking for*. A change to any
 * of them is a new intent and needs a new idempotency key; the free-text note is
 * not one of them, so correcting a note must not become a second movement.
 */
export type IdempotencyKey = { key: string; fingerprint: string };

export type MutationIntent = {
  quantity?: number;
  unitCost?: number | null;
  setCurrentCost?: boolean;
  direction?: string;
  reason?: string;
};

/** Stable string form of an intent, for comparison against the last submission. */
export function intentFingerprint(intent: MutationIntent): string {
  return JSON.stringify([
    intent.quantity ?? null,
    intent.unitCost ?? null,
    intent.setCurrentCost ?? null,
    intent.direction ?? null,
    intent.reason ?? null,
  ]);
}

/**
 * The idempotency key to use for a submission.
 *
 * A key identifies one intent, not one open dialog. Both stock dialogs used to
 * mint a key when the dialog opened and reuse it for every attempt, so a
 * corrected resubmit after a lost response was silently discarded: the database
 * recognised the key, concluded it was a retry, and returned the *first*
 * result. The dialog then reported success with a plausible quantity, and the
 * correction the admin made simply never happened.
 *
 * Reusing the key for an unchanged request is the point — that is what stops a
 * double-click or a retry from applying twice.
 */
export function keyForIntent(
  previous: IdempotencyKey | null,
  intent: MutationIntent,
  mint: () => string,
): IdempotencyKey {
  const fingerprint = intentFingerprint(intent);
  if (previous && previous.fingerprint === fingerprint) return previous;
  return { key: mint(), fingerprint };
}