import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MovementFilters } from "@/components/admin/movement-filters";
import { listMovements } from "@/lib/inventory/data";
import { movementSourceLabel, movementTypeLabel, movementTypeTone } from "@/lib/display";
import { formatDateTimeIST } from "@/lib/dates";
import type { MovementType } from "@/lib/types/database.types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Movements" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function Delta({ value }: { value: number }) {
  const positive = value > 0;
  return (
    <span className={cn("tnum font-medium", positive ? "text-success" : "text-foreground")}>
      {positive ? `+${value}` : value}
    </span>
  );
}

export default async function MovementsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const type = one(params.type) as MovementType | undefined;
  const source = one(params.source) as "admin" | "storefront" | "system" | undefined;
  const page = Number.parseInt(one(params.page) ?? "1", 10) || 1;
  const hasFilters = Boolean(type || source);

  const list = await listMovements({ movementType: type ?? null, source: source ?? null, page, pageSize: 25 });
  const rows = list.ok ? list.data.rows : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Movements"
        description="The append-only ledger. Every stock change lands here and can never be edited or erased."
      />

      <Tabs
        items={[
          { href: "/admin/inventory", label: "Stock", active: false },
          { href: "/admin/inventory/movements", label: "Movements", active: true },
        ]}
      />

      <MovementFilters current={{ type, source }} />

      {!list.ok ? (
        <EmptyState
          title="Movements could not be loaded"
          description={list.error.message}
          action={
            <Link href="/admin/inventory/movements" className={buttonVariants({ variant: "outline" })}>
              Try again
            </Link>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={hasFilters ? "No movements match these filters" : "No movements yet"}
          description={
            hasFilters
              ? "Try a different type or source, or clear the filters."
              : "Restock, sell or adjust a product and the ledger will fill in here."
          }
          action={
            <Link
              href={hasFilters ? "/admin/inventory/movements" : "/admin/inventory"}
              className={buttonVariants({ variant: "outline" })}
            >
              {hasFilters ? "Clear filters" : "Go to stock"}
            </Link>
          }
        />
      ) : (
        <>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">After</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTimeIST(row.created_at)}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{row.products?.name ?? "Deleted product"}</p>
                      <p className="font-mono text-xs text-muted-foreground">{row.products?.sku ?? "—"}</p>
                    </TableCell>
                    <TableCell>
                      <Badge tone={movementTypeTone[row.movement_type]}>
                        {movementTypeLabel[row.movement_type]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Delta value={row.delta} />
                    </TableCell>
                    <TableCell className="tnum text-right">{row.quantity_after}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {movementSourceLabel[row.source] ?? row.source}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {row.reference_id ? row.reference_id.slice(0, 8) : "—"}
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-muted-foreground" title={row.note ?? undefined}>
                      {row.note ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Pagination
            page={page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            basePath="/admin/inventory/movements"
            params={{ type, source }}
          />
        </>
      )}
    </div>
  );
}
