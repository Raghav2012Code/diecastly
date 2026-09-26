import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { productImageUrl } from "@/lib/storage";
import { formatINR } from "@/lib/validation/money";
import type { VProductsPublicRow } from "@/lib/types/database.types";

/**
 * Availability, as a single decision in one place.
 *
 * `v_products_public` already derives `is_out_of_stock` and `is_low_stock` in SQL,
 * and this trusts those flags rather than re-deriving a threshold. That is the
 * point of computing them there: the catalog grid, the product page and the cart
 * cannot disagree about whether something is sellable, because none of them
 * decides it.
 *
 * "Only N left" is capped at a small number rather than printing whatever is
 * left, so a product with 4,000 units does not advertise itself as scarce.
 */
export type StockState =
  | { kind: "out"; label: string; tone: "danger" }
  | { kind: "low"; label: string; tone: "warning" }
  | { kind: "in"; label: string; tone: "success" };

const SCARCITY_THRESHOLD = 5;

export function stockState(row: Pick<VProductsPublicRow, "quantity" | "is_out_of_stock" | "is_low_stock">): StockState {
  if (row.is_out_of_stock || row.quantity <= 0) {
    return { kind: "out", label: "Sold out", tone: "danger" };
  }
  if (row.is_low_stock || row.quantity <= SCARCITY_THRESHOLD) {
    return {
      kind: "low",
      label: row.quantity <= SCARCITY_THRESHOLD ? `Only ${row.quantity} left` : "Low stock",
      tone: "warning",
    };
  }
  return { kind: "in", label: "In stock", tone: "success" };
}

export function StockBadge({
  row,
  className,
}: {
  row: Pick<VProductsPublicRow, "quantity" | "is_out_of_stock" | "is_low_stock">;
  className?: string;
}) {
  const state = stockState(row);
  return (
    <Badge tone={state.tone} className={className}>
      {state.label}
    </Badge>
  );
}

/**
 * A product image, or a neutral placeholder.
 *
 * `productImageUrl` returns null when the path is empty or the public env is
 * absent, so the placeholder is a real state rather than an error case. Alt text
 * falls back to the product name because an unlabelled image is invisible to a
 * screen reader, and a decorative-looking box on a shop is worse than a missing
 * one.
 */
export function ProductImage({
  path,
  alt,
  sizes,
  className,
  priority = false,
}: {
  path: string | null;
  alt: string;
  sizes: string;
  className?: string;
  priority?: boolean;
}) {
  const url = productImageUrl(path);

  if (!url) {
    return (
      <div
        className={`grid place-items-center bg-secondary text-xs font-medium uppercase tracking-widest text-muted-foreground ${className ?? ""}`}
        aria-hidden
      >
        No image
      </div>
    );
  }

  // `fill` rather than width/height: the caller owns the box (an
  // aspect-ratio container in the grid), and next/image requires either explicit
  // dimensions or `fill`. Passing neither renders at the intrinsic default and
  // collapses the card.
  return (
    <Image
      src={url}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      className={`object-cover ${className ?? ""}`}
    />
  );
}

/**
 * `priority` preloads the image. Set only for the first row of a grid: those are
 * above the fold on every viewport, and preloading the rest would have them
 * compete for bandwidth with the ones the shopper is actually looking at.
 */
export function ProductCard({
  product,
  priority = false,
}: {
  product: VProductsPublicRow;
  priority?: boolean;
}) {
  const soldOut = product.is_out_of_stock || product.quantity <= 0;

  return (
    <Link
      href={`/products/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-foreground/25"
    >
      <div className="relative aspect-square overflow-hidden bg-secondary">
        <ProductImage
          path={product.primary_image_path}
          alt={product.name}
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          className="h-full w-full"
          priority={priority}
        />
        <div className="absolute left-2 top-2">
          <StockBadge row={product} />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="line-clamp-2 text-sm font-medium leading-snug group-hover:underline">
          {product.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {[product.brand, product.series].filter(Boolean).join(" · ") || "—"}
        </p>
        <p className="mt-auto pt-1 text-sm font-semibold">{formatINR(product.selling_price)}</p>
        {soldOut ? (
          <p className="text-xs text-muted-foreground">Currently unavailable</p>
        ) : null}
      </div>
    </Link>
  );
}
