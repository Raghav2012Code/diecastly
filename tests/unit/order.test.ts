import { describe, expect, it } from "vitest";
import {
  normalizePhone,
  onlineLineSchema,
  onlineOrderInputSchema,
  posLineSchema,
  posSaleInputSchema,
  recordPaymentSchema,
  refundPaymentSchema,
} from "@/lib/validation/order";

describe("posLineSchema", () => {
  const base = { productId: "11111111-1111-1111-1111-111111111111", quantity: 1 };

  it("clamps a discount larger than the line, which the database rejects", () => {
    // The database raises invalid_discount for line_discount > unit_price *
    // quantity. The schema used to accept this and forward it, so the shared
    // contract could describe a line the server would refuse.
    const parsed = posLineSchema.parse({ ...base, unitPrice: 100, lineDiscount: 9999 });
    expect(parsed.lineDiscount).toBe(100);
  });

  it("re-clamps when the price drops under an already-valid discount", () => {
    // The case that matters, and the one my first attempt at this test got wrong:
    // 50 off 2 x 40 is NOT over the line, because the line is worth 80. The
    // discount has to exceed unitPrice * quantity to be clamped, so the price
    // has to fall far enough -- 2 x 20 is worth 40, and 50 now exceeds it.
    //
    // This is exactly why the POS re-clamps on every change to price or
    // quantity: a discount valid at one price is not valid at a lower one.
    const parsed = posLineSchema.parse({ ...base, quantity: 2, unitPrice: 20, lineDiscount: 50 });
    expect(parsed.lineDiscount).toBe(40);

    // And the control: at the original price the same discount is left alone.
    const original = posLineSchema.parse({ ...base, quantity: 2, unitPrice: 100, lineDiscount: 50 });
    expect(original.lineDiscount).toBe(50);
  });

  it("leaves a valid discount alone", () => {
    const parsed = posLineSchema.parse({ ...base, quantity: 2, unitPrice: 100, lineDiscount: 50 });
    expect(parsed.lineDiscount).toBe(50);
  });

  it("treats a missing discount as zero", () => {
    const parsed = posLineSchema.parse({ ...base, unitPrice: 100 });
    expect(parsed.lineDiscount).toBe(0);
  });

  it("requires a strictly positive unit price", () => {
    expect(posLineSchema.safeParse({ ...base, unitPrice: 0 }).success).toBe(false);
    expect(posLineSchema.safeParse({ ...base, unitPrice: -5 }).success).toBe(false);
    expect(posLineSchema.safeParse({ ...base, unitPrice: 1 }).success).toBe(true);
  });

  it("requires a positive integer quantity", () => {
    expect(posLineSchema.safeParse({ ...base, quantity: 0, unitPrice: 10 }).success).toBe(false);
    expect(posLineSchema.safeParse({ ...base, quantity: 1.5, unitPrice: 10 }).success).toBe(false);
  });

  it("defaults line discount to zero", () => {
    const parsed = posLineSchema.parse({ ...base, unitPrice: 10 });
    expect(parsed.lineDiscount).toBe(0);
  });
});

