import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getPublicProductBySlug } from "@/lib/store/data";
import { ProductDetail } from "@/components/store/product-detail";

type Params = Promise<{ slug: string }>;

/**
 * Product metadata.
 *
 * Resolved through the same public read as the page, so a title can never be
 * generated for a product the page then 404s on. A missing product returns
 * `notFound()` here too rather than a generic title.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getPublicProductBySlug(slug);
  if (!product.ok || !product.data) return { title: "Not found" };

  return {
    title: product.data.name,
    description: product.data.description ?? undefined,
  };
}

/**
 * The product detail page.
 *
 * A slug that does not exist, is not active, or belongs to a draft or archived
 * product all resolve to the same 404 (ux.md §9). That is deliberate: telling a
 * shopper "this product is archived" would confirm the product exists, and the
 * public surface has no business distinguishing those cases.
 *
 * No related items. `ux.md` marks them optional and there is no "also bought" or
 * category-sibling query in the schema to build them from honestly, and a
 * hand-rolled "more from this series" would be a worse recommendation than none.
 */
export default async function ProductPage({ params }: { params: Params }) {
  const { slug } = await params;
  const result = await getPublicProductBySlug(slug);

  // A read failure is a server error, not a 404: claiming the product does not
  // exist because the database was briefly unreachable would be a lie.
  if (!result.ok) throw new Error(result.error.message);
  if (!result.data) notFound();

  const product = result.data;

  const breadcrumbs = (
    <nav aria-label="Breadcrumb" className="mb-5 text-sm text-muted-foreground">
      <Link href="/" className="hover:text-foreground">
        Catalog
      </Link>
      <span className="px-1.5" aria-hidden>
        /
      </span>
      <span className="text-foreground">{product.name}</span>
    </nav>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      {breadcrumbs}
      <ProductDetail product={product} />
    </div>
  );
}
