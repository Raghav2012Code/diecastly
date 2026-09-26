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
 *
 * "Not a plain YYYY-MM-DD" also covers a well-formed but IMPOSSIBLE date. V8
 * range-checks the month and rejects a day above 31, but it silently rolls an
 * over-large day within a valid month into the neighbour, and not always in the
 * same direction: 2026-02-30 became 2 March while 2026-04-31 became 30 April. So
 * `?from=2026-02-30` rendered a control reading 30 February while filtering
 * from a different day entirely, with nothing on the page indicating the value
 * had been reinterpreted. The round-trip below is what closes that.
 */
export function istDayBoundary(date: string, endOfDay = false): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
  const parsed = new Date(`${date}T${time}+05:30`);
  if (Number.isNaN(parsed.getTime())) return null;

  // Confirm the instant really lands on the calendar day that was asked for.
  // `en-CA` formats as YYYY-MM-DD, so this compares like for like. The zone is
  // named rather than hard-coded to +05:30 so the check agrees with the IST
  // formatter used elsewhere in this module.
  const localDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);

  return localDay === date ? parsed.toISOString() : null;
}
