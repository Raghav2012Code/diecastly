/** Display helpers. Reporting day boundaries are IST; timestamps render in IST. */

const IST = "Asia/Kolkata";

export function formatDateTimeIST(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: IST,
  }).format(new Date(value));
}

export function formatDateIST(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: IST,
  }).format(new Date(value));
}

/**
 * The start or end of an IST calendar day, as a UTC instant.
 *
 * The +05:30 offset used to be written out at the call site as well as here,
 * which is the duplication the project rules warn about. IST has no daylight
 * saving, so a fixed offset is correct, but it is defined in this module only.
 *
 * Returns null for anything that is not a plain `YYYY-MM-DD`, so a malformed
 * query parameter is ignored rather than turned into a silently wrong instant.
 */
export function istDayBoundary(date: string, endOfDay = false): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
  const parsed = new Date(`${date}T${time}+05:30`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
