import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  getProduct,
  hasInitialStock,
  listCategories,
  listProductImages,
  listSuppliers,
} from "@/lib/catalog/data";
import { productStatusLabel, productStatusTone } from "@/lib/display";
import { ProductForm, productFormValuesFrom } from "../product-form";
import { ProductImages } from "../product-images";

export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [product, categories, suppliers, images, initial] = await Promise.all([
    getProduct(id),
    listCategories(),
    listSuppliers(),
    listProductImages(id),
    hasInitialStock(id),
  ]);

  if (!product.ok) {
    return (
      <EmptyState
        title="Product could not be loaded"
        description={product.error.message}
        action={
          <Link href="/admin/products" className={buttonVariants({ variant: "outline" })}>
            Back to products
          </Link>
        }
      />
    );
  }

  if (!product.data) notFound();
  const row = product.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={row.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2.5">
            <Badge tone={productStatusTone[row.status]} dot>
              {productStatusLabel[row.status]}
            </Badge>
            {row.sku ? <span className="font-mono text-xs">{row.sku}</span> : null}
            <span>{row.quantity} in stock</span>
          </span>
        }
        actions={
          <Link href="/admin/inventory" className={buttonVariants({ variant: "outline" })}>
            Inventory
          </Link>
        }
      />
      <ProductForm
        mode="edit"
        productId={id}
        categories={categories.ok ? categories.data.map((c) => ({ id: c.id, name: c.name })) : []}
        suppliers={suppliers.ok ? suppliers.data.map((s) => ({ id: s.id, name: s.name })) : []}
        hasInitialStock={initial.ok ? initial.data : false}
        initial={productFormValuesFrom(row)}
      />
      <ProductImages productId={id} images={images.ok ? images.data : []} />
    </div>
  );
}
