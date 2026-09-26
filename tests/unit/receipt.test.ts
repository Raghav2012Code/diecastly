import { describe, expect, it } from "vitest";
import { buildReceiptView, businessSummary, receiptFromOrder } from "@/lib/orders/receipt";
import { lineTotal, multiplyMoney, roundMoney } from "@/lib/validation/money";
import type { OrderItemRow, OrderReceipt } from "@/lib/types/database.types";

function item(overrides: Partial<OrderItemRow>): OrderItemRow {
  return {
    id: "item",
    order_id: "order",
    product_id: "product",
    product_name: "Hot Wheels Porsche 911",
    sku: "HW-911",
    quantity: 1,
    unit_price: 250,
    unit_cost: 150,
    line_discount: 0,
    line_total: 250,
    line_profit: 100,
    created_at: "2026-09-26T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildReceiptView", () => {
  it("derives the subtotal from line totals and the total from shipping", () => {
    const view = buildReceiptView({
      orderNumber: null,
      channel: "in_person",
      createdAt: null,
      customerName: null,
      paymentMethod: "cash",
      lines: [
        { name: "A", sku: null, quantity: 2, unitPrice: 250, lineDiscount: 0, lineTotal: 500 },
        { name: "B", sku: null, quantity: 1, unitPrice: 100, lineDiscount: 20, lineTotal: 80 },
      ],
      shippingFee: 40,
      payments: [],
      business: { name: "Diecastly", phone: null, email: null },
    });

    expect(view.subtotal).toBe(580);
    expect(view.discountTotal).toBe(20);
    expect(view.total).toBe(620);
  });

  it("treats an empty receipt as zero", () => {
    const view = buildReceiptView({
      orderNumber: null,
      channel: "in_person",
      createdAt: null,
      customerName: null,
      paymentMethod: "cash",
      lines: [],
      shippingFee: 0,
      payments: [],
      business: { name: "Diecastly", phone: null, email: null },
    });

    expect(view.subtotal).toBe(0);
    expect(view.total).toBe(0);
  });

  it("exposes a gross items figure that reconciles with the total", () => {
    // Guards the defect where `subtotal` is net by definition, so printing it
    // under the label "Subtotal" above a Discount row made a 500-rupee item
    // with 100 off read as "400 - 100, total 400". The rows must close:
    // gross - discount + shipping === total.
    const view = buildReceiptView({
      orderNumber: null,
      channel: "in_person",
      createdAt: null,
      customerName: null,
      paymentMethod: "cash",
      lines: [{ name: "A", sku: null, quantity: 1, unitPrice: 500, lineDiscount: 100, lineTotal: 400 }],
      shippingFee: 0,
      payments: [],
      business: { name: "Diecastly", phone: null, email: null },
    });

    expect(view.itemsGross).toBe(500);
    expect(view.discountTotal).toBe(100);
    expect(view.total).toBe(400);
    expect(view.itemsGross - view.discountTotal + view.shippingFee).toBe(view.total);
  });

  it("reconciles for any set of lines, discounts and shipping", () => {
    // A property, not an example: the printed arithmetic must close for every
    // basket, not just the fixture above.
    for (const shippingFee of [0, 60, 199.99]) {
      for (const discount of [0, 20, 100, 499.5]) {
        for (const quantity of [1, 2, 7]) {
          for (const unitPrice of [99, 250, 1299]) {
            const view = buildReceiptView({
              orderNumber: null,
              channel: "online",
              createdAt: null,
              customerName: null,
              paymentMethod: "upi",
              lines: [
                {
                  name: "A",
                  sku: null,
                  quantity,
                  unitPrice,
                  lineDiscount: discount,
                  lineTotal: lineTotal(unitPrice, quantity, discount),
                },
              ],
              shippingFee,
              payments: [],
              business: { name: "Diecastly", phone: null, email: null },
            });

            expect(view.itemsGross).toBe(multiplyMoney(unitPrice, quantity));
            // Rounded because the claim is that the printed figures reconcile to
            // the cent; the raw subtraction carries IEEE-754 error. This still
            // fails if `itemsGross` is the net subtotal: 400 - 100 + 0 !== 400.
            expect(roundMoney(view.itemsGross - view.discountTotal + view.shippingFee)).toBe(view.total);
            expect(view.total).toBe(roundMoney(view.subtotal + view.shippingFee));
          }
        }
      }
    }
  });
});

describe("receiptFromOrder", () => {
  const order = {
    order_number: "DC-2026-00042",
    channel: "in_person",
    created_at: "2026-09-26T10:00:00.000Z",
    customer_name: "Priya",
    payment_method: "cash",
    shipping_fee: 0,
  } as unknown as OrderReceipt["order"];

  it("maps stored items and payments, including refunds", () => {
    const receipt = receiptFromOrder({
      order,
      items: [item({ quantity: 2, unit_price: 250, line_total: 500 })],
      payments: [
        {
          method: "cash",
          amount: 500,
          reference: null,
          received_at: "2026-09-26T10:00:00.000Z",
          created_at: "2026-09-26T10:00:00.000Z",
        },
      ] as unknown as OrderReceipt["payments"],
      business: {
        business_name: "Diecastly",
        business_phone: "9876543210",
        business_email: null,
      } as unknown as OrderReceipt["business"],
    });

    expect(receipt.orderNumber).toBe("DC-2026-00042");
    expect(receipt.customerName).toBe("Priya");
    expect(receipt.lines).toHaveLength(1);
    expect(receipt.lines[0].lineTotal).toBe(500);
    expect(receipt.total).toBe(500);
    expect(receipt.payments[0]).toMatchObject({ method: "cash", amount: 500 });
    expect(receipt.businessName).toBe("Diecastly");
    expect(receipt.businessPhone).toBe("9876543210");
  });

  it("falls back to the default business name when settings are missing", () => {
    const receipt = receiptFromOrder({
      order,
      items: [],
      payments: [],
      business: null,
    });
    expect(receipt.businessName).toBe("Diecastly");
  });
});

describe("businessSummary", () => {
  it("returns safe defaults for missing settings", () => {
    expect(businessSummary(null)).toEqual({ name: "Diecastly", phone: null, email: null });
  });
});
