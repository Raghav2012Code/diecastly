import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StockBar, stockTone } from "@/components/admin/stock-bar";
import { ProductThumb } from "@/components/admin/product-thumb";
import { InventoryFilters } from "@/components/admin/inventory-filters";
import {
  listInitializedProductIds,
  listInventory,
  listInventoryCategoryOptions,
  listInventorySupplierOptions,
  type InventoryScope,
  type InventorySort,
} from "@/lib/inventory/data";
import { productStatusLabel, productStatusTone } from "@/lib/display";
import { formatINR, multiplyMoney } from "@/lib/validation/money";
import { ThresholdEditor } from "./threshold-editor";
import { StockActions } from "./stock-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inventory" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export default async function InventoryPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const search = one(params.search);
  const scope = (one(params.scope) ?? "all") as InventoryScope;
  const category = one(params.category);
  const supplier = one(params.supplier);
  const sort = (one(params.sort) ?? "name") as InventorySort;
  const page = Number.parseInt(one(params.page) ?? "1", 10) || 1;

  const [list, categories, suppliers] = await Promise.all([
    listInventory({ search, scope, categoryId: category, supplierId: supplier, sort, page, pageSize: 20 }),
    listInventoryCategoryOptions(),
    listInventorySupplierOptions(),
  ]);

  const rows = list.ok ? list.data.rows : [];
  const maxQuantity = Math.max(1, ...rows.map((row) => row.quantity));
  const hasFilters = Boolean(search || scope !== "all" || category || supplier);

  let initialized = new Set<string>();
  if (rows.length > 0) {
    const ids = await listInitializedProductIds(rows.map((row) => row.product_id));
    if (ids.ok) initialized = new Set(ids.data);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Current stock and what it is worth. Every change is written to the ledger."
        actions={
          <Link href="/admin/products/new" className={buttonVariants()}>
            Add product
          </Link>
        }
      />

      <Tabs
        items={[
          { href: "/admin/inventory", label: "Stock", active: true },
          { href: "/admin/inventory/movements", label: "Movements", active: false },
        ]}
      />

      <InventoryFilters
        categories={categories.ok ? categories.data : []}
        suppliers={suppliers.ok ? suppliers.data : []}
        current={{ search, scope, category, supplier, sort }}
      />

      {!list.ok ? (
        <EmptyState
          title="Inventory could not be loaded"
          description={list.error.message}
          action={
            <Link href="/admin/inventory" className={buttonVariants({ variant: "outline" })}>
              Try again
            </Link>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={hasFilters ? "No products match these filters" : "No products yet"}
          description={
            hasFilters
              ? "Try a different search, or clear the filters to see all stock."
              : "Add a product first, then record its opening stock here."
          }
          action={
            hasFilters ? (
              <Link href="/admin/inventory" className={buttonVariants({ variant: "outline" })}>
                Clear filters
              </Link>
            ) : (
              <Link href="/admin/products/new" className={buttonVariants()}>
                Add product
              </Link>
            )
          }
        />
      ) : (
        <>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="w-40">In stock</TableHead>
                  <TableHead className="text-right">Threshold</TableHead>
                  <TableHead className="text-right">Stock value</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const tone = stockTone(row.quantity, row.low_stock_threshold);
                  return (
                    <TableRow key={row.product_id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <ProductThumb path={row.primary_image_path} name={row.name} />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{row.name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {row.brand ?? "No brand"}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.sku ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="tnum w-8 text-right font-display text-base font-bold">
                            {row.quantity}
                          </span>
                          <StockBar quantity={row.quantity} max={maxQuantity} tone={tone} className="w-20" />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <ThresholdEditor productId={row.product_id} value={row.low_stock_threshold} />
                      </TableCell>
                      <TableCell className="tnum text-right">
                        {formatINR(multiplyMoney(row.quantity, row.purchase_cost))}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.supplier_name ?? "—"}</TableCell>
                      <TableCell>
                        <Badge tone={productStatusTone[row.status]} dot>
                          {productStatusLabel[row.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <StockActions
                          productId={row.product_id}
                          productName={row.name}
                          currentQuantity={row.quantity}
                          currentCost={row.purchase_cost}
                          hasInitialStock={initialized.has(row.product_id)}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          <Pagination
            page={page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            basePath="/admin/inventory"
            params={{
              search,
              scope: scope === "all" ? undefined : scope,
              category,
              supplier,
              sort: sort === "name" ? undefined : sort,
            }}
          />
        </>
      )}
    </div>
  );
}
