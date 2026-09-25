"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { supplierInputSchema } from "@/lib/validation/catalog";
import type { SupplierRow } from "@/lib/types/database.types";
import { createSupplierAction, updateSupplierAction } from "../actions";

type FormValues = {
  name: string;
  contactName: string;
  phone: string;
  email: string;
  notes: string;
  isActive: boolean;
};

const emptyValues: FormValues = {
  name: "",
  contactName: "",
  phone: "",
  email: "",
  notes: "",
  isActive: true,
};

function valuesFrom(supplier: SupplierRow): FormValues {
  return {
    name: supplier.name,
    contactName: supplier.contact_name ?? "",
    phone: supplier.phone ?? "",
    email: supplier.email ?? "",
    notes: supplier.notes ?? "",
    isActive: supplier.is_active,
  };
}

export function SupplierManager({ suppliers }: { suppliers: SupplierRow[] }) {
  const [createValues, setCreateValues] = useState<FormValues>(emptyValues);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<SupplierRow | null>(null);
  const [editValues, setEditValues] = useState<FormValues>(emptyValues);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  function validate(values: FormValues) {
    const parsed = supplierInputSchema.safeParse(values);
    if (parsed.success) return { data: parsed.data, errors: {} as Record<string, string> };
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!errors[key]) errors[key] = issue.message;
    }
    return { data: null, errors };
  }

  function create() {
    const { data, errors } = validate(createValues);
    setCreateErrors(errors);
    if (!data) return;
    setBusy(true);
    startTransition(async () => {
      const result = await createSupplierAction(data);
      setBusy(false);
      if (result.ok) {
        toast("Supplier created", "success");
        setCreateValues(emptyValues);
        router.refresh();
      } else {
        setCreateErrors({ [result.field ?? "form"]: result.error });
        toast(result.error, "error");
      }
    });
  }

  function openEdit(supplier: SupplierRow) {
    setEditing(supplier);
    setEditValues(valuesFrom(supplier));
    setEditErrors({});
  }

  function saveEdit() {
    if (!editing) return;
    const { data, errors } = validate(editValues);
    setEditErrors(errors);
    if (!data) return;
    setBusy(true);
    startTransition(async () => {
      const result = await updateSupplierAction(editing.id, data);
      setBusy(false);
      if (result.ok) {
        toast("Supplier saved", "success");
        setEditing(null);
        router.refresh();
      } else {
        setEditErrors({ [result.field ?? "form"]: result.error });
        toast(result.error, "error");
      }
    });
  }

  function toggleActive(supplier: SupplierRow) {
    const data = { ...valuesFrom(supplier), isActive: !supplier.is_active };
    startTransition(async () => {
      const result = await updateSupplierAction(supplier.id, data);
      if (result.ok) {
        toast(supplier.is_active ? "Supplier deactivated" : "Supplier activated", "success");
        router.refresh();
      } else {
        toast(result.error, "error");
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>New supplier</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Name" htmlFor="supplier-name" required error={createErrors.name}>
              <Input
                id="supplier-name"
                value={createValues.name}
                onChange={(event) => setCreateValues((v) => ({ ...v, name: event.target.value }))}
                placeholder="Toy Co"
              />
            </FormField>
            <FormField label="Contact" htmlFor="supplier-contact" error={createErrors.contactName}>
              <Input
                id="supplier-contact"
                value={createValues.contactName}
                onChange={(event) => setCreateValues((v) => ({ ...v, contactName: event.target.value }))}
                placeholder="Person to call"
              />
            </FormField>
            <FormField label="Phone" htmlFor="supplier-phone" error={createErrors.phone}>
              <Input
                id="supplier-phone"
                value={createValues.phone}
                onChange={(event) => setCreateValues((v) => ({ ...v, phone: event.target.value }))}
                placeholder="+91 90000 00000"
              />
            </FormField>
            <FormField label="Email" htmlFor="supplier-email" error={createErrors.email}>
              <Input
                id="supplier-email"
                type="email"
                value={createValues.email}
                onChange={(event) => setCreateValues((v) => ({ ...v, email: event.target.value }))}
                placeholder="orders@toy.co"
              />
            </FormField>
            <FormField label="Notes" htmlFor="supplier-notes" error={createErrors.notes} className="sm:col-span-2 lg:col-span-4">
              <Textarea
                id="supplier-notes"
                value={createValues.notes}
                onChange={(event) => setCreateValues((v) => ({ ...v, notes: event.target.value }))}
                placeholder="Lead times, minimum order, payment terms."
              />
            </FormField>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox
                checked={createValues.isActive}
                onChange={(event) => setCreateValues((v) => ({ ...v, isActive: event.target.checked }))}
              />
              Active
            </label>
            <Button onClick={create} disabled={busy}>
              {busy ? "Saving…" : "Create supplier"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        {suppliers.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No suppliers yet. Add one to trace where stock comes from.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((supplier) => (
                <TableRow key={supplier.id}>
                  <TableCell className="font-medium">{supplier.name}</TableCell>
                  <TableCell className="text-muted-foreground">{supplier.contact_name ?? "—"}</TableCell>
                  <TableCell className="tnum text-muted-foreground">{supplier.phone ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{supplier.email ?? "—"}</TableCell>
                  <TableCell>
                    <Badge tone={supplier.is_active ? "success" : "outline"} dot>
                      {supplier.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="outline" size="sm" onClick={() => openEdit(supplier)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => toggleActive(supplier)}>
                        {supplier.is_active ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Edit supplier"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Name" htmlFor="edit-supplier-name" required error={editErrors.name}>
            <Input
              id="edit-supplier-name"
              value={editValues.name}
              onChange={(event) => setEditValues((v) => ({ ...v, name: event.target.value }))}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Contact" htmlFor="edit-supplier-contact" error={editErrors.contactName}>
              <Input
                id="edit-supplier-contact"
                value={editValues.contactName}
                onChange={(event) => setEditValues((v) => ({ ...v, contactName: event.target.value }))}
              />
            </FormField>
            <FormField label="Phone" htmlFor="edit-supplier-phone" error={editErrors.phone}>
              <Input
                id="edit-supplier-phone"
                value={editValues.phone}
                onChange={(event) => setEditValues((v) => ({ ...v, phone: event.target.value }))}
              />
            </FormField>
          </div>
          <FormField label="Email" htmlFor="edit-supplier-email" error={editErrors.email}>
            <Input
              id="edit-supplier-email"
              type="email"
              value={editValues.email}
              onChange={(event) => setEditValues((v) => ({ ...v, email: event.target.value }))}
            />
          </FormField>
          <FormField label="Notes" htmlFor="edit-supplier-notes" error={editErrors.notes}>
            <Textarea
              id="edit-supplier-notes"
              value={editValues.notes}
              onChange={(event) => setEditValues((v) => ({ ...v, notes: event.target.value }))}
            />
          </FormField>
          <label className="flex items-center gap-2.5 text-sm">
            <Checkbox
              checked={editValues.isActive}
              onChange={(event) => setEditValues((v) => ({ ...v, isActive: event.target.checked }))}
            />
            Active
          </label>
        </div>
      </Modal>
    </div>
  );
}
