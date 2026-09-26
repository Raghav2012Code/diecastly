"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/toast";
import { saveSettingsAction } from "@/app/(admin)/admin/settings/actions";
import type { SettingsInput } from "@/lib/validation/settings";

/**
 * The settings form.
 *
 * A plain form plus `useActionState`, so validation errors arrive from the server
 * action with the same mapping as every other form in the admin rather than being
 * reimplemented here. The field error is shown inline on the field it belongs to.
 *
 * No optimistic UI: the button disables while saving and the toast reports what
 * actually happened. A settings form that says "saved" before the database agrees
 * is how a seller ends up quoting the wrong shipping fee.
 */
export function SettingsForm({ initial }: { initial: SettingsInput }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<{ message: string; field?: string } | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => {
      const raw = form.get(name);
      return typeof raw === "string" ? raw : "";
    };

    setError(null);
    startTransition(async () => {
      const result = await saveSettingsAction({
        businessName: value("businessName"),
        businessPhone: value("businessPhone"),
        businessEmail: value("businessEmail"),
        upiId: value("upiId"),
        upiQrPath: value("upiQrPath"),
        orderPrefix: value("orderPrefix"),
        defaultShippingFee: value("defaultShippingFee"),
        lowStockThresholdDefault: value("lowStockThresholdDefault"),
        onlineOrderHoldHours: value("onlineOrderHoldHours"),
        inPersonReversalWindowHours: value("inPersonReversalWindowHours"),
        codEnabled: form.get("codEnabled") === "on",
      });

      if (!result.ok) {
        setError({ message: result.error, field: result.field });
        toast(result.error, "error");
        return;
      }

      toast("Settings saved.", "success");
      router.refresh();
    });
  }

  const fieldError = (name: string) =>
    error && error.field === name ? error.message : null;

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Business</CardTitle>
          <CardDescription>What the shop is called and how customers reach you.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <FormField
            label="Business name"
            htmlFor="businessName"
            required
            error={fieldError("businessName")}
          >
            <Input id="businessName" name="businessName" defaultValue={initial.businessName} required />
          </FormField>
          <FormField label="Phone" htmlFor="businessPhone" error={fieldError("businessPhone")}>
            <Input
              id="businessPhone"
              name="businessPhone"
              type="tel"
              defaultValue={initial.businessPhone ?? ""}
            />
          </FormField>
          <FormField
            label="Email"
            htmlFor="businessEmail"
            error={fieldError("businessEmail")}
            hint="Optional. Shown on the storefront footer."
          >
            <Input
              id="businessEmail"
              name="businessEmail"
              type="email"
              defaultValue={initial.businessEmail ?? ""}
            />
          </FormField>
          <FormField
            label="Order prefix"
            htmlFor="orderPrefix"
            required
            error={fieldError("orderPrefix")}
            hint="Uppercased automatically. New orders only."
          >
            <Input
              id="orderPrefix"
              name="orderPrefix"
              defaultValue={initial.orderPrefix}
              maxLength={12}
              required
            />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Payments</CardTitle>
          <CardDescription>
            How customers pay, and whether cash on delivery is offered.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <FormField
            label="UPI ID"
            htmlFor="upiId"
            error={fieldError("upiId")}
            hint="Shown on the order confirmation page."
          >
            <Input id="upiId" name="upiId" defaultValue={initial.upiId ?? ""} />
          </FormField>
          <FormField
            label="UPI QR storage path"
            htmlFor="upiQrPath"
            error={fieldError("upiQrPath")}
            hint="Optional. Path in the product-images bucket."
          >
            <Input id="upiQrPath" name="upiQrPath" defaultValue={initial.upiQrPath ?? ""} />
          </FormField>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox name="codEnabled" defaultChecked={initial.codEnabled} />
            Offer cash on delivery at checkout
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Stock and orders</CardTitle>
          <CardDescription>
            Defaults applied to new products, and the two order windows.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <FormField
            label="Default shipping fee"
            htmlFor="defaultShippingFee"
            error={fieldError("defaultShippingFee")}
            hint="Added to every cart and checkout total."
          >
            <Input
              id="defaultShippingFee"
              name="defaultShippingFee"
              type="number"
              min={0}
              step="0.01"
              defaultValue={initial.defaultShippingFee}
            />
          </FormField>
          <FormField
            label="Default low-stock threshold"
            htmlFor="lowStockThresholdDefault"
            error={fieldError("lowStockThresholdDefault")}
            hint="Pre-filled on new products. Each product can override it."
          >
            <Input
              id="lowStockThresholdDefault"
              name="lowStockThresholdDefault"
              type="number"
              min={0}
              step={1}
              defaultValue={initial.lowStockThresholdDefault}
            />
          </FormField>
          <FormField
            label="Online order hold (hours)"
            htmlFor="onlineOrderHoldHours"
            error={fieldError("onlineOrderHoldHours")}
            hint="How long an unpaid order stays pending. Nothing cancels it automatically."
          >
            <Input
              id="onlineOrderHoldHours"
              name="onlineOrderHoldHours"
              type="number"
              min={1}
              step={1}
              defaultValue={initial.onlineOrderHoldHours}
            />
          </FormField>
          <FormField
            label="In-person reversal window (hours)"
            htmlFor="inPersonReversalWindowHours"
            error={fieldError("inPersonReversalWindowHours")}
            hint="How long after an in-person sale it can still be reversed."
          >
            <Input
              id="inPersonReversalWindowHours"
              name="inPersonReversalWindowHours"
              type="number"
              min={1}
              step={1}
              defaultValue={initial.inPersonReversalWindowHours}
            />
          </FormField>
        </CardContent>
      </Card>

      {error && !error.field ? (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
        {pending ? <span className="text-sm text-muted-foreground">Saving…</span> : null}
      </div>
    </form>
  );
}
