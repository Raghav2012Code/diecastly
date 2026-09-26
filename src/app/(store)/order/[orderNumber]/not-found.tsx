import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

/**
 * 404 for an order link with a missing, malformed or wrong token.
 *
 * Deliberately identical to the not-found page for an unknown product slug, and
 * carrying no hint about which order numbers exist. A distinct "wrong token"
 * message would be a probe for guessing order numbers, which is the one thing
 * the access-token model exists to prevent (docs/security.md §6).
 */
export default function OrderNotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center gap-5 px-6 text-center">
      <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Not found</p>
      <h1 className="font-display text-3xl font-extrabold tracking-tight">We could not find that order</h1>
      <p className="max-w-prose text-sm text-muted-foreground">
        An order link needs both the order number and the private link from your confirmation.
        If you have lost it, contact us and we will sort it out.
      </p>
      <Link href="/" className={buttonVariants()}>
        Browse the catalog
      </Link>
    </div>
  );
}
