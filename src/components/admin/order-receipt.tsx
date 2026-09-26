import type * as React from "react";
import { Receipt } from "lucide-react";
import type { ReceiptView } from "@/lib/orders/receipt";
import { addMoney, formatINR, roundMoney } from "@/lib/validation/money";
import { formatDateTimeIST } from "@/lib/dates";
import { orderChannelLabel, paymentMethodLabel } from "@/lib/display";
import { cn } from "@/lib/utils";

/**
 * The receipt material. `ReceiptPaper`, `ReceiptDivider` and `ReceiptTotals`
 * are shared by the read-only printed receipt and the editable till ticket, so
 * the frame, header, rules and money rows cannot drift between the two.
 *
 * Deliberately its own material — warm paper, monospace, dashed rules, no
 * rounding — against the cool admin ground.
 */

export function ReceiptDivider() {
  return <div aria-hidden className="my-3 border-t border-dashed border-receipt-line" />;
}

export function ReceiptMoneyRow({
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
      <span className={cn(strong ? "font-display text-base font-bold tracking-tight" : "text-receipt-muted")}>
        {label}
      </span>
      <span
        className={cn(
          "tnum",
          strong
            ? "font-display text-lg font-extrabold tracking-tight"
            : muted && "text-receipt-muted",
        )}
      >
        {formatINR(value)}
      </span>
    </div>
  );
}

/** The paper frame and masthead. Children are the receipt body. */
export function ReceiptPaper({
  receipt,
  children,
  className,
}: {
  receipt: ReceiptView;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <article
      data-receipt
      className={cn(
        "mx-auto w-full max-w-[23rem] rounded-none border border-receipt-line bg-receipt px-5 py-6 font-mono text-[12px] leading-relaxed text-receipt-foreground shadow-sm",
        className,
      )}
    >
      <header className="text-center">
        <p className="font-display text-xl font-extrabold leading-none tracking-tight">
          {receipt.businessName}
        </p>
        {receipt.businessPhone || receipt.businessEmail ? (
          <p className="mt-1 text-receipt-muted">
            {[receipt.businessPhone, receipt.businessEmail].filter(Boolean).join("  ·  ")}
          </p>
        ) : null}
      </header>

      <ReceiptDivider />

      <div className="flex items-baseline justify-between gap-3 text-receipt-muted">
        <span>{orderChannelLabel[receipt.channel]}</span>
        <span className="tnum">{receipt.createdAt ? formatDateTimeIST(receipt.createdAt) : ""}</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <span className="text-receipt-muted">Order</span>
        <span>{receipt.orderNumber ?? "Draft"}</span>
      </div>
      {receipt.customerName ? (
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <span className="text-receipt-muted">Customer</span>
          <span className="truncate">{receipt.customerName}</span>
        </div>
      ) : null}

      {children}
    </article>
  );
}

/**
 * Gross items, then the discount as a visible deduction, then shipping, then
 * the total. The rows are ordered so the customer's own arithmetic closes:
 * itemsGross - discountTotal + shippingFee === total.
 */
export function ReceiptTotals({ receipt }: { receipt: ReceiptView }) {
  return (
    <div className="space-y-1">
      <ReceiptMoneyRow label="Subtotal" value={receipt.itemsGross} />
      {receipt.discountTotal > 0 ? (
        <ReceiptMoneyRow label="Discount" value={receipt.discountTotal} muted />
      ) : null}
      {receipt.shippingFee > 0 ? <ReceiptMoneyRow label="Shipping" value={receipt.shippingFee} /> : null}
      <ReceiptMoneyRow label="Total" value={receipt.total} strong />
    </div>
  );
}

/** The printed, read-only receipt. */
export function OrderReceipt({ receipt, className }: { receipt: ReceiptView; className?: string }) {
  const paid = addMoney(...receipt.payments.map((payment) => payment.amount));
  const balance = Math.max(0, roundMoney(receipt.total - paid));

  return (
    <ReceiptPaper receipt={receipt} className={className}>
      <ReceiptDivider />

      {receipt.lines.length === 0 ? (
        <p className="py-2 text-center text-receipt-muted">No items.</p>
      ) : (
        <ul className="space-y-2">
          {receipt.lines.map((line, index) => (
            <li key={`${line.name}-${index}`} className="flex gap-3">
              <span className="tnum w-6 shrink-0">{line.quantity}×</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{line.name}</span>
                {line.quantity > 1 ? (
                  <span className="tnum block text-receipt-muted">{formatINR(line.unitPrice)} each</span>
                ) : null}
                {line.lineDiscount > 0 ? (
                  <span className="tnum block text-receipt-muted">
                    less {formatINR(line.lineDiscount)}
                  </span>
                ) : null}
              </span>
              <span className="tnum shrink-0">{formatINR(line.lineTotal)}</span>
            </li>
          ))}
        </ul>
      )}

      <ReceiptDivider />
      <ReceiptTotals receipt={receipt} />

      {receipt.payments.length > 0 ? (
        <>
          <ReceiptDivider />
          <ul className="space-y-1">
            {receipt.payments.map((payment, index) => (
              <li key={`${payment.method}-${index}`} className="flex items-baseline justify-between gap-3">
                <span className="text-receipt-muted">
                  {paymentMethodLabel[payment.method]}
                  {payment.reference ? ` · ${payment.reference}` : ""}
                </span>
                <span className="tnum">{formatINR(payment.amount)}</span>
              </li>
            ))}
          </ul>
          {balance > 0 ? <ReceiptMoneyRow label="Balance due" value={balance} muted /> : null}
        </>
      ) : null}

      <ReceiptDivider />

      <p className="flex items-center justify-center gap-1.5 text-center text-receipt-muted">
        <Receipt aria-hidden className="h-3.5 w-3.5" />
        Thank you — keep this slip for exchanges.
      </p>
    </ReceiptPaper>
  );
}
