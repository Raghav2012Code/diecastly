import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const KPIS = [
  "Revenue",
  "Orders",
  "Units sold",
  "Gross profit",
  "Contribution after shipping",
] as const;

export default function AdminDashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Phase 0 shell. Metrics are wired to reporting views in Phase 6.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {KPIS.map((label) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-2xl">—</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">Today</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What works right now</CardTitle>
          <CardDescription>Authentication, authorization and the database foundation.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          You are signed in, the session is refreshed by middleware, and admin routes are protected.
          Row Level Security and the atomic RPCs are applied by the Phase 1 migrations.
        </CardContent>
      </Card>
    </div>
  );
}
