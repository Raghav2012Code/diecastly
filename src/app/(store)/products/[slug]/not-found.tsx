import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

/**
 * 404 for an unknown, inactive or hidden product slug.
 *
 * The same page for all three cases, deliberately. Distinguishing "no such
 * product" from "that product is archived" would confirm the existence of
 * something the public surface is not supposed to reveal.
 */
export default function ProductNotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center gap-5 px-6 text-center">
      <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Not found</p>
      <h1 className="font-display text-3xl font-extrabold tracking-tight">
        We could not find that product
      </h1>
      <p className="max-w-prose text-sm text-muted-foreground">
        It may have sold out and been retired, or the link may be wrong. The catalog has
        everything currently available.
      </p>
      <Link href="/" className={buttonVariants()}>
        Browse the catalog
      </Link>
    </div>
  );
}
