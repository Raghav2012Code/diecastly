import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SettingsForm } from "@/app/(admin)/admin/settings/settings-form";
import { getSettings } from "@/lib/orders/data";

export const metadata: Metadata = { title: "Settings" };

/**
 * Business settings.
 *
 * Replaces the Phase 6 placeholder with the real form. Every field maps to a
 * column with a matching database CHECK (see `lib/validation/settings.ts`), and
 * three of them change what a shopper sees immediately:
 *
 *   - `business_name` is the storefront's title and header
 *   - `default_shipping_fee` is the cart and checkout total
 *   - `cod_enabled` decides whether cash on delivery is offered at all
 *
 * so saving revalidates the storefront layout too, rather than waiting for a
 * deploy or an unrelated navigation.
 *
 * There is no tax setting, on purpose: the schema has no tax columns and no tax
 * is computed anywhere, so a field here would imply a money semantic that does not
 * exist yet (D60).
 */
export default async function SettingsPage() {
  const settings = await getSettings();

  // A missing settings row is not an error: the schema seeds one, and the
  // storefront's own read falls back if it is ever absent. Rendering a form
  // pre-filled with the column defaults keeps the page usable either way.
  const row = settings.ok ? settings.data : null;

  if (settings && !settings.ok) {
    return (
      <div className="space-y-6">
        <PageHeader title="Settings" />
        <EmptyState
          title="Settings could not be loaded"
          description="Something went wrong reaching the business settings. Please try again."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="What the shop is called, how you are paid, and how long orders are held."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <SettingsForm
          initial={{
            businessName: row?.business_name ?? "Diecastly",
            businessPhone: row?.business_phone ?? "",
            businessEmail: row?.business_email ?? "",
            upiId: row?.upi_id ?? "",
            upiQrPath: row?.upi_qr_path ?? "",
            orderPrefix: row?.order_prefix ?? "DC",
            defaultShippingFee: row?.default_shipping_fee ?? 0,
            lowStockThresholdDefault: row?.low_stock_threshold_default ?? 2,
            onlineOrderHoldHours: row?.online_order_hold_hours ?? 48,
            inPersonReversalWindowHours: row?.in_person_reversal_window_hours ?? 24,
            codEnabled: row?.cod_enabled ?? true,
          }}
        />

        <aside className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">What these change</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                <span className="text-foreground">Business name</span> appears in the shop&apos;s
                header and page title.
              </p>
              <p>
                <span className="text-foreground">Shipping fee</span> is added to every cart
                and checkout total.
              </p>
              <p>
                <span className="text-foreground">Cash on delivery</span> decides whether
                checkout offers it at all. The server re-checks this when an order is placed.
              </p>
              <p>
                <span className="text-foreground">Order hold</span> is how long an unpaid
                online order stays pending before you review it. Nothing cancels it
                automatically.
              </p>
              <p>
                <span className="text-foreground">Reversal window</span> is how long after an
                in-person sale it can still be reversed.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Order numbers</CardTitle>
              <CardDescription>How a new order is numbered.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="font-mono text-lg">
                {row?.order_prefix ?? "DC"}
                {new Date().getFullYear()}-{String(1).padStart(4, "0")}
              </p>
              <p className="text-muted-foreground">
                A preview only. Existing order numbers never change —{" "}
                <code className="text-xs">order_number</code> is snapshotted on the order.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Not here yet</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p className="flex items-center gap-2">
                <Badge tone="outline">Tax / GST</Badge>
                <span>undecided</span>
              </p>
              <p>
                The schema has no tax columns and nothing computes tax, so there is no field
                to bind one to. This is a money decision, not a UI one — see D60.
              </p>
              <Link
                href="/admin"
                className="inline-block text-sm underline underline-offset-4"
              >
                Back to the dashboard
              </Link>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
