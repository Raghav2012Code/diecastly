import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { listCategories } from "@/lib/catalog/data";
import { CategoryManager } from "./category-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const categories = await listCategories(true);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Categories"
        description="One taxonomy for categories and series. Products keep their reference when you deactivate."
        actions={
          <Link href="/admin/products/new" className={buttonVariants()}>
            Add product
          </Link>
        }
      />
      <Tabs
        items={[
          { href: "/admin/products", label: "Products", active: false },
          { href: "/admin/products/categories", label: "Categories", active: true },
          { href: "/admin/products/suppliers", label: "Suppliers", active: false },
        ]}
      />
      {categories.ok ? (
        <CategoryManager categories={categories.data} />
      ) : (
        <EmptyState title="Categories could not be loaded" description={categories.error.message} />
      )}
    </div>
  );
}
