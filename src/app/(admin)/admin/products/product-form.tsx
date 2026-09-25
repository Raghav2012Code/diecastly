"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { productCreateSchema, productUpdateSchema } from "@/lib/validation/catalog";
import type { ProductRow, ProductStatus } from "@/lib/types/database.types";
import { createProductAction, updateProductAction, type CreateProductResult } from "./actions";

export type ProductFormValues = {
  name: string;
  slug: string;
  brand: string;
  model: string;
  series: string;
  categoryId: string;
  supplierId: string;
  description: string;
  sku: string;
  barcode: string;
  purchaseCost: string;
  sellingPrice: string;
  lowStockThreshold: string;
  status: ProductStatus;
  isFeatured: boolean;
  openingStock: string;
};

export const emptyProductFormValues: ProductFormValues = {
  name: "",
  slug: "",
  brand: "",
  model: "",
  series: "",
  categoryId: "",
  supplierId: "",
  description: "",
  sku: "",
  barcode: "",
  purchaseCost: "",
  sellingPrice: "",
  lowStockThreshold: "0",
  status: "draft",
  isFeatured: false,
  openingStock: "",
};

export function productFormValuesFrom(product: ProductRow): ProductFormValues {
  return {
    name: product.name,
    slug: product.slug,
    brand: product.brand ?? "",
    model: product.model ?? "",
    series: product.series ?? "",
    categoryId: product.category_id ?? "",
    supplierId: product.supplier_id ?? "",
    description: product.description ?? "",
    sku: product.sku ?? "",
    barcode: product.barcode ?? "",
    purchaseCost: String(product.purchase_cost),
    sellingPrice: String(product.selling_price),
    lowStockThreshold: String(product.low_stock_threshold),
    status: product.status,
    isFeatured: product.is_featured,
    openingStock: "",
  };
}

function toNumberOr(value: string, fallback: number): number {
  if (value.trim() === "") return fallback;
  return Number(value);
}

