import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { listSellableProducts } from "@/lib/catalog/data";
import { getSettings } from "@/lib/orders/data";
import { businessSummary } from "@/lib/orders/receipt";
import { PosScreen } from "./pos-screen";

export const dynamic = "force-dynamic";
export const metadata = { title: "Record Sale" };

export default async function PosPage() {
  const [catalog, settings] = await Promise.all([listSellableProducts(), getSettings()]);
  const business = businessSummary(settings.ok ? settings.data : null);

  if (!catalog.ok) {
    return (
      <div className="space-y-5">
        <h1 className="font-display text-2xl font-bold tracking-tight">Record Sale</h1>
        <EmptyState
          title="The till could not load"
          description={catalog.error.message}
          action={
            <Link href="/admin/pos" className={buttonVariants({ variant: "outline" })}>
              Try again
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <PosScreen
      catalog={catalog.data.items}
      catalogTotal={catalog.data.total}
      catalogCapped={catalog.data.capped}
      business={business}
    />
  );
}