describe("posSaleInputSchema", () => {
  const valid = {
    items: [
      {
        productId: "11111111-1111-1111-1111-111111111111",
        quantity: 2,
        unitPrice: 250,
        lineDiscount: 0,
      },
    ],
    paymentMethod: "cash" as const,
    idempotencyKey: "sale-key-0001",
  };

  it("accepts a valid sale", () => {
    expect(posSaleInputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a zero-value line inside the sale", () => {
    const invalid = {
      ...valid,
      items: [{ ...valid.items[0], unitPrice: 0 }],
    };
    expect(posSaleInputSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an empty cart", () => {
    expect(posSaleInputSchema.safeParse({ ...valid, items: [] }).success).toBe(false);
  });
});

describe("normalizePhone", () => {
  it("normalizes Indian numbers to E.164-ish form", () => {
    expect(normalizePhone("9876543210")).toBe("+919876543210");
    expect(normalizePhone("+91 98765 43210")).toBe("+919876543210");
    expect(normalizePhone("919876543210")).toBe("+919876543210");
  });
});

describe("onlineLineSchema", () => {
  const base = { productId: "11111111-1111-1111-1111-111111111111", quantity: 1 };

  it("takes no unit price, because the online caller is anonymous", () => {
    // place_online_order is security definer and granted to anon, so a price
    // from the caller is not trustworthy and is ignored server-side. The
    // contract must not ask for one.
    expect(onlineLineSchema.safeParse(base).success).toBe(true);
    expect(Object.keys(onlineLineSchema.parse(base))).toEqual(["productId", "quantity"]);
  });

  it("strips a supplied price rather than carrying it through", () => {
    const parsed = onlineLineSchema.parse({ ...base, unitPrice: 1, lineDiscount: 400 });
    expect(parsed).toEqual(base);
  });

  it("still requires a positive integer quantity and a uuid", () => {
    expect(onlineLineSchema.safeParse({ ...base, quantity: 0 }).success).toBe(false);
    expect(onlineLineSchema.safeParse({ ...base, quantity: 1.5 }).success).toBe(false);
    expect(onlineLineSchema.safeParse({ productId: "nope", quantity: 1 }).success).toBe(false);
  });

  it("leaves the POS line contract requiring a price", () => {
    // The two channels differ on purpose: the POS caller is an authenticated
    // admin who may negotiate. Weakening this while fixing the online one
    // would be the regression worth catching.
    expect(posLineSchema.safeParse(base).success).toBe(false);
    expect(posLineSchema.safeParse({ ...base, unitPrice: 250 }).success).toBe(true);
  });
});

describe("onlineOrderInputSchema", () => {
  const valid = {
    items: [{ productId: "11111111-1111-1111-1111-111111111111", quantity: 1 }],
    customer: {
      name: "Priya",
      phone: "9876543210",
      addressLine1: "12, 4th Cross",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560038",
    },
    paymentMethod: "upi" as const,
    idempotencyKey: "online-key-0001",
  };

  it("accepts an order with no price anywhere in the payload", () => {
    expect(onlineOrderInputSchema.safeParse(valid).success).toBe(true);
  });

  it("defaults the country", () => {
    const parsed = onlineOrderInputSchema.parse(valid);
    expect(parsed.customer.country).toBe("India");
  });

  it("rejects a non-storefront payment method", () => {
    expect(
      onlineOrderInputSchema.safeParse({ ...valid, paymentMethod: "cash" }).success,
    ).toBe(false);
  });

  it("rejects an empty basket", () => {
    expect(onlineOrderInputSchema.safeParse({ ...valid, items: [] }).success).toBe(false);
  });
});

const ORDER_ID = "22222222-2222-2222-2222-222222222222";

describe("recordPaymentSchema", () => {
  const valid = {
    orderId: ORDER_ID,
    amount: 250,
    method: "cash" as const,
    idempotencyKey: "pay-key-0001",
  };

  it("accepts a valid payment", () => {
    expect(recordPaymentSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a non-positive amount", () => {
    expect(recordPaymentSchema.safeParse({ ...valid, amount: 0 }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ ...valid, amount: -1 }).success).toBe(false);
  });

  it("rejects an unknown method", () => {
    expect(recordPaymentSchema.safeParse({ ...valid, method: "bitcoin" }).success).toBe(false);
  });

  it("requires an idempotency key", () => {
    expect(recordPaymentSchema.safeParse({ ...valid, idempotencyKey: "short" }).success).toBe(false);
  });
});

describe("refundPaymentSchema", () => {
  const valid = {
    orderId: ORDER_ID,
    amount: 50,
    idempotencyKey: "refund-key-0001",
  };

  it("accepts a valid refund and defaults the method to other", () => {
    const parsed = refundPaymentSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.method).toBe("other");
  });

  it("rejects a non-positive amount", () => {
    expect(refundPaymentSchema.safeParse({ ...valid, amount: 0 }).success).toBe(false);
  });
});
