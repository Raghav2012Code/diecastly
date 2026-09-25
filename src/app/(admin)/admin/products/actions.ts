"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fromFriendly, fromZod, type ActionResult } from "@/lib/action-result";
import { setInitialStock } from "@/lib/db/rpc";
import * as catalog from "@/lib/catalog/data";
import {
  categoryInputSchema,
  imageAltSchema,
  imageOrderSchema,
  productCreateSchema,
  productImageInputSchema,
  productUpdateSchema,
  supplierInputSchema,
} from "@/lib/validation/catalog";
import { PRODUCT_STATUSES } from "@/lib/types/database.types";

function revalidateCatalog(productId?: string) {
  revalidatePath("/admin/products");
  revalidatePath("/admin/products/categories");
  revalidatePath("/admin/products/suppliers");
  if (productId) revalidatePath(`/admin/products/${productId}`);
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/movements");
}

const uuidSchema = z.string().uuid();

export type CreateProductResult = { productId: string; stockWarning?: string };

export async function createProductAction(input: unknown): Promise<ActionResult<CreateProductResult>> {
  const parsed = productCreateSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const created = await catalog.createProduct(parsed.data);
  if (!created.ok) return fromFriendly(created.error);

  const product = created.data;
  let stockWarning: string | undefined;

  if (parsed.data.openingStock && parsed.data.openingStock > 0) {
    const supabase = await createClient();
    const stock = await setInitialStock(supabase, {
      productId: product.id,
      quantity: parsed.data.openingStock,
    });
    if (!stock.ok) {
      stockWarning = `Product saved, but opening stock could not be recorded: ${stock.error.message}`;
    }
  }

  revalidateCatalog(product.id);
  return { ok: true, data: { productId: product.id, stockWarning } };
}

export async function updateProductAction(id: string, input: unknown): Promise<ActionResult<null>> {
  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) return fromZod(idParsed.error);

  const parsed = productUpdateSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const updated = await catalog.updateProduct(id, parsed.data);
  if (!updated.ok) return fromFriendly(updated.error);

  revalidateCatalog(id);
  return { ok: true, data: null };
}

export async function setProductStatusAction(id: string, status: string): Promise<ActionResult<null>> {
  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) return fromZod(idParsed.error);

  const statusParsed = z.enum(PRODUCT_STATUSES).safeParse(status);
  if (!statusParsed.success) return fromZod(statusParsed.error);

  const updated = await catalog.setProductStatus(id, statusParsed.data);
  if (!updated.ok) return fromFriendly(updated.error);

  revalidateCatalog(id);
  return { ok: true, data: null };
}

export async function setProductFeaturedAction(id: string, isFeatured: boolean): Promise<ActionResult<null>> {
  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) return fromZod(idParsed.error);

  const updated = await catalog.setProductFeatured(id, Boolean(isFeatured));
  if (!updated.ok) return fromFriendly(updated.error);

  revalidateCatalog(id);
  return { ok: true, data: null };
}

export async function registerProductImageAction(input: unknown): Promise<ActionResult<null>> {
  const parsed = productImageInputSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const added = await catalog.addProductImage(parsed.data);
  if (!added.ok) return fromFriendly(added.error);

  revalidateCatalog(parsed.data.productId);
  return { ok: true, data: null };
}

export async function deleteProductImageAction(
  imageId: string,
  productId: string,
): Promise<ActionResult<null>> {
  const parsed = z.object({ imageId: uuidSchema, productId: uuidSchema }).safeParse({ imageId, productId });
  if (!parsed.success) return fromZod(parsed.error);

  const deleted = await catalog.deleteProductImage(imageId);
  if (!deleted.ok) return fromFriendly(deleted.error);

  revalidateCatalog(productId);
  return { ok: true, data: null };
}

export async function setPrimaryImageAction(
  productId: string,
  imageId: string,
): Promise<ActionResult<null>> {
  const parsed = z.object({ productId: uuidSchema, imageId: uuidSchema }).safeParse({ productId, imageId });
  if (!parsed.success) return fromZod(parsed.error);

  const primary = await catalog.setPrimaryImage(productId, imageId);
  if (!primary.ok) return fromFriendly(primary.error);

  revalidateCatalog(productId);
  return { ok: true, data: null };
}

export async function reorderProductImagesAction(input: unknown): Promise<ActionResult<null>> {
  const parsed = imageOrderSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const reordered = await catalog.reorderProductImages(parsed.data.images);
  if (!reordered.ok) return fromFriendly(reordered.error);

  revalidatePath("/admin/products");
  return { ok: true, data: null };
}

export async function updateImageAltAction(input: unknown): Promise<ActionResult<null>> {
  const parsed = imageAltSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const updated = await catalog.updateImageAlt(parsed.data.id, parsed.data.altText);
  if (!updated.ok) return fromFriendly(updated.error);

  revalidatePath("/admin/products");
  return { ok: true, data: null };
}

export async function createCategoryAction(input: unknown): Promise<ActionResult<null>> {
  const parsed = categoryInputSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const created = await catalog.createCategory(parsed.data);
  if (!created.ok) return fromFriendly(created.error);

  revalidateCatalog();
  return { ok: true, data: null };
}

export async function updateCategoryAction(id: string, input: unknown): Promise<ActionResult<null>> {
  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) return fromZod(idParsed.error);

  const parsed = categoryInputSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const updated = await catalog.updateCategory(id, parsed.data);
  if (!updated.ok) return fromFriendly(updated.error);

  revalidateCatalog();
  return { ok: true, data: null };
}

export async function createSupplierAction(input: unknown): Promise<ActionResult<null>> {
  const parsed = supplierInputSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const created = await catalog.createSupplier(parsed.data);
  if (!created.ok) return fromFriendly(created.error);

  revalidateCatalog();
  return { ok: true, data: null };
}

export async function updateSupplierAction(id: string, input: unknown): Promise<ActionResult<null>> {
  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) return fromZod(idParsed.error);

  const parsed = supplierInputSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const updated = await catalog.updateSupplier(id, parsed.data);
  if (!updated.ok) return fromFriendly(updated.error);

  revalidateCatalog();
  return { ok: true, data: null };
}
