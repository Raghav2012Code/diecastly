"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The sales range control.
 *
 * A GET form, so a chosen range is a link: bookmarkable, shareable, and the back
 * button steps through range changes instead of leaving the page.
 *
 * `from` and `to` are submitted as plain dates, and the page validates both
 * against `^\d{4}-\d{2}-\d{2}$`, falling back to its defaults otherwise. That is
 * the same discipline the admin list filters use: an unrecognised value is
 * treated as absent rather than handed to a date comparison.
 */
export function SalesRangePicker({
  ranges,
  current,
}: {
  ranges: { key: string; label: string; days: number }[];
  current: { days: string; from: string; to: string };
}) {
  const router = useRouter();
  const [from, setFrom] = React.useState(current.from);
  const [to, setTo] = React.useState(current.to);

  React.useEffect(() => {
    setFrom(current.from);
    setTo(current.to);
  }, [current.from, current.to]);

  function push(params: URLSearchParams) {
    const query = params.toString();
    router.push(query ? `/admin/sales?${query}` : "/admin/sales");
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      {ranges.map((range) => (
        <Button
          key={range.key}
          type="button"
          size="sm"
          variant={range.key === current.days ? "default" : "outline"}
          // A preset recomputes both ends from today, so switching from a custom
          // range to "7 days" does not leave the old dates in place.
          onClick={() => push(new URLSearchParams({ days: range.key }))}
        >
          {range.label}
        </Button>
      ))}

      <form
        className="ml-auto flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          push(new URLSearchParams({ from, to, days: "custom" }));
        }}
      >
        <div>
          <label htmlFor="sales-from" className="text-xs text-muted-foreground">
            From
          </label>
          <Input
            id="sales-from"
            type="date"
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
            className="h-8 w-36"
          />
        </div>
        <div>
          <label htmlFor="sales-to" className="text-xs text-muted-foreground">
            To
          </label>
          <Input
            id="sales-to"
            type="date"
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
            className="h-8 w-36"
          />
        </div>
        <Button type="submit" size="sm" variant="outline">
          Apply
        </Button>
      </form>
    </div>
  );
}
