"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCart } from "@/lib/store/cart-context";
import { cartSubtotal, cartTotal, type CartLineLive } from "@/lib/store/cart";
import { formatINR } from "@/lib/validation/money";
import { placeOrderAction, type CheckoutResult } from "@/app/(store)/checkout/actions";
import { loadCartLiveAction } from "@/app/(store)/cart/actions";
import { newIdempotencyKey } from "@/lib/utils";

/**
 * Guest checkout form.
 *
 * The idempotency key is minted once per *intent* — once per basket, not once per
 * submit — and held in a ref. That is what makes a double-click, a back-and-
 * forth, or a retry after a dropped response resolve to one order rather than
 * several. Minting a fresh key per attempt would defeat it entirely.
 *
 * The key is reset only when the basket itself changes, because a different
 * basket is a different order and must not replay the previous one.
 *
 * The button is disabled in flight (ux.md §10) and there are no optimistic
 * updates anywhere: stock and money only ever change on the server's word.
 */
export function CheckoutForm({
  businessName,
  upiId,
  codEnabled,
  shippingFee,
}: {
  businessName: string;
  upiId: string | null;
  codEnabled: boolean;
  shippingFee: number;
}) {
  const cart = useCart();
  const router = useRouter();

  const [result, setResult] = React.useState<CheckoutResult | null>(null);
  const [pending, startTransition] = React.useTransition();

  const keyRef = React.useRef(newIdempotencyKey());
  const basketKey = cart.lines.map((l) => `${l.productId}:${l.quantity}`).join(",");

  // A different basket is a different order, so it gets a different key.
  const firstBasket = React.useRef(true);
  React.useEffect(() => {
    if (firstBasket.current) {
      firstBasket.current = false;
      return;
    }
    keyRef.current = newIdempotencyKey();
  }, [basketKey]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const value = (name: string) => {
      const raw = form.get(name);
      return typeof raw === "string" ? raw : "";
    };

    // COD is only offered when the seller has switched it on, and the server
    // re-checks it regardless — a stale form must not be able to force it.
    const requested = value("paymentMethod");
    const paymentMethod = requested === "cod" && codEnabled ? "cod" : "upi";

    startTransition(async () => {
      const outcome = await placeOrderAction({
        name: value("name"),
        phone: value("phone"),
        email: value("email"),
        addressLine1: value("addressLine1"),
        addressLine2: value("addressLine2"),
        city: value("city"),
        state: value("state"),
        postalCode: value("postalCode"),
        paymentMethod,
        notes: value("notes"),
        idempotencyKey: keyRef.current,
        items: cart.lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          snapshotPrice: line.unitPrice,
        })),
      });

      if (outcome.status === "placed") {
        // The basket has become an order. Cleared here rather than on the
        // confirmation page so a shopper who navigates back does not find it.
        cart.clear();
        router.push(`/order/${encodeURIComponent(outcome.orderNumber)}?token=${encodeURIComponent(outcome.accessToken)}`);
        return;
      }

      if (outcome.status === "needs-attention") {
        // Stock facts are corrected immediately — a line that cannot be fulfilled
        // is not the shopper's to insist on. A price change is left alone: it is
        // their decision, and the server will not spend their money for them.
        //
        // The report is always shown, including when only stock moved. Silently
        // retrying on their behalf would leave the basket quietly smaller than
        // they last saw it, which is exactly the kind of change that erodes
        // trust in a shop's totals.
        cart.applyStock(outcome.drift);
        setResult(outcome);
        return;
      }

      setResult(outcome);
    });
  }

  if (cart.ready && cart.lines.length === 0 && !pending) {
    return (
      <EmptyState
        title="Your cart is empty."
        description="Add something from the catalog before checking out."
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
    <form onSubmit={onSubmit} className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-6">
        {result && result.status !== "placed" ? (
          <div
            role="alert"
            className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3"
          >
            <p className="text-sm font-medium">{result.message}</p>

            {result.status === "needs-attention" && result.drift.priceChanges.length > 0 ? (
              <div className="space-y-2">
                <ul className="space-y-1 text-sm">
                  {result.drift.priceChanges.map((change) => (
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
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void (async () => {
                      const live = await loadCartLiveAction(
                        cart.lines.map((line) => line.productId),
                      );
                      if (live.ok) {
                        cart.adoptLive(
                          new Map<string, CartLineLive>(
                            live.live.map((row) => [row.productId, row]),
                          ),
                        );
                      }
                      keyRef.current = newIdempotencyKey();
                      setResult(null);
                    })();
                  }}
                >
                  Accept the new prices
                </Button>
              </div>
            ) : null}

            {result.status === "needs-attention" &&
            result.drift.priceChanges.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Please place the order again to continue with the updated basket.
              </p>
            ) : null}

            <Link href="/cart" className="inline-block text-sm underline underline-offset-4">
              Back to the cart
            </Link>
          </div>
        ) : null}

        <fieldset className="space-y-3">
          <legend className="font-display text-lg font-bold tracking-tight">Contact</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Name" htmlFor="name" required error={fieldError(result, "name")}>
              <Input id="name" name="name" autoComplete="name" required />
            </FormField>
            <FormField label="Phone" htmlFor="phone" required error={fieldError(result, "phone")}>
              <Input id="phone" name="phone" type="tel" autoComplete="tel" required />
            </FormField>
          </div>
          <FormField
            label="Email"
            htmlFor="email"
            hint="Optional. We only use this to contact you about this order."
          >
            <Input id="email" name="email" type="email" autoComplete="email" />
          </FormField>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-display text-lg font-bold tracking-tight">Delivery address</legend>
          <FormField
            label="Address"
            htmlFor="addressLine1"
            required
            error={fieldError(result, "addressLine1")}
          >
            <Input id="addressLine1" name="addressLine1" autoComplete="address-line1" required />
          </FormField>
          <FormField label="Apartment, suite (optional)" htmlFor="addressLine2">
            <Input id="addressLine2" name="addressLine2" autoComplete="address-line2" />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="City" htmlFor="city" required error={fieldError(result, "city")}>
              <Input id="city" name="city" autoComplete="address-level2" required />
            </FormField>
            <FormField label="State" htmlFor="state" required error={fieldError(result, "state")}>
              <Input id="state" name="state" autoComplete="address-level1" required />
            </FormField>
            <FormField
              label="PIN code"
              htmlFor="postalCode"
              required
              error={fieldError(result, "postalCode")}
            >
              <Input id="postalCode" name="postalCode" inputMode="numeric" autoComplete="postal-code" required />
            </FormField>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-display text-lg font-bold tracking-tight">Payment</legend>
          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3">
              <input
                type="radio"
                name="paymentMethod"
                value="upi"
                defaultChecked
                className="mt-0.5"
              />
              <span className="text-sm">
                <span className="font-medium">UPI</span>
                <span className="block text-muted-foreground">
                  Pay to {upiId ?? businessName} and send us the screenshot. We confirm once we
                  see it.
                </span>
              </span>
            </label>

            {/* COD is offered only when the seller has enabled it. The server
                checks again, so this is presentation, not enforcement. */}
            {codEnabled ? (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3">
                <input type="radio" name="paymentMethod" value="cod" className="mt-0.5" />
                <span className="text-sm">
                  <span className="font-medium">Cash on delivery</span>
                  <span className="block text-muted-foreground">
                    Pay the courier when the parcel arrives.
                  </span>
                </span>
              </label>
            ) : null}
          </div>

          <FormField label="Notes (optional)" htmlFor="notes">
            <Textarea id="notes" name="notes" rows={3} />
          </FormField>
        </fieldset>
      </div>

      <aside className="h-fit space-y-3 rounded-lg border border-border bg-card p-4 lg:sticky lg:top-20">
        <h2 className="font-display text-lg font-bold tracking-tight">Your order</h2>

        <ul className="space-y-2 border-b border-border pb-3 text-sm">
          {cart.lines.map((line) => (
            <li key={line.productId} className="flex justify-between gap-2">
              <span className="min-w-0 truncate">
                {line.name}
                <span className="text-muted-foreground"> × {line.quantity}</span>
              </span>
              <span className="shrink-0 tabular-nums">
                {formatINR(line.unitPrice * line.quantity)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
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

        <Button type="submit" size="lg" disabled={pending || !cart.ready} className="w-full">
          {pending ? "Placing your order…" : "Place order"}
        </Button>

        <p className="text-xs text-muted-foreground">
          Stock and prices are confirmed when you place the order.
        </p>
      </aside>
    </form>
  );
}

function fieldError(result: CheckoutResult | null, field: string): string | null {
  if (!result || result.status !== "failed") return null;
  return result.field === field ? result.message : null;
}
