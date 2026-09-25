import { describe, expect, it } from "vitest";
import {
  categoryInputSchema,
  productCreateSchema,
  productInputSchema,
  supplierInputSchema,
  slugify,
} from "@/lib/validation/catalog";

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
