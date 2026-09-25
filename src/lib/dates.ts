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
