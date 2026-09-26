import { describe, expect, it } from "vitest";
import {
  categoryInputSchema,
  moneyField,
  productCreateSchema,
  productInputSchema,
  supplierInputSchema,
  slugify,
} from "@/lib/validation/catalog";
import { thresholdSchema } from "@/lib/validation/inventory";

describe("product validation", () => {
  it("accepts a minimal product and applies safe defaults", () => {
    const parsed = productInputSchema.parse({ name: "Hot Wheels Skyline GT-R" });
    expect(parsed.purchaseCost).toBe(0);
    expect(parsed.sellingPrice).toBe(0);
    expect(parsed.lowStockThreshold).toBe(0);
    expect(parsed.status).toBe("draft");
    expect(parsed.isFeatured).toBe(false);
    expect(parsed.slug).toBeNull();
    expect(parsed.brand).toBeNull();
    expect(parsed.categoryId).toBeNull();
  });

  it("rejects a missing name", () => {
    expect(() => productInputSchema.parse({ name: "   " })).toThrow();
  });

  it("rejects a negative price and cost", () => {
    expect(() => productInputSchema.parse({ name: "Car", sellingPrice: -1 })).toThrow();
    expect(() => productInputSchema.parse({ name: "Car", purchaseCost: -0.01 })).toThrow();
  });

  it("rejects a zero or negative low-stock threshold", () => {
    expect(() => productInputSchema.parse({ name: "Car", lowStockThreshold: -1 })).toThrow();
    expect(productInputSchema.parse({ name: "Car", lowStockThreshold: 0 }).lowStockThreshold).toBe(0);
  });

  it("rejects a malformed SKU and barcode", () => {
    expect(() => productInputSchema.parse({ name: "Car", sku: "bad sku!" })).toThrow();
    expect(() => productInputSchema.parse({ name: "Car", barcode: "12ab" })).toThrow();
    expect(productInputSchema.parse({ name: "Car", barcode: "8901234567890" }).barcode).toBe(
      "8901234567890",
    );
  });

  it("rejects a malformed slug", () => {
    expect(() => productInputSchema.parse({ name: "Car", slug: "Not A Slug" })).toThrow();
    expect(productInputSchema.parse({ name: "Car", slug: "hot-wheels-gtr" }).slug).toBe("hot-wheels-gtr");
  });

  it("normalises empty optional text to null", () => {
    const parsed = productInputSchema.parse({ name: "Car", brand: "", model: "", sku: "" });
    expect(parsed.brand).toBeNull();
    expect(parsed.model).toBeNull();
    expect(parsed.sku).toBeNull();
  });

  it("accepts a strictly positive opening stock and rejects zero or negative", () => {
    expect(productCreateSchema.parse({ name: "Car", openingStock: 5 }).openingStock).toBe(5);
    expect(productCreateSchema.parse({ name: "Car" }).openingStock).toBeUndefined();
    expect(() => productCreateSchema.parse({ name: "Car", openingStock: 0 })).toThrow();
    expect(() => productCreateSchema.parse({ name: "Car", openingStock: -3 })).toThrow();
  });

  it("rejects opening stock that is not a whole number", () => {
    expect(() => productCreateSchema.parse({ name: "Car", openingStock: 2.5 })).toThrow();
  });
});

describe("category and supplier validation", () => {
  it("requires a category name and defaults sort order and active flag", () => {
    const parsed = categoryInputSchema.parse({ name: "JDM" });
    expect(parsed.sortOrder).toBe(0);
    expect(parsed.isActive).toBe(true);
    expect(() => categoryInputSchema.parse({ name: "" })).toThrow();
  });

  it("accepts a supplier and validates email", () => {
    const parsed = supplierInputSchema.parse({ name: "Toy Co", email: "orders@toy.co" });
    expect(parsed.email).toBe("orders@toy.co");
    expect(() => supplierInputSchema.parse({ name: "Toy Co", email: "not-an-email" })).toThrow();
  });
});

describe("slugify", () => {
  it("creates URL-safe slugs", () => {
    expect(slugify("Hot Wheels: Nissan Skyline GT-R (R34)")).toBe("hot-wheels-nissan-skyline-gt-r-r34");
    expect(slugify("   ")).toBe("item");
    expect(slugify("Café 1:64")).toBe("cafe-1-64");
  });
});


// ---------------------------------------------------------------------------
// Numeric bounds: the shared contract must not be looser than the column.
// ---------------------------------------------------------------------------

describe("moneyField", () => {
  const price = moneyField("Enter a valid price.");

  it("accepts the largest value numeric(12,2) can hold", () => {
    expect(price.safeParse(9_999_999_999.99).success).toBe(true);
  });

  it("rejects money beyond what the column can store", () => {
    // Previously unbounded, so a mistyped price passed validation and then failed
    // at the database with a range error that maps to the generic message.
    expect(price.safeParse(99_999_999_999).success).toBe(false);
    expect(price.safeParse("99999999999").success).toBe(false);
  });

  it("rejects non-finite money", () => {
    expect(price.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
    expect(price.safeParse(Number.NaN).success).toBe(false);
    // The control for the claim that "1e400" was reaching storage as Infinity:
    // z.coerce.number() yields NaN for it, so it was already rejected. The
    // .finite() guard is not the thing fixing that, and this pins why.
    expect(price.safeParse("1e400").success).toBe(false);
  });

  it("still rejects negative money", () => {
    expect(price.safeParse(-1).success).toBe(false);
  });
});

describe("lowStockThreshold", () => {
  // The product form and the inventory dialog are two screens writing one
  // int4 column. They previously had independent definitions with different
  // ceilings -- the form had none -- so one accepted a value the other refused,
  // and both disagreed with the column.
  const BOUNDARIES = [0, 1, 1000, 100_000, 100_001, 2_147_483_647, 2_147_483_648, 1e300];

  it("agrees between the product form and the inventory dialog", () => {
    for (const value of BOUNDARIES) {
      const form = productInputSchema.shape.lowStockThreshold.safeParse(value);
      const dialog = thresholdSchema.shape.lowStockThreshold.safeParse(value);
      expect(
        form.success,
        `product form disagreed with the dialog at ${String(value)}`,
      ).toBe(dialog.success);
    }
  });

  it("rejects a threshold above the agreed ceiling", () => {
    expect(productInputSchema.shape.lowStockThreshold.safeParse(100_001).success).toBe(false);
    expect(thresholdSchema.shape.lowStockThreshold.safeParse(100_001).success).toBe(false);
  });

  it("rejects a threshold that does not fit int4", () => {
    expect(productInputSchema.shape.lowStockThreshold.safeParse(2_147_483_648).success).toBe(false);
    expect(thresholdSchema.shape.lowStockThreshold.safeParse(2_147_483_648).success).toBe(false);
  });

  it("still accepts a whole, non-negative threshold within range", () => {
    expect(productInputSchema.shape.lowStockThreshold.safeParse(0).success).toBe(true);
    expect(productInputSchema.shape.lowStockThreshold.safeParse(100_000).success).toBe(true);
    expect(productInputSchema.shape.lowStockThreshold.safeParse(-1).success).toBe(false);
    expect(productInputSchema.shape.lowStockThreshold.safeParse(1.5).success).toBe(false);
  });
});
