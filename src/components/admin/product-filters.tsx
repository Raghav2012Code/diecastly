import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export type ProductFilterValues = {
  search?: string;
  status?: string;
  category?: string;
  brand?: string;
  stock?: string;
  sort?: string;
};

export function ProductFilters({
  categories,
  brands,
  current,
}: {
  categories: { id: string; name: string }[];
  brands: string[];
  current: ProductFilterValues;
}) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-2">
      <div className="min-w-56 flex-1">
        <label htmlFor="product-search" className="sr-only">
          Search products
        </label>
        <Input
          id="product-search"
          name="search"
          type="search"
          defaultValue={current.search ?? ""}
          placeholder="Search name, SKU or barcode"
        />
      </div>

      <div>
        <label htmlFor="product-status" className="sr-only">
          Status
        </label>
        <Select id="product-status" name="status" defaultValue={current.status ?? "all"}>
          <option value="all">Any status</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </Select>
      </div>

      <div>
        <label htmlFor="product-category" className="sr-only">
          Category
        </label>
        <Select id="product-category" name="category" defaultValue={current.category ?? ""}>
          <option value="">Any category</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <label htmlFor="product-brand" className="sr-only">
          Brand
        </label>
        <Select id="product-brand" name="brand" defaultValue={current.brand ?? ""}>
          <option value="">Any brand</option>
          {brands.map((brand) => (
            <option key={brand} value={brand}>
              {brand}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <label htmlFor="product-stock" className="sr-only">
          Stock
        </label>
        <Select id="product-stock" name="stock" defaultValue={current.stock ?? ""}>
          <option value="">Any stock</option>
          <option value="low">Low stock</option>
          <option value="out">Out of stock</option>
        </Select>
      </div>

      <div>
        <label htmlFor="product-sort" className="sr-only">
          Sort
        </label>
        <Select id="product-sort" name="sort" defaultValue={current.sort ?? "newest"}>
          <option value="newest">Newest</option>
          <option value="name">Name</option>
          <option value="price">Price</option>
          <option value="cost">Cost</option>
          <option value="stock">Stock</option>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="outline">
          Apply
        </Button>
        <Link
          href="/admin/products"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Clear
        </Link>
      </div>
    </form>
  );
}
