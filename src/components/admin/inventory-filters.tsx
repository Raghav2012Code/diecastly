import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export type InventoryFilterValues = {
  search?: string;
  scope?: string;
  category?: string;
  supplier?: string;
  sort?: string;
};

export function InventoryFilters({
  categories,
  suppliers,
  current,
}: {
  categories: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  current: InventoryFilterValues;
}) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-2">
      <div className="min-w-56 flex-1">
        <label htmlFor="inventory-search" className="sr-only">
          Search inventory
        </label>
        <Input
          id="inventory-search"
          name="search"
          type="search"
          defaultValue={current.search ?? ""}
          placeholder="Search name or SKU"
        />
      </div>

      <div>
        <label htmlFor="inventory-scope" className="sr-only">
          Stock state
        </label>
        <Select id="inventory-scope" name="scope" defaultValue={current.scope ?? "all"}>
          <option value="all">All stock</option>
          <option value="low">Low stock</option>
          <option value="out">Out of stock</option>
          <option value="archived">Archived</option>
        </Select>
      </div>

      <div>
        <label htmlFor="inventory-category" className="sr-only">
          Category
        </label>
        <Select id="inventory-category" name="category" defaultValue={current.category ?? ""}>
          <option value="">Any category</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <label htmlFor="inventory-supplier" className="sr-only">
          Supplier
        </label>
        <Select id="inventory-supplier" name="supplier" defaultValue={current.supplier ?? ""}>
          <option value="">Any supplier</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <label htmlFor="inventory-sort" className="sr-only">
          Sort
        </label>
        <Select id="inventory-sort" name="sort" defaultValue={current.sort ?? "name"}>
          <option value="name">Name</option>
          <option value="stock">Lowest stock</option>
          <option value="threshold">Highest threshold</option>
          <option value="newest">Recently changed</option>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="outline">
          Apply
        </Button>
        <Link
          href="/admin/inventory"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Clear
        </Link>
      </div>
    </form>
  );
}
