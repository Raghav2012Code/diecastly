import Link from "next/link";
import { Star } from "lucide-react";
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
import { ProductFilters } from "@/components/admin/product-filters";
import { listBrands, listCategories, listProducts } from "@/lib/catalog/data";
import { lastPage, resolveListState } from "@/lib/list-state";
import {
  one,
  oneOf,
  oneOfWithAll,
  pageNumber,
  PRODUCT_SORT_VALUES,
  PRODUCT_STATUS_VALUES,
  PRODUCT_STOCK_VALUES,
} from "@/lib/list-params";
import { productStatusLabel, productStatusTone } from "@/lib/display";
import { formatINR } from "@/lib/validation/money";
import { ArchiveProductButton } from "./archive-product-button";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const search = one(params.search);
  const status = oneOfWithAll(params.status, PRODUCT_STATUS_VALUES);
  const category = one(params.category);
  const brand = one(params.brand);
  const stock = oneOf(params.stock, PRODUCT_STOCK_VALUES);
  const sort = oneOf(params.sort, PRODUCT_SORT_VALUES) ?? "newest";
  const page = pageNumber(params.page);

  const [list, categories, brands] = await Promise.all([
    listProducts({ search, status, categoryId: category, brand, stock, sort, page, pageSize: 20 }),
    listCategories(),
    listBrands(),
  ]);

  const rows = list.ok ? list.data.rows : [];
  const total = list.ok ? list.data.total : 0;
  const maxQuantity = Math.max(1, ...rows.map((row) => row.quantity));
  const hasFilters = Boolean(search || status !== "all" || category || brand || stock);

  // A page past the end must not fall into the "add your first product" branch:
  // that tells the admin a populated catalog is empty and invites a duplicate.
  const outOfRange =
    resolveListState({ ok: list.ok, rowCount: rows.length, total, page, pageSize: 20, hasFilters }) ===
    "out-of-range";
  const lastPageHref = (() => {
    const query = new URLSearchParams();
    if (search) query.set("search", search);
    if (status !== "all") query.set("status", status);
    if (category) query.set("category", category);
    if (brand) query.set("brand", brand);
    if (stock) query.set("stock", stock);
    if (sort !== "newest") query.set("sort", sort);
    const target = lastPage(total, 20);
    if (target > 1) query.set("page", String(target));
    const qs = query.toString();
    return qs ? `/admin/products?${qs}` : "/admin/products";
  })();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Everything you own, with cost, price and live stock."
        actions={
          <Link href="/admin/products/new" className={buttonVariants()}>
            Add product
          </Link>
        }
      />

      <Tabs
        items={[
          { href: "/admin/products", label: "Products", active: true },
          { href: "/admin/products/categories", label: "Categories", active: false },
          { href: "/admin/products/suppliers", label: "Suppliers", active: false },
        ]}
      />

      <ProductFilters
        categories={categories.ok ? categories.data.map((c) => ({ id: c.id, name: c.name })) : []}
        brands={brands.ok ? brands.data : []}
        current={{ search, status, category, brand, stock, sort }}
      />

      {!list.ok ? (
        <EmptyState
          title="Products could not be loaded"
          description={list.error.message}
          action={
            <Link href="/admin/products" className={buttonVariants({ variant: "outline" })}>
              Try again
            </Link>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={
            outOfRange
              ? "That page is past the end"
              : hasFilters
                ? "No products match these filters"
                : "Add your first product"
          }
          description={
            outOfRange
              ? `There ${total === 1 ? "is 1 product" : `are ${total} products`} in total, which do not reach page ${page}.`
              : hasFilters
                ? "Try a different search, or clear the filters to see the whole catalog."
                : "Create a product to list it for sale, then set its opening stock."
          }
          action={
            outOfRange ? (
              <Link href={lastPageHref} className={buttonVariants()}>
                Go to page {lastPage(total, 20)}
              </Link>
            ) : hasFilters ? (
              <Link href="/admin/products" className={buttonVariants({ variant: "outline" })}>
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
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="w-40">Stock</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const tone = stockTone(row.quantity, row.low_stock_threshold);
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <ProductThumb path={row.primary_image_path} name={row.name} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <Link
                                href={`/admin/products/${row.id}`}
                                className="truncate font-medium hover:text-primary hover:underline"
                              >
                                {row.name}
                              </Link>
                              {row.is_featured ? (
                                <Star aria-label="Featured" className="h-3.5 w-3.5 shrink-0 fill-primary text-primary" />
                              ) : null}
                            </div>
                            <p className="truncate text-xs text-muted-foreground">
                              {[row.brand, row.series, row.model].filter(Boolean).join(", ") || "No brand or series yet"}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.sku ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.category_name ?? "—"}</TableCell>
                      <TableCell className="tnum text-right">{formatINR(row.selling_price)}</TableCell>
                      <TableCell className="tnum text-right text-muted-foreground">
                        {formatINR(row.purchase_cost)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="tnum w-8 text-right font-display text-base font-bold">
                            {row.quantity}
                          </span>
                          <StockBar quantity={row.quantity} max={maxQuantity} tone={tone} className="w-20" />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge tone={productStatusTone[row.status]} dot>
                          {productStatusLabel[row.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={`/admin/products/${row.id}`}
                            className={buttonVariants({ variant: "outline", size: "sm" })}
                          >
                            Edit
                          </Link>
                          <ArchiveProductButton
                            productId={row.id}
                            productName={row.name}
                            status={row.status}
                          />
                        </div>
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
            total={total}
            basePath="/admin/products"
            params={{ search, status: status === "all" ? undefined : status, category, brand, stock, sort }}
          />
        </>
      )}

      {/* Pagination also renders when the page has no rows. The control already
          clamps to the last valid page; hiding it on the empty path removed the
          only way back from a page that no longer exists. */}
      {rows.length === 0 && total > 0 ? (
        <Pagination
          page={page}
          pageSize={20}
          total={total}
          basePath="/admin/products"
          params={{ search, status: status === "all" ? undefined : status, category, brand, stock, sort }}
        />
      ) : null}
    </div>
  );
}
