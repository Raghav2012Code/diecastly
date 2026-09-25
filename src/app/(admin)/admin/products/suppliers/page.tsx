import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { listSuppliers } from "@/lib/catalog/data";
import { SupplierManager } from "./supplier-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const suppliers = await listSuppliers(true);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppliers"
        description="Where stock comes from. Deactivating keeps the reference on old products."
        actions={
          <Link href="/admin/products/new" className={buttonVariants()}>
            Add product
          </Link>
        }
      />
      <Tabs
        items={[
          { href: "/admin/products", label: "Products", active: false },
          { href: "/admin/products/categories", label: "Categories", active: false },
          { href: "/admin/products/suppliers", label: "Suppliers", active: true },
        ]}
      />
      {suppliers.ok ? (
        <SupplierManager suppliers={suppliers.data} />
      ) : (
        <EmptyState title="Suppliers could not be loaded" description={suppliers.error.message} />
      )}
    </div>
  );
}
