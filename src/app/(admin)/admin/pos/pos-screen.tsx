"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Minus, Plus, Printer, RotateCcw, ScanLine, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ProductThumb } from "@/components/admin/product-thumb";
import {
  OrderReceipt,
  ReceiptDivider,
  ReceiptMoneyRow,
  ReceiptPaper,
  ReceiptTotals,
} from "@/components/admin/order-receipt";
import { buildReceiptView, type ReceiptBusiness } from "@/lib/orders/receipt";
import { posSaleInputSchema } from "@/lib/validation/order";
import { addMoney, clampLineDiscount, formatINR, lineTotal, roundMoney } from "@/lib/validation/money";
import { cn, newIdempotencyKey } from "@/lib/utils";
import type { SellableProduct } from "@/lib/types/database.types";
import {
  completeSaleAction,
  searchSellableProductsAction,
  type CompletedSale,
  type PosCustomerOption,
} from "./actions";
import { CustomerPicker } from "./customer-picker";

type TillMethod = "cash" | "upi";

type CartLine = {
  productId: string;
  name: string;
  sku: string | null;
  unitPrice: number;
  quantity: number;
  lineDiscount: number;
  available: number;
};

type LineEditor = { productId: string; price: string; discount: string };

const RESULT_LIMIT = 60;

