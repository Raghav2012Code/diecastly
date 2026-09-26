import { z } from "zod";
import type { ZodError } from "zod";
import { MANUAL_MOVEMENT_TYPES } from "@/lib/types/database.types";

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
  lowStockThreshold: z.coerce
    .number()
    .int("Use a whole number.")
    .nonnegative("Threshold cannot be negative.")
    .max(100000),
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
