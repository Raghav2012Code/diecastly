"use client";

import Link from "next/link";
import { useEffect } from "react";
import { buttonVariants } from "@/components/ui/button";

/**
 * Storefront error boundary.
 *
 * A shopper must never see a stack trace, a SQLSTATE or a PostgREST message, so
 * this says only that the page could not be loaded and offers a way forward. The
 * underlying error is logged to the console for the developer instead.
 *
 * `reset` re-renders the segment without a full reload, which is the right
 * response to a transient read failure and the wrong one for a genuine bug — so
 * the reload link is offered too rather than assumed.
 */
export default function StoreError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Storefront error", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="font-display text-2xl font-extrabold tracking-tight">
        This page could not be loaded
      </h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Something went wrong on our side, not yours. You can try again, or head back to the
        catalog.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={reset} className={buttonVariants()}>
          Try again
        </button>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Back to the catalog
        </Link>
      </div>
    </div>
  );
}
