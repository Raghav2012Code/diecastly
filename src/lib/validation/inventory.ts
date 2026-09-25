import { z } from "zod";
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

/** Signed delta for `adjust_stock` from a direction + positive quantity. */
export function adjustDelta(input: Pick<AdjustInput, "direction" | "quantity">): number {
  return input.direction === "increase" ? input.quantity : -input.quantity;
}
