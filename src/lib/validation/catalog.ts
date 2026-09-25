import { z } from "zod";
import { PRODUCT_STATUSES } from "@/lib/types/database.types";

/**
 * Shared catalog schemas. Forms and server actions validate with the same
 * schemas, so the client can never submit data the server would reject.
 */

const emptyToNull = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? null : value;

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const optionalText = (max: number) =>
  z
    .preprocess(emptyToNull, z.string().trim().max(max).nullish())
    .transform((value) => value ?? null);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter a URL slug.")
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens.");

export const optionalSlug = z
  .preprocess(emptyToNull, slugSchema.nullish())
  .transform((value) => value ?? null);

export const skuSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/, "SKU must be 2–64 letters, numbers, dots, dashes or underscores.");

export const barcodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{6,20}$/, "Barcode must be 6–20 digits.");

export const optionalUuid = z
  .preprocess(emptyToNull, z.string().uuid().nullish())
  .transform((value) => value ?? null);

export const optionalEmail = z
  .preprocess(emptyToNull, z.string().trim().email("Enter a valid email address.").max(200).nullish())
  .transform((value) => value ?? null);

export const optionalSku = z
  .preprocess(emptyToNull, skuSchema.nullish())
  .transform((value) => value ?? null);

export const optionalBarcode = z
  .preprocess(emptyToNull, barcodeSchema.nullish())
  .transform((value) => value ?? null);

export const moneyField = (message: string) =>
  z.coerce
    .number({ invalid_type_error: message })
    .nonnegative("Amount cannot be negative.")
    .default(0);

export const productInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a product name.").max(160),
  slug: optionalSlug,
  brand: optionalText(120),
  model: optionalText(120),
  series: optionalText(120),
  categoryId: optionalUuid,
  supplierId: optionalUuid,
  description: optionalText(4000),
  sku: optionalSku,
  barcode: optionalBarcode,
  purchaseCost: moneyField("Enter a valid cost."),
  sellingPrice: moneyField("Enter a valid price."),
  lowStockThreshold: z.coerce
    .number()
    .int("Use a whole number.")
    .nonnegative("Threshold cannot be negative.")
    .default(0),
  status: z.enum(PRODUCT_STATUSES).default("draft"),
  isFeatured: z.boolean().default(false),
});

/** Create adds an optional opening quantity, applied separately via the RPC. */
export const productCreateSchema = productInputSchema.extend({
  openingStock: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number()
      .int("Use a whole number.")
      .positive("Opening stock must be greater than zero.")
      .optional(),
  ),
});

export const productUpdateSchema = productInputSchema;

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a category name.").max(120),
  slug: optionalSlug,
  parentId: optionalUuid,
  sortOrder: z.coerce.number().int("Use a whole number.").nonnegative().default(0),
  isActive: z.boolean().default(true),
});

export const supplierInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a supplier name.").max(120),
  contactName: optionalText(120),
  phone: optionalText(32),
  email: optionalEmail,
  notes: optionalText(1000),
  isActive: z.boolean().default(true),
});

export const imageOrderSchema = z.object({
  images: z
    .array(
      z.object({
        id: z.string().uuid(),
        sortOrder: z.coerce.number().int().nonnegative(),
      }),
    )
    .min(1),
});

export const imageAltSchema = z.object({
  id: z.string().uuid(),
  altText: optionalText(200),
});

export const productImageInputSchema = z.object({
  productId: z.string().uuid(),
  storagePath: z.string().trim().min(1).max(400),
  altText: optionalText(200),
  isPrimary: z.boolean().default(false),
});

export type ProductInput = z.infer<typeof productInputSchema>;
export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type SupplierInput = z.infer<typeof supplierInputSchema>;

/** Derives a URL-safe slug when the admin does not supply one. */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return slug || "item";
}
