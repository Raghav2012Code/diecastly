import type { Metadata } from "next";
import { ToastProvider } from "@/components/ui/toast";
import { CartProvider } from "@/lib/store/cart-context";
import { getPublicSettings } from "@/lib/store/data";
import { StoreHeader } from "@/components/store/store-header";
import { StoreFooter } from "@/components/store/store-footer";

/**
 * Every storefront page is rendered per request, never at build time.
 *
 * This is not a performance choice, it is a correctness one. Without it Next
 * prerenders `/cart` and `/checkout` at build time — and because
 * `getPublicSettings()` degrades to a fallback when the database is unreachable
 * during a build, it bakes THAT in: `default_shipping_fee` frozen at zero and
 * `cod_enabled` frozen at false. The seller raises their shipping fee or turns
 * cash on delivery back on, and the storefront keeps serving the old values until
 * the next deploy. The same applies to stock and prices, which must never be
 * served from a build-time snapshot.
 *
 * `/`, `/products/[slug]` and `/order/[orderNumber]` already opt into dynamic
 * rendering by awaiting `searchParams` or `params`; this makes the guarantee
 * explicit and covers the two that do not.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  // The business name comes from settings, so the storefront is not hard-coded to
  // a placeholder if the seller renames the shop. Falls back to the product name
  // when no settings row exists yet, which a freshly seeded database will not have.
  const settings = await getPublicSettings();
  return {
    title: { default: settings.business_name, template: `%s · ${settings.business_name}` },
    description: "Diecast collectibles, direct from the seller.",
  };
}

/**
 * The public storefront shell.
 *
 * No login anywhere (ux.md §9), and nothing here reads the request cookies: the
 * shell must render identically for a signed-in admin previewing the shop and for
 * a first-time visitor, which is the same reason the data layer uses the anon
 * client.
 */
export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const settings = await getPublicSettings();

  return (
    <ToastProvider>
      <CartProvider>
        <div className="flex min-h-screen flex-col bg-background">
          <StoreHeader
            businessName={settings.business_name}
            phone={settings.business_phone}
            email={settings.business_email}
          />
          <main className="flex-1">{children}</main>
          <StoreFooter businessName={settings.business_name} />
        </div>
      </CartProvider>
    </ToastProvider>
  );
}
