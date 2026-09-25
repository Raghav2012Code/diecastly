import { PageHeader } from "@/components/ui/page-header";
import { listCategories, listSuppliers } from "@/lib/catalog/data";
import { ProductForm, emptyProductFormValues } from "../product-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New product" };

export default async function NewProductPage() {
  const [categories, suppliers] = await Promise.all([listCategories(), listSuppliers()]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="New product"
        description="Metadata saves first, then opening stock is recorded through the ledger."
      />
      <ProductForm
        mode="create"
        categories={categories.ok ? categories.data.map((c) => ({ id: c.id, name: c.name })) : []}
        suppliers={suppliers.ok ? suppliers.data.map((s) => ({ id: s.id, name: s.name })) : []}
        hasInitialStock={false}
        initial={emptyProductFormValues}
      />
    </div>
  );
}
