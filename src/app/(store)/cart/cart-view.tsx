"use client";

import * as React from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useCart } from "@/lib/store/cart-context";
import {
  cartCount,
  cartSubtotal,
  cartTotal,
  compareCart,
  quantityCap,
  type CartDrift,
  type CartLineLive,
} from "@/lib/store/cart";
import { formatINR } from "@/lib/validation/money";
import { loadCartLiveAction } from "@/app/(store)/cart/actions";
import { ProductImage } from "@/components/store/product-card";

/**
 * The cart.
 *
 * Re-reads the live catalog on mount and whenever the basket changes, because
 * the stored snapshot is only what the shopper saw when they added the item. Two
 * things can have moved since: the price, and the stock.
 *
 * Stock drift is applied automatically — a line that can no longer be fulfilled
 * is reduced or dropped, because the alternative is an order the server will
 * reject outright and the shopper loses the whole basket over one line.
 *
 * Price drift is NOT applied automatically. ux.md §10 is explicit that a price
 * change surfaces a clear notice, and deciding to spend more money is not a
 * correction the shop should make on the shopper's behalf. They are offered the
 * new price and asked.
 */
export function CartView({ shippingFee }: { shippingFee: number }) {
  const cart = useCart();
  const [drift, setDrift] = React.useState<CartDrift | null>(null);
  const [checking, setChecking] = React.useState(false);

  const productIds = React.useMemo(() => cart.lines.map((line) => line.productId), [cart.lines]);
  const idsKey = productIds.join(",");

  React.useEffect(() => {
    if (!cart.ready || cart.lines.length === 0) {
      setDrift(null);
      return;
    }

    let cancelled = false;
    setChecking(true);

    void (async () => {
      const result = await loadCartLiveAction(idsKey ? idsKey.split(",") : []);
      if (cancelled) return;
      setChecking(false);
      if (!result.ok) return;

      const liveById = new Map<string, CartLineLive>(
        result.live.map((row) => [row.productId, row]),
      );
      const report = compareCart(cart.lines, liveById);
      setDrift(report.clean ? null : report);
      // Stock facts are not the shopper's to overrule, so they are applied here.
      cart.applyStock(report);
      // Intentionally not refreshing price snapshots: that waits for consent.
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, cart.ready]);

  if (!cart.ready) {
    // Nothing rendered until storage has been read, so the page never shows an
    // empty basket that is about to become a full one.
    return (
      <div className="py-10 text-center text-sm text-muted-foreground" aria-live="polite">
        Loading your cart…
      </div>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <EmptyState
        title="Your cart is empty."
        description="Nothing here yet. Have a look through the catalog."
        action={
          <Link href="/" className={buttonVariants()}>
            Browse the catalog
          </Link>
        }
      />
    );
  }

  const subtotal = cartSubtotal(cart.lines);
  const total = cartTotal(cart.lines, shippingFee);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-3">
        {drift && drift.priceChanges.length > 0 ? (
          <div
            role="status"
            className="space-y-2 rounded-md border border-warning/40 bg-warning/10 px-4 py-3"
          >
            <p className="text-sm font-medium">A price changed since you added this</p>
            <ul className="space-y-1 text-sm">
              {drift.priceChanges.map((change) => (
                <li key={change.productId} className="flex flex-wrap items-center gap-2">
                  <span>{change.name}</span>
                  <span className="text-muted-foreground line-through">
                    {formatINR(change.was)}
                  </span>
                  <span aria-hidden>→</span>
                  <span className="font-medium">{formatINR(change.now)}</span>
                </li>
              ))}
            </ul>
            <AcceptPriceChanges idsKey={idsKey} />
          </div>
        ) : null}

        {drift && drift.removals.length > 0 ? (
          <p
            role="status"
            className="rounded-md border border-border bg-secondary/60 px-4 py-2.5 text-sm text-muted-foreground"
          >
            {drift.removals.length === 1
              ? `${drift.removals[0].name} is no longer available and was removed.`
              : `${drift.removals.length} items are no longer available and were removed.`}
          </p>
        ) : null}

        {drift && drift.reductions.length > 0 ? (
          <p
            role="status"
            className="rounded-md border border-border bg-secondary/60 px-4 py-2.5 text-sm text-muted-foreground"
          >
            {drift.reductions.length === 1
              ? `Only ${drift.reductions[0].quantity} of ${drift.reductions[0].name} left — the quantity was reduced.`
              : `${drift.reductions.length} quantities were reduced to what is in stock.`}
          </p>
        ) : null}

        <ul className="divide-y divide-border rounded-lg border border-border">
          {cart.lines.map((line) => {
            const cap = quantityCap(line.available);
            return (
              <li key={line.productId} className="flex gap-3 p-3">
                <Link
                  href={line.slug ? `/products/${line.slug}` : "#"}
                  className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md bg-secondary"
                >
                  <ProductImage
                    path={line.imagePath ?? null}
                    alt={line.name}
                    sizes="80px"
                    className="rounded-md"
                  />
                </Link>

                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Link
                    href={line.slug ? `/products/${line.slug}` : "#"}
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {line.name}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {formatINR(line.unitPrice)} each
                  </p>

                  <div className="mt-1 flex items-center gap-3">
                    <div className="flex items-center rounded-md border border-border">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Decrease quantity of ${line.name}`}
                        onClick={() => cart.setQuantity(line.productId, line.quantity - 1)}
                      >
                        −
                      </Button>
                      <span className="min-w-9 text-center text-sm tabular-nums">
                        {line.quantity}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Increase quantity of ${line.name}`}
                        disabled={line.quantity >= cap}
                        onClick={() => cart.setQuantity(line.productId, line.quantity + 1)}
                      >
                        +
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => cart.remove(line.productId)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>

                <p className="shrink-0 text-sm font-semibold">
                  {formatINR(line.unitPrice * line.quantity)}
                </p>
              </li>
            );
          })}
        </ul>
      </div>

      <aside className="h-fit space-y-3 rounded-lg border border-border bg-card p-4 lg:sticky lg:top-20">
        <h2 className="font-display text-lg font-bold tracking-tight">Summary</h2>
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">
              Subtotal ({cartCount(cart.lines)} item{cartCount(cart.lines) === 1 ? "" : "s"})
            </dt>
            <dd className="tabular-nums">{formatINR(subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Shipping</dt>
            <dd className="tabular-nums">
              {shippingFee > 0 ? formatINR(shippingFee) : "Free"}
            </dd>
          </div>
          <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatINR(total)}</dd>
          </div>
        </dl>

        <Link href="/checkout" className={buttonVariants({ size: "lg" })}>
          Checkout
        </Link>

        <p className="text-xs text-muted-foreground">
          Prices and availability are confirmed at checkout.
          {checking ? " Checking now…" : ""}
        </p>
      </aside>
    </div>
  );
}

/**
 * The consent step for a price change.
 *
 * Fetches the live rows again and rewrites the snapshots, so the consent is
 * acting on data fetched at the moment of the click rather than on a report that
 * may itself be stale.
 */
function AcceptPriceChanges({ idsKey }: { idsKey: string }) {
  const cart = useCart();
  const [busy, setBusy] = React.useState(false);

  return (
    <Button
      type="button"
      size="sm"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void (async () => {
          const result = await loadCartLiveAction(idsKey ? idsKey.split(",") : []);
          if (result.ok) {
            cart.adoptLive(
              new Map<string, CartLineLive>(result.live.map((row) => [row.productId, row])),
            );
          }
          setBusy(false);
        })();
      }}
    >
      {busy ? "Updating…" : "Use the new prices"}
    </Button>
  );
}
