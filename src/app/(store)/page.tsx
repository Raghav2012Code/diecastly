import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function StoreHomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
        Diecastly Storefront
      </p>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        Diecast collectibles, direct from the seller
      </h1>
      <p className="max-w-prose text-muted-foreground">
        The public catalog, product pages, cart and checkout are implemented in Phase 4. This
        placeholder confirms the storefront route group renders.
      </p>
      <Link href="/admin" className={buttonVariants()}>
        Go to admin
      </Link>
    </main>
  );
}
