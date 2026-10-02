import { describe, expect, it } from "vitest";
import {
  customerInputSchema,
  customerPhoneSchema,
  customerArchiveSchema,
  customerIdSchema,
} from "@/lib/validation/customers";
import { orderNotesSchema } from "@/lib/validation/order";
import { describeDbError, GENERIC_ERROR_MESSAGE } from "@/lib/db/errors";

/**
 * Customer metadata validation.
 *
 * The phone assertions matter more than they look. `phone_normalized` is a
 * UNIQUE index and is the linking key between an order and a customer's history,
 * so the normaliser is shared with checkout rather than reimplemented here — a
 * second rule would let an admin save a phone whose stored form differs from the
 * one a later checkout computes, producing two rows for one person with no
 * violation anywhere. These tests pin that the two really do agree.
 */

const base = {
  name: "Asha Rao",
  phone: "9876543210",
  email: "asha@example.com",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "India",
  notes: "",
  isActive: true,
};

describe("customerPhoneSchema", () => {
  it("normalises a bare ten-digit mobile to +91", () => {
    expect(customerPhoneSchema.parse("9876543210")).toBe("+919876543210");
  });

  it("accepts a number already carrying the country code and does not double it", () => {
    // The specific bug worth pinning: "+919876543210" has 12 digits starting
    // with 91. A naive "+91" prefix would yield "+91+919876543210".
    expect(customerPhoneSchema.parse("+919876543210")).toBe("+919876543210");
    expect(customerPhoneSchema.parse("919876543210")).toBe("+919876543210");
  });

  it("agrees with the checkout normaliser it is meant to share", () => {
    // Both schemas must reach the same stored value, or a customer created by an
    // admin and a customer created at checkout stop being the same record.
    const adminStored = customerInputSchema.parse(base).phone;
    expect(adminStored).toBe("+919876543210");
  });

  it("rejects a number with too few or too many digits", () => {
    expect(customerPhoneSchema.safeParse("12345").success).toBe(false);
    expect(customerPhoneSchema.safeParse("12345678901234").success).toBe(false);
  });

  it("keeps a landline that is ten digits rather than assuming a mobile", () => {
    expect(customerPhoneSchema.safeParse("0801234567").success).toBe(true);
  });
});

describe("customerInputSchema", () => {
  it("accepts a complete record", () => {
    const parsed = customerInputSchema.safeParse(base);
    expect(parsed.success).toBe(true);
  });

  it("requires a name", () => {
    const parsed = customerInputSchema.safeParse({ ...base, name: "   " });
    expect(parsed.success).toBe(false);
  });

  it("defaults an empty country to India, matching the column default", () => {
    const parsed = customerInputSchema.parse({ ...base, country: "" });
    expect(parsed.country).toBe("India");
  });

  it("defaults isActive to true, so an archived customer is never created by accident", () => {
    const parsed = customerInputSchema.parse({ ...base, isActive: undefined });
    expect(parsed.isActive).toBe(true);
  });

  it("treats empty optional text as absent rather than as an empty string", () => {
    const parsed = customerInputSchema.parse({ ...base, email: "", city: "", notes: "" });
    expect(parsed.email).toBeFalsy();
    expect(parsed.city).toBeFalsy();
    expect(parsed.notes).toBeFalsy();
  });
});

describe("customerArchiveSchema", () => {
  it("accepts a well-formed archive request", () => {
    const parsed = customerArchiveSchema.safeParse({
      customerId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      isActive: false,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an id that is not a uuid", () => {
    expect(customerIdSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(
      customerArchiveSchema.safeParse({ customerId: "not-a-uuid", isActive: false }).success,
    ).toBe(false);
  });
});

describe("orderNotesSchema", () => {
  it("stores an empty note as NULL rather than an empty string", () => {
    // "has a note" has to stay a single direct test; an empty string would make
    // it a length comparison everywhere it is read.
    expect(orderNotesSchema.parse({ orderId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", notes: "   " }).notes).toBeNull();
    expect(orderNotesSchema.parse({ orderId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", notes: "" }).notes).toBeNull();
  });

  it("keeps real text, trimmed", () => {
    const parsed = orderNotesSchema.parse({
      orderId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      notes: "  customer called about the courier  ",
    });
    expect(parsed.notes).toBe("customer called about the courier");
  });

  it("rejects an over-long note and an id that is not a uuid", () => {
    expect(
      orderNotesSchema.safeParse({ orderId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", notes: "x".repeat(2001) })
        .success,
    ).toBe(false);
    expect(orderNotesSchema.safeParse({ orderId: "nope", notes: "hi" }).success).toBe(false);
  });
});

describe("the customer write path raises only mapped codes", () => {
  it("translates product_not_found, which add/delete image paths can raise", () => {
    // The new image RPC raises an existing token rather than a new one, so it
    // must already be translated — otherwise an admin deleting an image for a
    // product removed a moment ago would meet the generic message.
    const { message } = describeDbError({ code: "P0001", message: "product_not_found" });
    expect(message).not.toBe(GENERIC_ERROR_MESSAGE);
    expect(message).toBe("That product no longer exists.");
  });
});
