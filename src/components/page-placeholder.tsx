import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function PagePlaceholder({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Not built yet</CardTitle>
          <CardDescription>
            Reserved for {phase}. Phase 0 and Phase 1 deliver the foundation and database only.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The route exists so navigation and authorization can be verified. Business logic for this
          surface is intentionally out of scope for now.
        </CardContent>
      </Card>
    </div>
  );
}
