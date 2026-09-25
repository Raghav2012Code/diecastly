/** Product image Storage helpers. The bucket is public-read, admin-write. */

export const PRODUCT_IMAGE_BUCKET = "product-images";

/** Public URL for a stored object path. Safe to call from client or server. */
export function productImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  const clean = path.replace(/^\/+/, "");
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/${clean}`;
}

/** Storage object path for a new upload: one folder per product. */
export function productImageObjectPath(productId: string, fileName: string): string {
  const extension = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "jpg";
  const unique =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${productId}/${unique}.${extension}`;
}
