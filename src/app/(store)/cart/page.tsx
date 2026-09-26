import type { Metadata } from "next";
import { getPublicSettings } from "@/lib/store/data";
import { CartView } from "@/app/(store)/cart/cart-view";

export const metadata: Metadata = { title: "Cart" };

/**
 * The cart page.
 *
 * A server shell that supplies the shipping fee, wrapping a client view. The fee
 * has to come from `settings` — it is the seller's number, not something the
 * client may decide — while the basket itself is client-side, so the two halves
 * are split across the boundary rather than forcing one of them to be wrong.
 */
export default async function CartPage() {
  const settings = await getPublicSettings();

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="mb-6 font-display text-3xl font-extrabold tracking-tight">Your cart</h1>
      <CartView shippingFee={settings.default_shipping_fee} />
    </div>
  );
}
