"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { customerInputSchema } from "@/lib/validation/customers";
import type { CustomerDetailRow } from "@/lib/customers/data";
import { createCustomerAction, updateCustomerAction } from "./actions";

type CustomerFormValues = {
  name: string;
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  notes: string;
  isActive: boolean;
};

const emptyValues: CustomerFormValues = {
  name: "",
  phone: "",
  email: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "India",
  notes: "",
  isActive: true,
};

function valuesFrom(customer: CustomerDetailRow): CustomerFormValues {
  return {
    name: customer.name ?? "",
    phone: customer.phone_normalized ?? "",
    email: customer.email ?? "",
    addressLine1: customer.address_line1 ?? "",
    addressLine2: customer.address_line2 ?? "",
    city: customer.city ?? "",
    state: customer.state ?? "",
    postalCode: customer.postal_code ?? "",
    country: customer.country,
    notes: customer.notes ?? "",
    isActive: customer.is_active,
  };
}

/**
 * Create or edit a customer. The form validates with the same schema the server
 * action does, so the two cannot disagree about what is acceptable.
 *
 * `mode="edit"` needs the full `CustomerRow` (address and notes), so it is
 * offered from the detail page where that row is loaded; the list page only
 * offers create and archive.
 */
export function CustomerFormDialog({
  mode,
  customer,
}: {
  mode: "create" | "edit";
  customer?: CustomerDetailRow;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<CustomerFormValues>(emptyValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  function openDialog() {
    setValues(mode === "edit" && customer ? valuesFrom(customer) : emptyValues);
    setErrors({});
    setOpen(true);
  }

  function set<K extends keyof CustomerFormValues>(key: K, value: CustomerFormValues[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  function submit() {
    const parsed = customerInputSchema.safeParse(values);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }

    setErrors({});
    startTransition(async () => {
      const result =
        mode === "edit" && customer
          ? await updateCustomerAction(customer.id, parsed.data)
          : await createCustomerAction(parsed.data);

      if (result.ok) {
        toast(mode === "edit" ? "Customer saved" : "Customer created", "success");
        setOpen(false);
        router.refresh();
      } else {
        setErrors({ [result.field ?? "form"]: result.error });
        toast(result.error, "error");
      }
    });
  }

  const editing = mode === "edit";

  return (
    <>
      <Button variant={editing ? "outline" : "default"} onClick={openDialog}>
        {editing ? "Edit" : "New customer"}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title={editing ? "Edit customer" : "New customer"}
        description={
          editing
            ? "Changes apply to future orders. Orders already placed keep the name and phone they were placed with."
            : "Customers are usually created at checkout. Add one here for a phone order or a correction."
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Saving…" : editing ? "Save customer" : "Create customer"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {errors.form ? (
            <p role="alert" className="text-xs text-destructive">
              {errors.form}
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" htmlFor="customer-name" required error={errors.name}>
              <Input
                id="customer-name"
                value={values.name}
                onChange={(event) => set("name", event.target.value)}
                autoFocus
                aria-invalid={Boolean(errors.name)}
              />
            </FormField>

            <FormField
              label="Phone"
              htmlFor="customer-phone"
              required
              error={errors.phone}
              hint="Normalised to +91… and used to link orders."
            >
              <Input
                id="customer-phone"
                value={values.phone}
                onChange={(event) => set("phone", event.target.value)}
                inputMode="tel"
                aria-invalid={Boolean(errors.phone)}
              />
            </FormField>
          </div>

          <FormField label="Email" htmlFor="customer-email" error={errors.email}>
            <Input
              id="customer-email"
              type="email"
              value={values.email}
              onChange={(event) => set("email", event.target.value)}
              aria-invalid={Boolean(errors.email)}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Address line 1" htmlFor="customer-address1" error={errors.addressLine1}>
              <Input
                id="customer-address1"
                value={values.addressLine1}
                onChange={(event) => set("addressLine1", event.target.value)}
              />
            </FormField>
            <FormField label="Address line 2" htmlFor="customer-address2" error={errors.addressLine2}>
              <Input
                id="customer-address2"
                value={values.addressLine2}
                onChange={(event) => set("addressLine2", event.target.value)}
              />
            </FormField>
            <FormField label="City" htmlFor="customer-city" error={errors.city}>
              <Input
                id="customer-city"
                value={values.city}
                onChange={(event) => set("city", event.target.value)}
              />
            </FormField>
            <FormField label="State" htmlFor="customer-state" error={errors.state}>
              <Input
                id="customer-state"
                value={values.state}
                onChange={(event) => set("state", event.target.value)}
              />
            </FormField>
            <FormField label="Postal code" htmlFor="customer-postal" error={errors.postalCode}>
              <Input
                id="customer-postal"
                value={values.postalCode}
                onChange={(event) => set("postalCode", event.target.value)}
              />
            </FormField>
            <FormField label="Country" htmlFor="customer-country" error={errors.country}>
              <Input
                id="customer-country"
                value={values.country}
                onChange={(event) => set("country", event.target.value)}
              />
            </FormField>
          </div>

          <FormField label="Notes" htmlFor="customer-notes" error={errors.notes}>
            <Textarea
              id="customer-notes"
              value={values.notes}
              onChange={(event) => set("notes", event.target.value)}
              rows={3}
              placeholder="Optional"
            />
          </FormField>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={values.isActive}
              onChange={(event) => set("isActive", event.target.checked)}
            />
            Active — offered at the till and included in the customer list
          </label>
        </div>
      </Modal>
    </>
  );
}
