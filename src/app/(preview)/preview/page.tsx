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
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Frontend preview" };

type SearchParams = Promise<{ screen?: string; order?: string }>;

const SCREENS = [
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
          {screen === "pos" ? (
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
