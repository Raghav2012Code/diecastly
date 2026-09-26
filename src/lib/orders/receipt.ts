import type {
  OrderChannel,
  OrderItemRow,
  OrderReceipt,
  PaymentMethod,
  SettingsRow,
} from "@/lib/types/database.types";
import { addMoney, roundMoney } from "@/lib/validation/money";

/**
 * Receipt view model. Both the till's live receipt and the stored-order receipt
 * render this one shape, so the two can never drift. Pure data — no database
 * access, no formatting of locale beyond what the component does.
 */

export type ReceiptLine = {
  name: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  lineDiscount: number;
  lineTotal: number;
};

export type ReceiptPaymentLine = {
  method: PaymentMethod;
  amount: number;
  reference: string | null;
  at: string | null;
};

export type ReceiptView = {
  orderNumber: string | null;
  channel: OrderChannel;
  createdAt: string | null;
  customerName: string | null;
  paymentMethod: PaymentMethod | null;
  lines: ReceiptLine[];
  /**
   * Gross item value before discounts, for display only. The canonical
   * `subtotal` is net (sum of line totals, discounts already applied) — see
   * docs/database.md — so printing it under the label "Subtotal" above a
   * Discount row makes the receipt's own arithmetic fail to close.
   */
  itemsGross: number;
  subtotal: number;
  discountTotal: number;
  shippingFee: number;
  total: number;
  payments: ReceiptPaymentLine[];
  businessName: string;
  businessPhone: string | null;
  businessEmail: string | null;
};

export function businessSummary(settings: SettingsRow | null): {
  name: string;
  phone: string | null;
  email: string | null;
} {
  return {
    name: settings?.business_name ?? "Diecastly",
    phone: settings?.business_phone ?? null,
    email: settings?.business_email ?? null,
  };
}

export function receiptLineFromItem(item: OrderItemRow): ReceiptLine {
  return {
    name: item.product_name,
    sku: item.sku,
    quantity: item.quantity,
    unitPrice: item.unit_price,
    lineDiscount: item.line_discount,
    lineTotal: item.line_total,
  };
}

export type ReceiptBusiness = {
  name: string;
  phone: string | null;
  email: string | null;
};

export function buildReceiptView(input: {
  orderNumber: string | null;
  channel: OrderChannel;
  createdAt: string | null;
  customerName: string | null;
  paymentMethod: PaymentMethod | null;
  lines: ReceiptLine[];
  shippingFee: number;
  payments: ReceiptPaymentLine[];
  business: ReceiptBusiness;
}): ReceiptView {
  const subtotal = addMoney(...input.lines.map((line) => line.lineTotal));
  const discountTotal = addMoney(...input.lines.map((line) => roundMoney(line.lineDiscount)));
  const business = input.business;

  return {
    orderNumber: input.orderNumber,
    channel: input.channel,
    createdAt: input.createdAt,
    customerName: input.customerName,
    paymentMethod: input.paymentMethod,
    lines: input.lines,
    // Gross = net + discount, which is exactly sum(unit_price * quantity).
    itemsGross: addMoney(subtotal, discountTotal),
    subtotal,
    discountTotal,
    shippingFee: roundMoney(input.shippingFee),
    total: addMoney(subtotal, input.shippingFee),
    payments: input.payments,
    businessName: business.name,
    businessPhone: business.phone,
    businessEmail: business.email,
  };
}

export function receiptFromOrder(receipt: OrderReceipt): ReceiptView {
  return buildReceiptView({
    orderNumber: receipt.order.order_number,
    channel: receipt.order.channel,
    createdAt: receipt.order.created_at,
    customerName: receipt.order.customer_name,
    paymentMethod: receipt.order.payment_method,
    lines: receipt.items.map(receiptLineFromItem),
    shippingFee: receipt.order.shipping_fee,
    payments: receipt.payments.map((payment) => ({
      method: payment.method,
      amount: payment.amount,
      reference: payment.reference,
      at: payment.received_at ?? payment.created_at,
    })),
    business: businessSummary(receipt.business),
  });
}
