import type * as React from "react";
import Link from "next/link";
import { ArrowLeft, MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  orderChannelLabel,
  orderStatusLabel,
  orderStatusTone,
  paymentMethodLabel,
  paymentStatusLabel,
  paymentStatusTone,
} from "@/lib/display";
import { formatDateTimeIST } from "@/lib/dates";
import { addMoney, formatINR, orderContribution, productGrossProfit } from "@/lib/validation/money";
import { cn } from "@/lib/utils";
import type { OrderDetail, ShippingAddress } from "@/lib/types/database.types";

/**
 * Presentational order detail. The page and the preview harness both render
 * this, so the layout cannot drift; the page supplies its own actions (print,
 * record payment, record refund).
 */

function MoneyRow({
  label,
  value,
  strong = false,
  muted = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", strong && "pt-1")}>
      <span className={cn(strong ? "font-display text-base font-bold tracking-tight" : "text-muted-foreground")}>
        {label}
      </span>
      <span
        className={cn(
          "tnum",
          strong ? "font-display text-lg font-extrabold tracking-tight" : muted && "text-muted-foreground",
        )}
      >
        {formatINR(value)}
      </span>
    </div>
  );
}

function formatAddress(address: ShippingAddress): string {
  return [address.line1, address.line2, address.city, address.state, address.postal_code, address.country]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(", ");
}

export function OrderDetailView({
  detail,
  actions,
}: {
  detail: OrderDetail;
  actions?: React.ReactNode;
}) {
  const { order, financials, items, payments, history } = detail;
  const grossProfit = productGrossProfit(order.subtotal, order.cost_total);
  const contribution = orderContribution(grossProfit, order.shipping_fee, order.shipping_cost);
  const itemsGross = addMoney(order.subtotal, order.discount_total);
  const address = order.shipping_address;
  const units = items.reduce((total, item) => total + item.quantity, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Link
            href="/admin/orders"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Orders
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-bold leading-none tracking-tight">
              {order.order_number}
            </h1>
            <Badge tone={orderStatusTone[order.status]} dot>
              {orderStatusLabel[order.status]}
            </Badge>
            <Badge tone={paymentStatusTone[financials.payment_status]}>
              {paymentStatusLabel[financials.payment_status]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {orderChannelLabel[order.channel]} · {formatDateTimeIST(order.created_at)}
          </p>
        </div>

        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          <Card className="overflow-hidden">
            <div className="border-b border-border px-5 py-3">
              <h2 className="font-display text-lg font-bold tracking-tight">Items</h2>
              <p className="text-xs text-muted-foreground">
                {items.length} {items.length === 1 ? "line" : "lines"} · {units}{" "}
                {units === 1 ? "unit" : "units"}
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Unit cost</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Line total</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <p className="font-medium">{item.product_name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{item.sku ?? "—"}</p>
                    </TableCell>
                    <TableCell className="tnum text-right">{item.quantity}</TableCell>
                    <TableCell className="tnum text-right">{formatINR(item.unit_price)}</TableCell>
                    <TableCell className="tnum text-right text-muted-foreground">
                      {formatINR(item.unit_cost)}
                    </TableCell>
                    <TableCell className="tnum text-right text-muted-foreground">
                      {item.line_discount > 0 ? formatINR(item.line_discount) : "—"}
                    </TableCell>
                    <TableCell className="tnum text-right font-medium">{formatINR(item.line_total)}</TableCell>
                    <TableCell
                      className={cn(
                        "tnum text-right",
                        item.line_profit < 0 ? "text-destructive" : "text-success",
                      )}
                    >
                      {formatINR(item.line_profit)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Card>
            <div className="border-b border-border px-5 py-3">
              <h2 className="font-display text-lg font-bold tracking-tight">Payments</h2>
              <p className="text-xs text-muted-foreground">
                Append-only. Corrections are compensating entries.
              </p>
            </div>
            {payments.length === 0 ? (
              <p className="px-5 py-5 text-sm text-muted-foreground">No payments recorded yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {payments.map((payment) => (
                  <li key={payment.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {paymentMethodLabel[payment.method]}
                        {payment.reference ? ` · ${payment.reference}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTimeIST(payment.received_at ?? payment.created_at)}
                      </p>
                    </div>
                    <span className={cn("tnum shrink-0 font-medium", payment.amount < 0 && "text-destructive")}>
                      {formatINR(payment.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="border-b border-border px-5 py-3">
              <h2 className="font-display text-lg font-bold tracking-tight">History</h2>
            </div>
            <ol className="space-y-4 px-5 py-4">
              {history.map((entry) => (
                <li key={entry.id} className="flex gap-3">
                  <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  <div className="min-w-0">
                    <p className="text-sm">
                      {entry.from_status ? (
                        <span className="text-muted-foreground">
                          {orderStatusLabel[entry.from_status]} →{" "}
                        </span>
                      ) : null}
                      <span className="font-medium">{orderStatusLabel[entry.to_status]}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTimeIST(entry.created_at)}
                      {entry.note ? ` · ${entry.note}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-4 lg:self-start">
          <Card className="p-5">
            <h2 className="font-display text-lg font-bold tracking-tight">Customer</h2>
            <div className="mt-2 space-y-0.5 text-sm">
              <p className="font-medium">{order.customer_name ?? "Walk-in"}</p>
              {order.customer_phone ? (
                <p className="font-mono text-xs text-muted-foreground">{order.customer_phone}</p>
              ) : null}
              {order.customer_email ? (
                <p className="text-xs text-muted-foreground">{order.customer_email}</p>
              ) : null}
            </div>
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="font-display text-lg font-bold tracking-tight">Money</h2>
            <div className="space-y-1">
              {/* Gross items, so the rows reconcile: gross - discounts + shipping = total.
                  `subtotal` is net by definition (docs/database.md). */}
              <MoneyRow label="Subtotal" value={itemsGross} />
              {order.discount_total > 0 ? (
                <MoneyRow label="Discounts" value={order.discount_total} muted />
              ) : null}
              {order.shipping_fee > 0 ? <MoneyRow label="Shipping fee" value={order.shipping_fee} /> : null}
              <MoneyRow label="Total" value={order.total} strong />
            </div>
            <div className="space-y-1 border-t border-border pt-3">
              <MoneyRow label="Cost of goods" value={order.cost_total} muted />
              <MoneyRow label="Gross profit" value={grossProfit} />
              {order.shipping_fee > 0 || order.shipping_cost > 0 ? (
                <MoneyRow label="Contribution after shipping" value={contribution} />
              ) : null}
            </div>
            <div className="space-y-1 border-t border-border pt-3">
              <MoneyRow label="Received" value={financials.total_received} muted />
              {financials.total_refunded > 0 ? (
                <MoneyRow label="Refunded" value={financials.total_refunded} muted />
              ) : null}
              <MoneyRow label="Net paid" value={financials.net_paid} />
              {financials.balance > 0 ? <MoneyRow label="Balance" value={financials.balance} strong /> : null}
            </div>
          </Card>

          {order.notes ? (
            <Card className="p-5">
              <h2 className="font-display text-lg font-bold tracking-tight">Note</h2>
              <p className="mt-2 text-sm text-muted-foreground">{order.notes}</p>
            </Card>
          ) : null}

          {address ? (
            <Card className="p-5">
              <h2 className="font-display text-lg font-bold tracking-tight">Shipping</h2>
              <p className="mt-2 flex gap-2 text-sm text-muted-foreground">
                <MapPin aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{formatAddress(address) || "No address given"}</span>
              </p>
              {order.courier || order.tracking_number ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {[order.courier, order.tracking_number].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