export function PosScreen({
  catalog,
  catalogTotal,
  catalogCapped,
  business,
}: {
  catalog: SellableProduct[];
  catalogTotal: number;
  catalogCapped: boolean;
  business: ReceiptBusiness;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const searchRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef(newIdempotencyKey());
  const completeRef = useRef<() => void>(() => {});

  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [remoteResults, setRemoteResults] = useState<SellableProduct[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<LineEditor | null>(null);
  const [customer, setCustomer] = useState<PosCustomerOption | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<TillMethod>("cash");
  const [receivedTouched, setReceivedTouched] = useState(false);
  const [receivedInput, setReceivedInput] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [completed, setCompleted] = useState<CompletedSale | null>(null);
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());

  const catalogById = useMemo(() => new Map(catalog.map((product) => [product.id, product])), [catalog]);
  const term = query.trim().toLowerCase();

  const localResults = useMemo(() => {
    if (!term) return catalog.slice(0, RESULT_LIMIT);
    return catalog
      .filter((product) => {
        return (
          product.name.toLowerCase().includes(term) ||
          (product.sku ?? "").toLowerCase().includes(term) ||
          (product.barcode ?? "").toLowerCase().includes(term) ||
          (product.brand ?? "").toLowerCase().includes(term)
        );
      })
      .slice(0, RESULT_LIMIT);
  }, [catalog, term]);

  // Only when the streamed catalog was capped do we ask the server for a term
  // that has no local match.
  useEffect(() => {
    if (!catalogCapped || term.length < 2 || localResults.length > 0) {
      setRemoteResults(null);
      return;
    }
    let active = true;
    const handle = setTimeout(async () => {
      setSearching(true);
      const result = await searchSellableProductsAction(query);
      if (!active) return;
      setSearching(false);
      setRemoteResults(result.ok ? result.data : []);
    }, 180);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [catalogCapped, term, localResults.length, query]);

  // Refresh availability snapshots after the server re-renders the catalog
  // (for example following an insufficient-stock error).
  useEffect(() => {
    setCart((previous) =>
      previous.map((line) => {
        const product = catalogById.get(line.productId);
        if (!product || product.quantity === line.available) return line;
        return { ...line, available: product.quantity };
      }),
    );
  }, [catalogById]);

  const resultRows = useMemo(() => {
    const rows = localResults.length > 0 ? localResults : (remoteResults ?? []);
    if (!term || rows.length < 2) return rows;
    const exact = rows.filter(
      (product) =>
        (product.barcode ?? "").toLowerCase() === term || (product.sku ?? "").toLowerCase() === term,
    );
    if (exact.length === 0) return rows;
    return [...exact, ...rows.filter((product) => !exact.includes(product))];
  }, [localResults, remoteResults, term]);

  const subtotal = useMemo(
    () => addMoney(...cart.map((line) => lineTotal(line.unitPrice, line.quantity, line.lineDiscount))),
    [cart],
  );
  const total = subtotal;

  const receivedValue = receivedTouched
    ? receivedInput.trim() === ""
      ? 0
      : Number(receivedInput)
    : total;
  const receivedValid = Number.isFinite(receivedValue) && receivedValue >= 0;
  const applied = Math.min(receivedValid ? roundMoney(receivedValue) : 0, total);
  const change = paymentMethod === "cash" && receivedValid ? Math.max(0, roundMoney(receivedValue - total)) : 0;
  const balance = Math.max(0, roundMoney(total - applied));
  const hasOverStock = cart.some((line) => line.quantity > line.available);

  const liveReceipt = useMemo(
    () =>
      buildReceiptView({
        orderNumber: null,
        channel: "in_person",
        createdAt: startedAt,
        customerName: customer?.name ?? null,
        paymentMethod,
        lines: cart.map((line) => ({
          name: line.name,
          sku: line.sku,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineDiscount: line.lineDiscount,
          lineTotal: lineTotal(line.unitPrice, line.quantity, line.lineDiscount),
        })),
        shippingFee: 0,
        payments:
          cart.length > 0 && applied > 0
            ? [{ method: paymentMethod, amount: applied, reference: null, at: null }]
            : [],
        business,
      }),
    [cart, customer, paymentMethod, applied, startedAt, business],
  );

  function flash(productId: string) {
    setLastAddedId(productId);
    window.setTimeout(() => {
      setLastAddedId((current) => (current === productId ? null : current));
    }, 420);
  }

  function addProduct(product: SellableProduct) {
    if (product.quantity <= 0) {
      toast(`${product.name} is sold out.`, "error");
      return;
    }
    setError(null);
    setCart((previous) => {
      const existing = previous.find((line) => line.productId === product.id);
      if (existing) {
        if (existing.quantity >= existing.available) return previous;
        return previous.map((line) =>
          line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [
        ...previous,
        {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          unitPrice: product.selling_price,
          quantity: 1,
          lineDiscount: 0,
          available: product.quantity,
        },
      ];
    });
    flash(product.id);
  }

  function changeQuantity(productId: string, delta: number) {
    setCart((previous) =>
      previous.map((line) => {
        if (line.productId !== productId) return line;
        const next = Math.min(Math.max(1, line.quantity + delta), line.available);
        if (next === line.quantity) return line;
        // A smaller quantity can invalidate an existing discount, so re-clamp.
        return { ...line, quantity: next, lineDiscount: clampLineDiscount(line.unitPrice, next, line.lineDiscount) };
      }),
    );
  }

  function removeLine(productId: string) {
    setCart((previous) => previous.filter((line) => line.productId !== productId));
    setEditor((current) => (current?.productId === productId ? null : current));
  }

  function toggleEditor(line: CartLine) {
    setEditor((current) =>
      current?.productId === line.productId
        ? null
        : { productId: line.productId, price: String(line.unitPrice), discount: line.lineDiscount ? String(line.lineDiscount) : "" },
    );
  }

  function onPriceInput(value: string) {
    if (!editor) return;
    setEditor({ ...editor, price: value });
    const parsed = Number(value);
    if (value.trim() !== "" && Number.isFinite(parsed) && parsed > 0) {
      const price = roundMoney(parsed);
      setCart((previous) =>
        previous.map((line) =>
          line.productId === editor.productId
            ? // Lowering the price can leave the discount larger than the line
              // is now worth, which would show a negative line total and get
              // the whole sale rejected. Re-clamp here, exactly as the discount
              // editor does, so the line is always one the server accepts.
              { ...line, unitPrice: price, lineDiscount: clampLineDiscount(price, line.quantity, line.lineDiscount) }
            : line,
        ),
      );
    }
  }

  function onDiscountInput(value: string) {
    if (!editor) return;
    setEditor({ ...editor, discount: value });
    const line = cart.find((item) => item.productId === editor.productId);
    if (!line) return;
    const parsed = value.trim() === "" ? 0 : Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      const next = clampLineDiscount(line.unitPrice, line.quantity, parsed);
      setCart((previous) =>
        previous.map((item) =>
          item.productId === editor.productId ? { ...item, lineDiscount: next } : item,
        ),
      );
    }
  }

  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (resultRows.length === 0) return;
    const code = query.trim().toLowerCase();
    const exact = resultRows.find(
      (product) =>
        (product.barcode ?? "").toLowerCase() === code || (product.sku ?? "").toLowerCase() === code,
    );
    addProduct(exact ?? resultRows[0]);
    setQuery("");
    setRemoteResults(null);
  }

  function complete() {
    if (completed || pending) return;
    if (cart.length === 0) {
      setError("Add at least one item first.");
      return;
    }
    if (applied <= 0) {
      setError("Enter the amount received.");
      return;
    }
    if (hasOverStock) {
      setError("A line is over the available stock. Reduce it and try again.");
      return;
    }

    const payload = {
      items: cart.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineDiscount: line.lineDiscount,
      })),
      paymentMethod,
      payments: [{ amount: applied, method: paymentMethod }],
      customer: customer ? { name: customer.name, phone: customer.phone, email: customer.email ?? undefined } : undefined,
      notes: notes.trim() ? notes.trim() : undefined,
      idempotencyKey: keyRef.current,
    };

    const parsed = posSaleInputSchema.safeParse(payload);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Check the sale and try again.";
      setError(message);
      toast(message, "error");
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await completeSaleAction(parsed.data);
      if (result.ok) {
        setCompleted(result.data);
        toast(`Sale ${result.data.orderNumber} recorded`, "success");
        router.refresh();
      } else {
        setError(result.error);
        toast(result.error, "error");
        router.refresh();
      }
    });
  }

  useEffect(() => {
    completeRef.current = complete;
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        completeRef.current();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function newSale() {
    setCompleted(null);
    setCart([]);
    setEditor(null);
    setCustomer(null);
    setPaymentMethod("cash");
    setReceivedTouched(false);
    setReceivedInput("");
    setNotes("");
    setError(null);
    setQuery("");
    setRemoteResults(null);
    keyRef.current = newIdempotencyKey();
    setStartedAt(new Date().toISOString());
    searchRef.current?.focus();
  }

  if (completed) {
    return (
      <div className="space-y-5">
        <header className="no-print flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-success/15 text-success">
              <Check className="h-5 w-5" />
            </span>
            <div>
              <h1 className="font-display text-2xl font-bold leading-none tracking-tight">Sale recorded</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {completed.orderNumber} · {formatINR(completed.total)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
              Print
            </Button>
            <Link
              href={`/admin/orders/${completed.orderId}`}
              className={buttonVariants({ variant: "outline" })}
            >
              View order
            </Link>
            <Button onClick={newSale}>
              <RotateCcw className="h-4 w-4" />
              New sale
            </Button>
          </div>
        </header>
        <OrderReceipt receipt={completed.receipt} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold leading-none tracking-tight">Record Sale</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Scan or search, take payment, hand over the slip.
          </p>
        </div>
        <p className="hidden text-xs text-muted-foreground sm:block">
          <kbd className="rounded-sm border border-border bg-card px-1.5 py-0.5 font-sans">Ctrl</kbd>
          {" + "}
          <kbd className="rounded-sm border border-border bg-card px-1.5 py-0.5 font-sans">Enter</kbd>
          {" completes the sale"}
        </p>
      </header>

      <div className="no-print grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <section className="flex min-h-0 min-w-0 flex-col" aria-label="Product search">
          <div className="relative">
            <ScanLine
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchRef}
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Scan a barcode, or search name, SKU or brand"
              aria-label="Search products"
              className="h-11 pl-9 pr-9 text-base"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setRemoteResults(null);
                  searchRef.current?.focus();
                }}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {catalogTotal} active {catalogTotal === 1 ? "product" : "products"}
            {catalogCapped ? " (showing the first 2,000 — search reaches the rest)" : ""}
          </p>

          <Card className="mt-3 min-h-0 overflow-hidden">
            {catalog.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <p className="font-display text-lg font-bold tracking-tight">No products to sell yet</p>
                <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                  Add a product and set its opening stock, then it will appear here.
                </p>
                <Link href="/admin/products/new" className={cn(buttonVariants(), "mt-4")}>
                  Add product
                </Link>
              </div>
            ) : resultRows.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                {searching ? "Searching…" : `No product matches “${query.trim()}”.`}
              </p>
            ) : (
              <ul className="max-h-[calc(100vh-17rem)] divide-y divide-border overflow-y-auto">
                {resultRows.map((product) => {
                  const soldOut = product.quantity <= 0;
                  const low = !soldOut && product.quantity <= product.low_stock_threshold;
                  const inCart = cart.find((line) => line.productId === product.id);
                  return (
                    <li key={product.id}>
                      <button
                        type="button"
                        onClick={() => addProduct(product)}
                        disabled={soldOut}
                        className={cn(
                          "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                          "hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          soldOut && "cursor-not-allowed opacity-55",
                        )}
                      >
                        <ProductThumb path={product.primary_image_path} name={product.name} size={36} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{product.name}</span>
                          <span className="block truncate font-mono text-[11px] text-muted-foreground">
                            {[product.brand, product.sku].filter(Boolean).join(" · ") || "No SKU"}
                            {inCart ? ` · ${inCart.quantity} in cart` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="tnum block text-sm font-semibold">
                            {formatINR(product.selling_price)}
                          </span>
                          <span
                            className={cn(
                              "tnum block text-[11px]",
                              soldOut
                                ? "text-destructive"
                                : low
                                  ? "text-warning"
                                  : "text-muted-foreground",
                            )}
                          >
                            {soldOut ? "Sold out" : `${product.quantity} in stock`}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </section>

        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start" aria-label="Basket and payment">
          <CustomerPicker customer={customer} onChange={setCustomer} />

          <ReceiptPaper receipt={liveReceipt}>
            <ReceiptDivider />
            {cart.length === 0 ? (
              <p className="py-4 text-center text-receipt-muted">
                No items yet. Scan or search to start the sale.
              </p>
            ) : (
              <ul className="divide-y divide-receipt-line/70">
                {cart.map((line) => (
                  <li
                    key={line.productId}
                    className={cn(
                      "py-2",
                      lastAddedId === line.productId && "motion-safe:animate-[line-in_420ms_ease-out]",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <span className="flex items-center rounded-sm border border-receipt-line">
                        <button
                          type="button"
                          onClick={() => changeQuantity(line.productId, -1)}
                          disabled={line.quantity <= 1}
                          aria-label={`Decrease ${line.name}`}
                          className="grid h-6 w-6 place-items-center hover:bg-receipt-line/50 disabled:opacity-40"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="tnum w-6 text-center">{line.quantity}</span>
                        <button
                          type="button"
                          onClick={() => changeQuantity(line.productId, 1)}
                          disabled={line.quantity >= line.available}
                          aria-label={`Increase ${line.name}`}
                          className="grid h-6 w-6 place-items-center hover:bg-receipt-line/50 disabled:opacity-40"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleEditor(line)}
                        aria-expanded={editor?.productId === line.productId}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="block truncate">{line.name}</span>
                        <span className="tnum block text-receipt-muted">
                          {formatINR(line.unitPrice)} each
                          {line.lineDiscount > 0 ? ` · less ${formatINR(line.lineDiscount)}` : ""}
                        </span>
                      </button>
                      <span className="tnum shrink-0">
                        {formatINR(lineTotal(line.unitPrice, line.quantity, line.lineDiscount))}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeLine(line.productId)}
                        aria-label={`Remove ${line.name}`}
                        className="mt-0.5 text-receipt-muted hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {editor?.productId === line.productId ? (
                      <div className="mt-2 grid grid-cols-2 gap-2 rounded-sm border border-dashed border-receipt-line p-2">
                        <label className="space-y-1">
                          <span className="block text-[11px] text-receipt-muted">Unit price</span>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            inputMode="decimal"
                            value={editor.price}
                            onChange={(event) => onPriceInput(event.target.value)}
                            aria-label={`Unit price for ${line.name}`}
                            className="tnum h-7 w-full rounded-sm border border-receipt-line bg-receipt px-2 text-right focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="block text-[11px] text-receipt-muted">Discount</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={editor.discount}
                            onChange={(event) => onDiscountInput(event.target.value)}
                            aria-label={`Line discount for ${line.name}`}
                            className="tnum h-7 w-full rounded-sm border border-receipt-line bg-receipt px-2 text-right focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                          />
                        </label>
                      </div>
                    ) : null}

                    {line.quantity > line.available ? (
                      <p className="mt-1 text-[11px] font-medium text-destructive">
                        Only {line.available} in stock now.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            <ReceiptDivider />
            <ReceiptTotals receipt={liveReceipt} />

            <ReceiptDivider />

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-receipt-muted">Payment</span>
                <div className="flex overflow-hidden rounded-sm border border-receipt-line">
                  {(["cash", "upi"] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentMethod(method)}
                      aria-pressed={paymentMethod === method}
                      className={cn(
                        "px-3 py-1 text-[11px] font-medium",
                        paymentMethod === method
                          ? "bg-receipt-foreground text-receipt"
                          : "text-receipt-muted hover:bg-receipt-line/50",
                      )}
                    >
                      {method === "cash" ? "Cash" : "UPI"}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center justify-between gap-3">
                <span className="text-receipt-muted">Received</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={receivedTouched ? receivedInput : total.toFixed(2)}
                  onChange={(event) => {
                    setReceivedTouched(true);
                    setReceivedInput(event.target.value);
                  }}
                  aria-label="Amount received"
                  className="tnum h-7 w-28 rounded-sm border border-receipt-line bg-receipt px-2 text-right focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                />
              </label>
              {change > 0 ? (
                <ReceiptMoneyRow label="Change due" value={change} />
              ) : balance > 0 && applied > 0 ? (
                <ReceiptMoneyRow label="Balance" value={balance} muted />
              ) : null}
            </div>
          </ReceiptPaper>

          <div className="space-y-2">
            <Input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Sale note (optional)"
              aria-label="Sale note"
            />
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button
              size="lg"
              className="w-full"
              onClick={complete}
              disabled={pending || cart.length === 0 || applied <= 0 || hasOverStock}
            >
              {pending
                ? "Recording…"
                : hasOverStock
                  ? "Fix the stock on a line"
                  : applied <= 0
                    ? "Enter the amount received"
                    : `Complete sale · ${formatINR(total)}`}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