export function ProductForm({
  mode,
  productId,
  categories,
  suppliers,
  hasInitialStock,
  initial,
}: {
  mode: "create" | "edit";
  productId?: string;
  categories: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  hasInitialStock: boolean;
  initial: ProductFormValues;
}) {
  const [values, setValues] = useState<ProductFormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  function update<K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const payload: Record<string, unknown> = {
      name: values.name,
      slug: values.slug,
      brand: values.brand,
      model: values.model,
      series: values.series,
      categoryId: values.categoryId,
      supplierId: values.supplierId,
      description: values.description,
      sku: values.sku,
      barcode: values.barcode,
      purchaseCost: toNumberOr(values.purchaseCost, 0),
      sellingPrice: toNumberOr(values.sellingPrice, 0),
      lowStockThreshold: toNumberOr(values.lowStockThreshold, 0),
      status: values.status,
      isFeatured: values.isFeatured,
    };
    if (mode === "create") {
      payload.openingStock = values.openingStock.trim() === "" ? undefined : Number(values.openingStock);
    }

    const schema = mode === "create" ? productCreateSchema : productUpdateSchema;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!nextErrors[key]) nextErrors[key] = issue.message;
      }
      setErrors(nextErrors);
      toast("Check the highlighted fields and try again.", "error");
      return;
    }

    startTransition(async () => {
      const result =
        mode === "create"
          ? await createProductAction(parsed.data)
          : await updateProductAction(productId!, parsed.data);

      if (!result.ok) {
        setErrors({ [result.field ?? "form"]: result.error });
        toast(result.error, "error");
        return;
      }

      if (mode === "create") {
        const data = result.data as CreateProductResult;
        if (data.stockWarning) toast(data.stockWarning, "error");
        else toast("Product created", "success");
        router.push(`/admin/products/${data.productId}`);
        router.refresh();
      } else {
        toast("Changes saved", "success");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Identity</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FormField label="Name" htmlFor="name" required error={errors.name} className="sm:col-span-2">
                <Input
                  id="name"
                  value={values.name}
                  onChange={(event) => update("name", event.target.value)}
                  aria-invalid={Boolean(errors.name)}
                  placeholder="Hot Wheels Nissan Skyline GT-R (R34)"
                />
              </FormField>
              <FormField label="Brand" htmlFor="brand" error={errors.brand}>
                <Input
                  id="brand"
                  value={values.brand}
                  onChange={(event) => update("brand", event.target.value)}
                  placeholder="Hot Wheels"
                />
              </FormField>
              <FormField label="Series" htmlFor="series" error={errors.series}>
                <Input
                  id="series"
                  value={values.series}
                  onChange={(event) => update("series", event.target.value)}
                  placeholder="Car Culture"
                />
              </FormField>
              <FormField label="Model" htmlFor="model" error={errors.model}>
                <Input
                  id="model"
                  value={values.model}
                  onChange={(event) => update("model", event.target.value)}
                  placeholder="Skyline GT-R (R34)"
                />
              </FormField>
              <FormField label="Category" htmlFor="categoryId" error={errors.categoryId}>
                <Select
                  id="categoryId"
                  value={values.categoryId}
                  onChange={(event) => update("categoryId", event.target.value)}
                >
                  <option value="">No category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Supplier" htmlFor="supplierId" error={errors.supplierId} className="sm:col-span-2">
                <Select
                  id="supplierId"
                  value={values.supplierId}
                  onChange={(event) => update("supplierId", event.target.value)}
                >
                  <option value="">No supplier</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Codes</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FormField label="SKU" htmlFor="sku" error={errors.sku} hint="Unique. Letters, numbers, dot, dash, underscore.">
                <Input
                  id="sku"
                  value={values.sku}
                  onChange={(event) => update("sku", event.target.value)}
                  aria-invalid={Boolean(errors.sku)}
                  placeholder="HW-R34-001"
                  className="font-mono"
                />
              </FormField>
              <FormField label="Barcode" htmlFor="barcode" error={errors.barcode} hint="6–20 digits.">
                <Input
                  id="barcode"
                  value={values.barcode}
                  onChange={(event) => update("barcode", event.target.value)}
                  aria-invalid={Boolean(errors.barcode)}
                  placeholder="8901234567890"
                  inputMode="numeric"
                  className="font-mono"
                />
              </FormField>
              <FormField
                label="URL slug"
                htmlFor="slug"
                error={errors.slug}
                hint="Leave blank to generate from the name."
                className="sm:col-span-2"
              >
                <Input
                  id="slug"
                  value={values.slug}
                  onChange={(event) => update("slug", event.target.value)}
                  aria-invalid={Boolean(errors.slug)}
                  placeholder="hot-wheels-skyline-gtr-r34"
                  className="font-mono"
                />
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent>
              <FormField label="Description" htmlFor="description" error={errors.description}>
                <Textarea
                  id="description"
                  value={values.description}
                  onChange={(event) => update("description", event.target.value)}
                  placeholder="Condition, casting details, anything worth remembering."
                />
              </FormField>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Pricing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField label="Purchase cost" htmlFor="purchaseCost" error={errors.purchaseCost} hint="What you paid. Snapshotted at each sale.">
                <Input
                  id="purchaseCost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.purchaseCost}
                  onChange={(event) => update("purchaseCost", event.target.value)}
                  aria-invalid={Boolean(errors.purchaseCost)}
                  placeholder="0.00"
                  className="tnum"
                />
              </FormField>
              <FormField label="Selling price" htmlFor="sellingPrice" error={errors.sellingPrice}>
                <Input
                  id="sellingPrice"
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.sellingPrice}
                  onChange={(event) => update("sellingPrice", event.target.value)}
                  aria-invalid={Boolean(errors.sellingPrice)}
                  placeholder="0.00"
                  className="tnum"
                />
              </FormField>
              <FormField
                label="Low-stock threshold"
                htmlFor="lowStockThreshold"
                error={errors.lowStockThreshold}
                hint="Warn when stock reaches this number."
              >
                <Input
                  id="lowStockThreshold"
                  type="number"
                  min="0"
                  step="1"
                  value={values.lowStockThreshold}
                  onChange={(event) => update("lowStockThreshold", event.target.value)}
                  aria-invalid={Boolean(errors.lowStockThreshold)}
                  className="tnum"
                />
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Availability</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField label="Status" htmlFor="status" error={errors.status}>
                <Select
                  id="status"
                  value={values.status}
                  onChange={(event) => update("status", event.target.value as ProductStatus)}
                >
                  <option value="draft">Draft (not sellable)</option>
                  <option value="active">Active (sellable)</option>
                  <option value="archived">Archived (hidden)</option>
                </Select>
              </FormField>
              <label className="flex items-center gap-2.5 text-sm">
                <Checkbox
                  checked={values.isFeatured}
                  onChange={(event) => update("isFeatured", event.target.checked)}
                />
                Feature on the storefront
              </label>
            </CardContent>
          </Card>

          {mode === "create" ? (
            <Card>
              <CardHeader>
                <CardTitle>Opening stock</CardTitle>
              </CardHeader>
              <CardContent>
                <FormField
                  label="Quantity"
                  htmlFor="openingStock"
                  error={errors.openingStock}
                  hint="Recorded once, as the product's first ledger movement. Leave blank for zero."
                >
                  <Input
                    id="openingStock"
                    type="number"
                    min="1"
                    step="1"
                    value={values.openingStock}
                    onChange={(event) => update("openingStock", event.target.value)}
                    aria-invalid={Boolean(errors.openingStock)}
                    placeholder="0"
                    className="tnum"
                  />
                </FormField>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Opening stock</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {hasInitialStock
                  ? "Opening stock has already been recorded. Use Restock or Adjust on the inventory screen for further changes."
                  : "No opening stock recorded yet. Set it from the inventory screen — stock only moves through the ledger."}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <Link href={mode === "create" ? "/admin/products" : `/admin/products/${productId}`} className={buttonVariants({ variant: "outline" })}>
          Cancel
        </Link>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Create product" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
