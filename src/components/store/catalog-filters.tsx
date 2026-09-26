"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { STOREFRONT_SORT_VALUES } from "@/lib/store/params";

const SORT_LABELS: Record<(typeof STOREFRONT_SORT_VALUES)[number], string> = {
  newest: "Newest first",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
  name: "Name: A to Z",
};

export type CatalogFilterValues = {
  search?: string;
  categoryId?: string;
  series?: string;
  sort?: string;
};

/**
 * Catalog filters as a GET form.
 *
 * A form rather than a set of onChange handlers, so filters live in the URL and
 * every filtered view is bookmarkable and shareable — and so the back button
 * steps through filter changes instead of leaving the page.
 *
 * The page parameter is reset to 1 on every submit. Without that, changing a
 * filter while on page 4 leaves the shopper on page 4 of a shorter result set,
 * which lands them on the out-of-range screen for no reason they can explain.
 */
export function CatalogFilters({
  categories,
  series,
  current,
}: {
  categories: { id: string; name: string }[];
  series: string[];
  current: CatalogFilterValues;
}) {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [term, setTerm] = React.useState(current.search ?? "");

  // Keep the box in step when the URL changes underneath us (back button, or a
  // link to a filtered catalog), without fighting the shopper mid-word.
  React.useEffect(() => {
    setTerm(current.search ?? "");
  }, [current.search]);

  function navigate(formData: FormData) {
    const params = new URLSearchParams();
    for (const [key, value] of formData.entries()) {
      const text = String(value).trim();
      if (text) params.set(key, text);
    }
    params.delete("page");
    const query = params.toString();
    router.push(query ? `/?${query}` : "/");
  }

  return (
    <form ref={formRef} action={navigate} className="flex flex-wrap items-end gap-2">
      <div className="min-w-48 flex-1">
        <label htmlFor="catalog-search" className="sr-only">
          Search the catalog
        </label>
        <Input
          id="catalog-search"
          name="search"
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search name, brand or series"
        />
      </div>

      <div>
        <label htmlFor="catalog-category" className="sr-only">
          Category
        </label>
        <Select id="catalog-category" name="category" defaultValue={current.categoryId ?? ""}>
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <label htmlFor="catalog-series" className="sr-only">
          Series
        </label>
        <Select id="catalog-series" name="series" defaultValue={current.series ?? ""}>
          <option value="">All series</option>
          {series.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <label htmlFor="catalog-sort" className="sr-only">
          Sort
        </label>
        <Select id="catalog-sort" name="sort" defaultValue={current.sort ?? "newest"}>
          {STOREFRONT_SORT_VALUES.map((value) => (
            <option key={value} value={value}>
              {SORT_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>

      <Button type="submit">Apply</Button>
      {current.search || current.categoryId || current.series || (current.sort && current.sort !== "newest") ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setTerm("");
            router.push("/");
          }}
        >
          Clear
        </Button>
      ) : null}
    </form>
  );
}
