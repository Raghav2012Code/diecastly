import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ToastProvider } from "@/components/ui/toast";
import { getLowStockCounts } from "@/lib/reports/data";
import { listOpenOrders } from "@/lib/customers/data";
import { AdminNav } from "./nav";
import { SignOutButton } from "./sign-out-button";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/admin/login");
  }

  const initial = (user.email ?? "?").slice(0, 1).toUpperCase();

  // Active products only, at or below their threshold and not already sold out.
  // Counted here rather than in the nav because the nav is a client component and
  // this needs the reporting view. A failure is not fatal: the admin simply gets
  // no badge, which is the right degradation for an advisory count.
  //
  // An exact count query, not a filtered row read: counting the rows of
  // `getLowStock(200)` would have made the badge read "N of the first 200", which
  // is a different number from the one the dashboard shows for the same thing.
  const lowStock = await getLowStockCounts();
  const lowStockCount = lowStock.ok ? lowStock.data.lowStock : 0;

  // The same listOpenOrders the dashboard queue reads — one mechanism, not
  // two. Advisory like the low-stock count: a failure means no badge.
  const queue = await listOpenOrders();
  const openOrdersCount = queue.ok ? queue.data.length : 0;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col bg-petrol print:hidden md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-primary font-display text-base font-extrabold text-primary-foreground">
            D
          </span>
          <div className="leading-none">
            <p className="font-display text-xl font-extrabold tracking-tight text-petrol-foreground">
              DIECASTLY
            </p>
            <p className="mt-1 text-[11px] text-petrol-foreground/60">Business desk</p>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <AdminNav lowStockCount={lowStockCount} openOrdersCount={openOrdersCount} />
        </div>
        <p className="px-5 py-4 text-[11px] text-petrol-foreground/70">
          Stock moves only through the ledger.
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-border bg-card/70 px-4 py-2.5 print:hidden md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-petrol text-xs font-semibold text-petrol-foreground md:hidden">
              D
            </span>
            <span
              aria-hidden
              className="hidden h-7 w-7 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground md:grid"
            >
              {initial}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">Signed in</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <SignOutButton />
        </header>
        {/* Below md the sidebar is display:none, which left the admin with no way
            to move between sections. Horizontally scrollable so all nine items
            stay reachable without a menu that has to be opened first. */}
        <div className="border-b border-border bg-petrol px-3 py-2 print:hidden md:hidden">
          <AdminNav orientation="bar" lowStockCount={lowStockCount} openOrdersCount={openOrdersCount} />
        </div>

        <main className="min-w-0 flex-1 px-4 py-6 print:p-0 md:px-6">
          <ToastProvider>{children}</ToastProvider>
        </main>
      </div>
    </div>
  );
}
