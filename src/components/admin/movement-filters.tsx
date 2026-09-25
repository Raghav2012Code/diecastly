import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { movementTypeLabel } from "@/lib/display";
import { MOVEMENT_TYPES } from "@/lib/types/database.types";

export function MovementFilters({ current }: { current: { type?: string; source?: string } }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor="movement-type" className="sr-only">
          Movement type
        </label>
        <Select id="movement-type" name="type" defaultValue={current.type ?? ""}>
          <option value="">All movements</option>
          {MOVEMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {movementTypeLabel[type]}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <label htmlFor="movement-source" className="sr-only">
          Source
        </label>
        <Select id="movement-source" name="source" defaultValue={current.source ?? ""}>
          <option value="">Any source</option>
          <option value="admin">Admin</option>
          <option value="storefront">Storefront</option>
          <option value="system">System</option>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="outline">
          Apply
        </Button>
        <Link
          href="/admin/inventory/movements"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Clear
        </Link>
      </div>
    </form>
  );
}
