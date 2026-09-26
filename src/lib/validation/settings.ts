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

/** An optional field that stores as null rather than as "". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null));

export const settingsInputSchema = z.object({
  businessName: trimmed(120, "Enter the business name."),
  businessPhone: optionalText(40),
  businessEmail: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? value : undefined))
    .refine(
      (value) => value === undefined || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      "Enter a valid email address.",
    ),
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
