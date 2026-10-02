import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { listCustomers } from "@/lib/customers/data";
import { CustomerFormDialog } from "./customer-form-dialog";
import { one, pageNumber } from "@/lib/list-params";
import { lastPage, resolveListState } from "@/lib/list-state";
import { formatDateTimeIST } from "@/lib/dates";
import { formatINR } from "@/lib/validation/money";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The customer list.
 *
 * Customers are the admin metadata lane: `customers_admin_all` permits direct
 * writes, exactly as it does for products and suppliers, so create is offered
 * here and edit on the detail page. The storefront still only ever LINKS to a
 * customer record (D51) — nothing in the anonymous path modifies one.
 *
 * Archived customers are hidden unless `includeArchived` is set, mirroring the
 * supplier list, and are additionally withheld from the till's picker so a
 * retired record cannot be silently resurrected by a new sale.
 *
 * `total_spent` comes from `v_customer_summary`, which excludes cancelled and
 * returned orders. That exclusion is the whole reason the view exists rather
 * than a count computed here.
 */
export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const search = one(params.search)?.trim().slice(0, 120) || undefined;
  const page = pageNumber(params.page);
  const includeArchived = one(params.archived) === "1";

  const list = await listCustomers({ search, page, includeArchived });
  const hasFilters = Boolean(search);

  if (!list.ok) {
    return (
      <div className="space-y-6">
        <PageHeader title="Customers" description="Everyone who has ordered from the shop." />
        <EmptyState
          title="Customers could not be loaded"
          description="Something went wrong reaching the customer list. Please try again."
        />
      </div>
    );
  }

  const { rows, total, pageSize } = list.data;
  const pages = lastPage(total, pageSize);
  const state = resolveListState({ ok: true, rowCount: rows.length, total, page, pageSize, hasFilters });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description={
          total === 0
            ? "No customers yet."
            : `${total} customer${total === 1 ? "" : "s"}, most recently active first.`
        }
        actions={
          <CustomerFormDialog
            mode="create"
            key={includeArchived ? "archived" : "active"}
          />
        }
      />

      <form method="get" className="flex items-end gap-2">
        <div className="min-w-56 flex-1">
          <label htmlFor="customer-search" className="sr-only">
            Search customers
          </label>
          <Input
            id="customer-search"
            name="search"
            type="search"
            defaultValue={search ?? ""}
            placeholder="Search name, phone or email"
          />
        </div>
        <Button type="submit">
          Search
        </Button>
        {search ? (
          <Link
            href="/admin/customers"
            className="inline-flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-secondary"
          >
            Clear
          </Link>
        ) : null}
      </form>

      {includeArchived ? (
        <p className="text-sm text-muted-foreground">
          Showing archived customers too.{" "}
          <Link
            href={search ? `/admin/customers?search=${encodeURIComponent(search)}` : "/admin/customers"}
            className="underline underline-offset-4"
          >
            Hide archived
          </Link>
        </p>
      ) : null}

      {state === "out-of-range" ? (
        <EmptyState
          title="That page is past the end"
          description={`There are ${total} customer${total === 1 ? "" : "s"} in total.`}
          action={
            <Link href="/admin/customers" className="text-sm underline underline-offset-4">
              Back to the first page
            </Link>
          }
        />
      ) : state === "no-matches" ? (
        <EmptyState
          title="No customers matched"
          description="Try a different search term."
          action={
            <Link href="/admin/customers" className="text-sm underline underline-offset-4">
              Clear the search
            </Link>
          }
        />
      ) : state === "empty" ? (
        <EmptyState
          title="No customers yet"
          description="Customers appear here as soon as an order is placed, online or in person."
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Customer</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Lifetime spend</TableHead>
                <TableHead>Last order</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.customer_id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/admin/customers/${row.customer_id}`}
                      className="underline underline-offset-4"
                    >
                      {row.name || "(no name)"}
                    </Link>
                    {row.orders_count === 0 ? (
                      <Badge tone="outline" className="ml-2">
                        no orders
                      </Badge>
                    ) : null}
                    {row.is_active ? null : (
                      <Badge tone="outline" className="ml-2">
                        archived
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.phone_normalized}</TableCell>
                  <TableCell className="text-muted-foreground">{row.email ?? "—"}</TableCell>
                  <TableCell className="tnum text-right">{row.orders_count}</TableCell>
                  <TableCell className="tnum text-right font-medium">
                    {formatINR(row.total_spent)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {row.last_order_at ? formatDateTimeIST(row.last_order_at) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {pages > 1 && state === "rows" ? (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          basePath="/admin/customers"
          params={{ search }}
        />
      ) : null}
    </div>
  );
}
