import Link from "next/link";

export function StoreFooter({ businessName }: { businessName: string }) {
  return (
    <footer className="border-t border-border bg-card/40 print:hidden">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          {businessName} — diecast collectibles, direct from the seller.
        </p>
        <p className="flex items-center gap-4">
          <Link href="/" className="hover:text-foreground">
            Catalog
          </Link>
          <Link href="/cart" className="hover:text-foreground">
            Cart
          </Link>
        </p>
      </div>
    </footer>
  );
}
