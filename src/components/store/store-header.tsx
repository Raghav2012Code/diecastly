"use client";

import Link from "next/link";
import { useCart } from "@/lib/store/cart-context";

/**
 * Storefront header with the cart badge.
 *
 * A client component because the badge count lives in the cart context. The rest
 * of the header is static, but splitting it out would mean passing the count down
 * through a server boundary for no benefit.
 */
export function StoreHeader({
  businessName,
  phone,
  email,
}: {
  businessName: string;
  phone: string | null;
  email: string | null;
}) {
  const { count, ready } = useCart();

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur print:hidden">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-primary font-display text-base font-extrabold text-primary-foreground">
            D
          </span>
          <span className="font-display text-xl font-extrabold tracking-tight">{businessName}</span>
        </Link>

        <div className="flex items-center gap-1">
          {/* Contact details are a phone and an email link rather than a form:
              ux.md defers email/SMS order confirmation, so contact is manual for v1. */}
          {phone ? (
            <a
              href={`tel:${phone.replace(/\s+/g, "")}`}
              className="hidden rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-secondary sm:block"
            >
              {phone}
            </a>
          ) : null}
          {email ? (
            <a
              href={`mailto:${email}`}
              className="hidden rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-secondary sm:block"
            >
              Email
            </a>
          ) : null}

          <Link
            href="/cart"
            className="relative rounded-md px-3 py-1.5 text-sm font-medium hover:bg-secondary"
          >
            Cart
            {/* Rendered only once storage has been read, so the badge never
                flashes "0" on a basket that already has items in it. */}
            {ready && count > 0 ? (
              <span className="ml-1.5 inline-grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground">
                {count}
              </span>
            ) : null}
            <span className="sr-only">
              {ready && count > 0 ? `, ${count} item${count === 1 ? "" : "s"}` : ", empty"}
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}
