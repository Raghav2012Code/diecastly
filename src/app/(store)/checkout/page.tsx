import type { Metadata } from "next";
import { getPublicSettings } from "@/lib/store/data";
import { CheckoutForm } from "@/app/(store)/checkout/checkout-form";

export const metadata: Metadata = { title: "Checkout" };

/**
 * Guest checkout.
 *
 * The seller's own settings decide what the form may offer: the default shipping
 * fee, and whether cash on delivery appears at all. Both come from
 * `v_public_settings` rather than being hard-coded here, and `place_online_order`
 * re-checks COD server-side regardless — so a stale or hand-edited form cannot
 * force a payment method the seller has switched off.
 */
export default async function CheckoutPage() {
  const settings = await getPublicSettings();

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-6 space-y-1">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Checkout</h1>
        <p className="text-sm text-muted-foreground">
          No account needed. We will contact you on the number you give to confirm the order.
        </p>
      </div>

      <CheckoutForm
        businessName={settings.business_name}
        upiId={settings.upi_id}
        codEnabled={settings.cod_enabled}
        shippingFee={settings.default_shipping_fee}
      />
    </div>
  );
}
