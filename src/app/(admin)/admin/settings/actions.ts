"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fromZod, type ActionResult } from "@/lib/action-result";
import { settingsInputSchema } from "@/lib/validation/settings";

/**
 * Save the business settings.
 *
 * A direct table write, which is correct here: `settings` is metadata, it is
 * admin-only under RLS, and it has no ledger or stock side effects. The
 * storefront reads it through `v_public_settings`, so nothing needs to be
 * recomputed when it changes — the only rows that change are the ones this
 * updates, because `id` is the fixed primary key `true`.
 *
 * `revalidatePath("/")` matters more than it looks. The storefront layout reads
 * the business name for its metadata and header, and the checkout reads the
 * shipping fee and the COD switch. Without revalidating, an admin who changes
 * their name would keep seeing the old one on the shop until something else
 * happened to revalidate.
 */
export async function saveSettingsAction(input: unknown): Promise<ActionResult<null>> {
  const parsed = settingsInputSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase
    .from("settings")
    .update({
      business_name: parsed.data.businessName,
      business_phone: parsed.data.businessPhone,
      business_email: parsed.data.businessEmail,
      upi_id: parsed.data.upiId,
      upi_qr_path: parsed.data.upiQrPath,
      order_prefix: parsed.data.orderPrefix,
      default_shipping_fee: parsed.data.defaultShippingFee,
      low_stock_threshold_default: parsed.data.lowStockThresholdDefault,
      online_order_hold_hours: parsed.data.onlineOrderHoldHours,
      in_person_reversal_window_hours: parsed.data.inPersonReversalWindowHours,
      cod_enabled: parsed.data.codEnabled,
    })
    .eq("id", true);

  if (error) {
    return { ok: false, error: "The settings could not be saved. Please try again." };
  }

  revalidatePath("/admin/settings");
  revalidatePath("/admin");
  // The storefront reads these through v_public_settings on every request.
  revalidatePath("/", "layout");

  return { ok: true, data: null };
}
