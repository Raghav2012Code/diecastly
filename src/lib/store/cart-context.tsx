"use client";

import * as React from "react";
import {
  addLine as addLinePure,
  applyStockDrift,
  cartCount as countLines,
  parseCart,
  refreshSnapshots,
  removeLine as removeLinePure,
  setLineQuantity as setQuantityPure,
  type CartDrift,
  type CartLine,
  type CartLineLive,
} from "@/lib/store/cart";

const STORAGE_KEY = "diecastly.cart.v1";

type CartContextValue = {
  lines: CartLine[];
  /** False until localStorage has been read, so the header does not flash "0 items" then correct itself. */
  ready: boolean;
  count: number;
  add: (line: CartLine) => { capped: boolean };
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  /** Rewrite the whole cart from the live catalog, used after the shopper agrees to a price change. */
  adoptLive: (liveById: Map<string, CartLineLive>) => void;
  /** Apply only the stock facts from a drift report. */
  applyStock: (drift: CartDrift) => void;
};

const CartContext = React.createContext<CartContextValue | null>(null);

function readStorage(): CartLine[] {
  if (typeof window === "undefined") return [];
  return parseCart(window.localStorage.getItem(STORAGE_KEY));
}

/**
 * The storefront cart.
 *
 * Client-side and non-authoritative by design (ux.md §10): it persists to
 * localStorage so a basket survives a refresh, and the server re-validates price
 * and stock before any order exists. Nothing here is trusted downstream.
 *
 * The provider deliberately starts empty and sets `ready` only after reading
 * storage in an effect. Reading localStorage during render would make the first
 * paint disagree with the server's, and a cart badge that reads 0 and then jumps
 * to 3 is worse than one that waits.
 */
export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = React.useState<CartLine[]>([]);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    setLines(readStorage());
    setReady(true);
  }, []);

  // Persist only once storage has been read, or the first effect's empty state
  // would overwrite a real basket before it was ever loaded.
  React.useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // A full or disabled localStorage must not break the shop. The cart simply
      // stops surviving a refresh, which is recoverable; failing the render is not.
    }
  }, [lines, ready]);

  // Keep tabs in step, so two open tabs do not disagree about the basket.
  React.useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== STORAGE_KEY) return;
      setLines(event.newValue ? parseCart(event.newValue) : []);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = React.useMemo<CartContextValue>(
    () => ({
      lines,
      ready,
      count: countLines(lines),
      add: (line) => {
        let capped = false;
        setLines((current) => {
          const result = addLinePure(current, line);
          capped = result.capped;
          return result.lines;
        });
        // setLines runs synchronously enough for this to be set before return in
        // practice, but the caller only uses it for a toast, so a stale false is
        // harmless and better than lying about a cap that did happen.
        return { capped };
      },
      setQuantity: (productId, quantity) =>
        setLines((current) => setQuantityPure(current, productId, quantity)),
      remove: (productId) => setLines((current) => removeLinePure(current, productId)),
      clear: () => setLines([]),
      adoptLive: (liveById) => setLines((current) => refreshSnapshots(current, liveById)),
      applyStock: (drift) => setLines((current) => applyStockDrift(current, drift)),
    }),
    [lines, ready],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = React.useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used inside a CartProvider");
  }
  return context;
}
