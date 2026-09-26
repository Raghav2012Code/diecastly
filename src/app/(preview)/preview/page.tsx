import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ToastProvider } from "@/components/ui/toast";
import { OrderFilters } from "@/components/admin/order-filters";
import { OrdersTable } from "@/components/admin/orders-table";
import { OrderDetailView } from "@/components/admin/order-detail-view";
import { OrderReceipt } from "@/components/admin/order-receipt";
import { PosScreen } from "@/app/(admin)/admin/pos/pos-screen";
import { PaymentDialogs } from "@/app/(admin)/admin/orders/[id]/payment-dialogs";
import { receiptFromOrder } from "@/lib/orders/receipt";
import {
  sampleBusiness,
  sampleCatalog,
  sampleInPersonDetail,
  sampleOnlineDetail,
  sampleSettings,
  sampleSummaries,
} from "@/lib/preview/sample";
import { AdminNav } from "@/app/(admin)/admin/nav";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Frontend preview" };

type SearchParams = Promise<{ screen?: string; order?: string }>;

const SCREENS = [
  { key: "admin", label: "Admin shell" },
  { key: "pos", label: "Record Sale" },
  { key: "orders", label: "Orders" },
  { key: "order", label: "Order detail" },
  { key: "receipt", label: "Receipt" },
] as const;

function NavLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-8 items-center rounded-md border px-3 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-card hover:bg-secondary",
      )}
    >
      {children}
    </Link>
  );
}

export default async function PreviewPage({ searchParams }: { searchParams: SearchParams }) {
  if (process.env.NODE_ENV === "production") notFound();

  const { screen = "pos", order = "inperson" } = await searchParams;
  const online = order === "online";
  const detail = online ? sampleOnlineDetail : sampleInPersonDetail;
  const receipt = receiptFromOrder({
    order: detail.order,
    items: detail.items,
    payments: detail.payments,
    business: sampleSettings,
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/70 px-4 py-3">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-primary font-display text-base font-extrabold text-primary-foreground">
              D
            </span>
            <div className="leading-none">
              <p className="font-display text-lg font-extrabold tracking-tight">Frontend preview</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Sample data · no database, writes disabled
              </p>
            </div>
          </div>
          <nav aria-label="Preview screens" className="flex flex-wrap items-center gap-1.5">
            {SCREENS.map((item) => (
              <NavLink
                key={item.key}
                href={`/preview?screen=${item.key}${item.key === "order" || item.key === "receipt" ? `&order=${order}` : ""}`}
                active={screen === item.key}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>

      <ToastProvider>
        <div className="mx-auto max-w-[1400px] px-4 py-6">
          {screen === "admin" ? (
            <div className="overflow-hidden rounded-lg border border-border">
              <p className="border-b border-border bg-secondary/40 px-4 py-2 text-xs text-muted-foreground">
                The real admin layout chrome. Resize below 768px: the sidebar is
                display:none and the bar below the header takes over. The count below
                is the worst case, <strong>9</strong>.
              </p>
              <div className="flex min-h-[26rem]">
                <aside className="hidden w-60 shrink-0 flex-col bg-petrol print:hidden md:flex">
                  <div className="flex items-center gap-2.5 px-5 py-5">
                    <span className="grid h-8 w-8 place-items-center rounded-md bg-primary font-display text-base font-extrabold text-primary-foreground">
                      D
                    </span>
                    <div className="leading-none">
                      <p className="font-display text-xl font-extrabold tracking-tight text-petrol-foreground">
                        DIECASTLY
                      </p>
                      <p className="mt-1 text-[11px] text-petrol-foreground/60">Business desk</p>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
                    <AdminNav lowStockCount={9} />
                  </div>
                  <p className="px-5 py-4 text-[11px] text-petrol-foreground/45">
                    Stock moves only through the ledger.
                  </p>
                </aside>
                <div className="flex min-w-0 flex-1 flex-col">
                  <header className="flex items-center justify-between gap-4 border-b border-border bg-card/70 px-4 py-2.5 print:hidden md:px-6">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-petrol text-xs font-semibold text-petrol-foreground md:hidden">
                        D
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">Signed in</p>
                        <p className="truncate text-xs text-muted-foreground">owner@example.test</p>
                      </div>
                    </div>
                  </header>
                  <div className="border-b border-border bg-petrol px-3 py-2 print:hidden md:hidden">
                    <AdminNav orientation="bar" lowStockCount={9} />
                  </div>

                  <main className="min-w-0 flex-1 px-4 py-6 print:p-0 md:px-6">
                    <h1 className="font-display text-2xl font-bold tracking-tight">
                      Section content
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Placeholder. This screen exists to measure the navigation, not the page.
                    </p>
                  </main>
                </div>
              </div>
            </div>
          ) : screen === "pos" ? (
            <PosScreen
              catalog={sampleCatalog}
              catalogTotal={sampleCatalog.length}
              catalogCapped={false}
              business={sampleBusiness}
            />
          ) : screen === "orders" ? (
            <div className="space-y-6">
              <h1 className="font-display text-3xl font-bold tracking-tight">Orders</h1>
              <OrderFilters current={{}} />
              <OrdersTable rows={sampleSummaries} />
            </div>
          ) : screen === "order" ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">Sample:</span>
                <NavLink href="/preview?screen=order&order=inperson" active={!online}>
                  In-person order
                </NavLink>
                <NavLink href="/preview?screen=order&order=online" active={online}>
                  Online order
                </NavLink>
              </div>
              <OrderDetailView
                detail={detail}
                actions={
                  <>
                    <Button variant="outline">Print receipt</Button>
                    <PaymentDialogs
                      orderId={detail.order.id}
                      balance={detail.financials.balance}
                      netPaid={detail.financials.net_paid}
                      defaultMethod={detail.order.payment_method ?? "cash"}
                    />
                  </>
                }
              />
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[23rem] space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <NavLink href="/preview?screen=receipt&order=inperson" active={!online}>
                  In-person
                </NavLink>
                <NavLink href="/preview?screen=receipt&order=online" active={online}>
                  Online
                </NavLink>
              </div>
              <OrderReceipt receipt={receipt} />
            </div>
          )}
        </div>
      </ToastProvider>
    </div>
  );
}
