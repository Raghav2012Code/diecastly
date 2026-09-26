import { z } from "zod";
import { MAX_MONEY } from "@/lib/validation/catalog";

/**
 * The business settings form.
 *
 * Every bound here mirrors a database CHECK or NOT NULL on `settings`, so the
 * form cannot build a row the database will refuse. The columns and their
 * constraints, from `20260925120100_catalog.sql`:
 *
 *   business_name                 text not null
 *   default_shipping_fee          numeric(12,2) not null check >= 0
 *   low_stock_threshold_default   integer not null check >= 0
 *   order_prefix                  text not null
 *   online_order_hold_hours       integer not null check > 0
 *   in_person_reversal_window_hours integer not null check > 0
 *
 * `cod_enabled` is the one setting with immediate storefront consequences: it
 * decides whether the checkout offers cash on delivery at all, and
 * `place_online_order` re-checks it, so a stale form cannot force it.
 *
 * There is deliberately no tax field. The schema has none and no tax is computed
 * anywhere; adding one here would imply a money semantic that does not exist yet
 * (D60).
 */

const trimmed = (max: number, message?: string) =>
  z
    .string()
    .trim()
    .min(1, message ?? "This cannot be empty.")
    .max(max);

/**
 * An optional field that always yields `string | null`.
 *
 * Deliberately NOT `.optional().transform(...)`: that short-circuits on an absent
 * key, so the transform never runs and the result is `undefined` rather than
 * `null`. `undefined` is dropped by JSON.stringify, so the column would be
 * silently LEFT UNCHANGED instead of cleared — the admin clears the UPI field,
 * hits save, sees success, and the old value is still there. A total contract
 * removes that whole class of silent no-op.
 */
const optionalText = (max: number) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value, ctx) => {
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      if (trimmed.length === 0) return null;
      if (trimmed.length > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_big,
          type: "string",
          maximum: max,
          inclusive: true,
          message: `Keep this under ${max} characters.`,
        });
        return z.NEVER;
      }
      return trimmed;
    });

export const settingsInputSchema = z.object({
  businessName: trimmed(120, "Enter the business name."),
  businessPhone: optionalText(40),
  businessEmail: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value, ctx) => {
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      if (trimmed.length === 0) return null;
      if (trimmed.length > 200) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_big,
          type: "string",
          maximum: 200,
          inclusive: true,
          message: "Keep this under 200 characters.",
        });
        return z.NEVER;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Enter a valid email address.",
        });
        return z.NEVER;
      }
      return trimmed;
    }),
  upiId: optionalText(120),
  upiQrPath: optionalText(400),
  orderPrefix: trimmed(12, "Enter an order prefix, e.g. DC.").transform((v) => v.toUpperCase()),

  defaultShippingFee: z.coerce
    .number({ invalid_type_error: "Enter a valid shipping fee." })
    .finite("Enter a valid shipping fee.")
    .nonnegative("The shipping fee cannot be negative.")
    .max(MAX_MONEY, "That amount is too large.")
    .default(0),

  lowStockThresholdDefault: z.coerce
    .number({ invalid_type_error: "Enter a whole number." })
    .int("Use a whole number.")
    .nonnegative("The threshold cannot be negative.")
    .max(100_000, "Use 100,000 or less.")
    .default(2),

  onlineOrderHoldHours: z.coerce
    .number({ invalid_type_error: "Enter a whole number of hours." })
    .int("Use a whole number of hours.")
    .positive("The hold must be at least one hour.")
    .max(24 * 90, "Use 90 days or less.")
    .default(48),

  inPersonReversalWindowHours: z.coerce
    .number({ invalid_type_error: "Enter a whole number of hours." })
    .int("Use a whole number of hours.")
    .positive("The window must be at least one hour.")
    .max(24 * 30, "Use 30 days or less.")
    .default(24),

  codEnabled: z.boolean().default(true),
});

export type SettingsInput = z.infer<typeof settingsInputSchema>;
