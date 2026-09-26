"use client";

import Image from "next/image";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useCart } from "@/lib/store/cart-context";
import { useToast } from "@/components/ui/toast";
import { quantityCap, type CartLine } from "@/lib/store/cart";
import { formatINR } from "@/lib/validation/money";
import { productImageUrl } from "@/lib/storage";
import { StockBadge } from "@/components/store/product-card";

/**
 * Product detail: gallery, quantity, and Add to Cart / Buy Now.
 *
 * The quantity selector is capped at what the database says is available, taken
 * from the same `v_products_public` row the page was rendered from. That cap is a
 * courtesy, not a control: the server re-validates and would refuse an order the
 * shopper could not complete, so the number is floored to keep the page honest
 * rather than to prevent anything.
 *
 * No optimistic stock display anywhere (ux.md §12). The badge reflects what the
 * server said on render, and is not decremented when something is added to the
 * cart — the cart is not a reservation.
 */
export function ProductDetail({
  product,
}: {
  product: {
    id: string;
    name: string;
    slug: string;
    brand: string | null;
    model: string | null;
    series: string | null;
    description: string | null;
    selling_price: number;
    quantity: number;
    is_out_of_stock: boolean;
    is_low_stock: boolean;
    primary_image_path: string | null;
    images: { id: string; storage_path: string; alt_text: string | null; is_primary: boolean }[];
  };
}) {
  const cart = useCart();
  const { toast } = useToast();
  const [quantity, setQuantity] = React.useState(1);
  const [active, setActive] = React.useState(0);

  const cap = quantityCap(product.quantity);
  const soldOut = cap === 0;
  const gallery = product.images.length > 0 ? product.images : [];

  // The hero image is the primary, which the data layer already sorted first.
  const current = gallery[Math.min(active, Math.max(0, gallery.length - 1))];

  function addToCart(then: "cart" | "checkout") {
    if (soldOut) return;

    const line: CartLine = {
      productId: product.id,
      quantity: Math.min(quantity, cap),
      name: product.name,
      unitPrice: product.selling_price,
      imagePath: product.primary_image_path,
      slug: product.slug,
      available: product.quantity,
    };

    const { capped } = cart.add(line);
    toast(
      capped
        ? `Only ${cap} available — the cart now holds ${cap}.`
        : `${product.name} added to your cart.`,
      "success",
    );

    if (then === "checkout") {
      window.location.href = "/checkout";
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div>
        <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-secondary">
          {current ? (
            <Image
              src={productImageUrl(current.storage_path) ?? ""}
              alt={current.alt_text ?? product.name}
              fill
              priority
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-xs font-medium uppercase tracking-widest text-muted-foreground">
              No image
            </div>
          )}
        </div>

        {gallery.length > 1 ? (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {gallery.map((image, index) => (
              <button
                key={image.id}
                type="button"
                onClick={() => setActive(index)}
                aria-current={index === active}
                aria-label={`Show image ${index + 1} of ${gallery.length}`}
                className={`h-16 w-16 shrink-0 overflow-hidden rounded-md border-2 bg-secondary ${
                  index === active ? "border-foreground" : "border-transparent"
                }`}
              >
                <Image
                  src={productImageUrl(image.storage_path) ?? ""}
                  alt=""
                  fill
                  sizes="64px"
                  className="object-cover"
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="space-y-5">
        <div className="space-y-2">
          <StockBadge row={product} />
          <h1 className="font-display text-3xl font-extrabold tracking-tight">{product.name}</h1>
          <p className="text-sm text-muted-foreground">
            {[product.brand, product.model, product.series].filter(Boolean).join(" · ") || null}
          </p>
          <p className="text-2xl font-semibold">{formatINR(product.selling_price)}</p>
        </div>

        {product.description ? (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">Description</h2>
            {/* Whitespace preserved: sellers write these as paragraphs, and
                collapsing them runs the text together into one block. */}
            <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {product.description}
            </p>
          </div>
        ) : null}

        <div className="space-y-3">
          {soldOut ? (
            <p className="rounded-md border border-border bg-secondary/50 px-3 py-2.5 text-sm text-muted-foreground">
              This one is sold out. It may be restocked — please check back.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">Quantity</span>
                <div className="flex items-center rounded-md border border-border">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Decrease quantity"
                    disabled={quantity <= 1}
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  >
                    −
                  </Button>
                  <span className="min-w-10 text-center text-sm tabular-nums" aria-live="polite">
                    {quantity}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Increase quantity"
                    disabled={quantity >= cap}
                    onClick={() => setQuantity((q) => Math.min(cap, q + 1))}
                  >
                    +
                  </Button>
                </div>
                <span className="text-xs text-muted-foreground">{cap} available</span>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => addToCart("cart")}>
                  Add to cart
                </Button>
                <Button type="button" variant="secondary" onClick={() => addToCart("checkout")}>
                  Buy now
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
