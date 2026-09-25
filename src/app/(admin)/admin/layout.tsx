import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r bg-muted/20 p-4 md:flex md:flex-col">
        <div className="mb-6 px-3">
          <p className="text-lg font-semibold tracking-tight">Diecastly</p>
          <p className="text-xs text-muted-foreground">Admin</p>
        </div>
        <AdminNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Signed in</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
          <SignOutButton />
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
