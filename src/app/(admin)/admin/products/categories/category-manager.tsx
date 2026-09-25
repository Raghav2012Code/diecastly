"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { categoryInputSchema } from "@/lib/validation/catalog";
import type { CategoryRow } from "@/lib/types/database.types";
import { createCategoryAction, updateCategoryAction } from "../actions";

type FormValues = {
  name: string;
  slug: string;
  parentId: string;
  sortOrder: string;
  isActive: boolean;
};

const emptyValues: FormValues = { name: "", slug: "", parentId: "", sortOrder: "0", isActive: true };

function valuesFrom(category: CategoryRow): FormValues {
  return {
    name: category.name,
    slug: category.slug,
    parentId: category.parent_id ?? "",
    sortOrder: String(category.sort_order),
    isActive: category.is_active,
  };
}

function payload(values: FormValues) {
  return {
    name: values.name,
    slug: values.slug,
    parentId: values.parentId,
    sortOrder: values.sortOrder.trim() === "" ? 0 : Number(values.sortOrder),
    isActive: values.isActive,
  };
}

export function CategoryManager({ categories }: { categories: CategoryRow[] }) {
  const [createValues, setCreateValues] = useState<FormValues>(emptyValues);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [editValues, setEditValues] = useState<FormValues>(emptyValues);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const parentOptions = (excludeId?: string) => categories.filter((category) => category.id !== excludeId);

  function validate(values: FormValues) {
    const parsed = categoryInputSchema.safeParse(payload(values));
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
      const result = await createCategoryAction(data);
      setBusy(false);
      if (result.ok) {
        toast("Category created", "success");
        setCreateValues(emptyValues);
        router.refresh();
      } else {
        setCreateErrors({ [result.field ?? "form"]: result.error });
        toast(result.error, "error");
      }
    });
  }

  function openEdit(category: CategoryRow) {
    setEditing(category);
    setEditValues(valuesFrom(category));
    setEditErrors({});
  }

  function saveEdit() {
    if (!editing) return;
    const { data, errors } = validate(editValues);
    setEditErrors(errors);
    if (!data) return;
    setBusy(true);
    startTransition(async () => {
      const result = await updateCategoryAction(editing.id, data);
      setBusy(false);
      if (result.ok) {
        toast("Category saved", "success");
        setEditing(null);
        router.refresh();
      } else {
        setEditErrors({ [result.field ?? "form"]: result.error });
        toast(result.error, "error");
      }
    });
  }

  function toggleActive(category: CategoryRow) {
    const data = {
      name: category.name,
      slug: category.slug,
      parentId: category.parent_id ?? "",
      sortOrder: category.sort_order,
      isActive: !category.is_active,
    };
    startTransition(async () => {
      const result = await updateCategoryAction(category.id, data);
      if (result.ok) {
        toast(category.is_active ? "Category deactivated" : "Category activated", "success");
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
          <CardTitle>New category</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Name" htmlFor="category-name" required error={createErrors.name}>
              <Input
                id="category-name"
                value={createValues.name}
                onChange={(event) => setCreateValues((v) => ({ ...v, name: event.target.value }))}
                placeholder="JDM"
              />
            </FormField>
            <FormField label="Slug" htmlFor="category-slug" error={createErrors.slug} hint="Blank generates from name.">
              <Input
                id="category-slug"
                value={createValues.slug}
                onChange={(event) => setCreateValues((v) => ({ ...v, slug: event.target.value }))}
                placeholder="jdm"
                className="font-mono"
              />
            </FormField>
            <FormField label="Parent" htmlFor="category-parent" error={createErrors.parentId}>
              <Select
                id="category-parent"
                value={createValues.parentId}
                onChange={(event) => setCreateValues((v) => ({ ...v, parentId: event.target.value }))}
              >
                <option value="">No parent</option>
                {parentOptions().map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Sort order" htmlFor="category-sort" error={createErrors.sortOrder}>
              <Input
                id="category-sort"
                type="number"
                min="0"
                step="1"
                value={createValues.sortOrder}
                onChange={(event) => setCreateValues((v) => ({ ...v, sortOrder: event.target.value }))}
                className="tnum"
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
              {busy ? "Saving…" : "Create category"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        {categories.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No categories yet. Create one to organise the catalog.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Parent</TableHead>
                <TableHead className="text-right">Sort</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((category) => {
                const parent = categories.find((candidate) => candidate.id === category.parent_id);
                return (
                  <TableRow key={category.id}>
                    <TableCell className="font-medium">{category.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{category.slug}</TableCell>
                    <TableCell className="text-muted-foreground">{parent?.name ?? "—"}</TableCell>
                    <TableCell className="tnum text-right">{category.sort_order}</TableCell>
                    <TableCell>
                      <Badge tone={category.is_active ? "success" : "outline"} dot>
                        {category.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="outline" size="sm" onClick={() => openEdit(category)}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => toggleActive(category)}>
                          {category.is_active ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Edit category"
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
          <FormField label="Name" htmlFor="edit-category-name" required error={editErrors.name}>
            <Input
              id="edit-category-name"
              value={editValues.name}
              onChange={(event) => setEditValues((v) => ({ ...v, name: event.target.value }))}
            />
          </FormField>
          <FormField label="Slug" htmlFor="edit-category-slug" error={editErrors.slug}>
            <Input
              id="edit-category-slug"
              value={editValues.slug}
              onChange={(event) => setEditValues((v) => ({ ...v, slug: event.target.value }))}
              className="font-mono"
            />
          </FormField>
          <FormField label="Parent" htmlFor="edit-category-parent" error={editErrors.parentId}>
            <Select
              id="edit-category-parent"
              value={editValues.parentId}
              onChange={(event) => setEditValues((v) => ({ ...v, parentId: event.target.value }))}
            >
              <option value="">No parent</option>
              {parentOptions(editing?.id).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Sort order" htmlFor="edit-category-sort" error={editErrors.sortOrder}>
            <Input
              id="edit-category-sort"
              type="number"
              min="0"
              step="1"
              value={editValues.sortOrder}
              onChange={(event) => setEditValues((v) => ({ ...v, sortOrder: event.target.value }))}
              className="tnum"
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
