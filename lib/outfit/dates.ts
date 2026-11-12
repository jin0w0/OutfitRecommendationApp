// Dates as the 코디 추천 module and its screens pass them: YYYY-MM-DD, in
// Korean time.

export function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function todayInKorea() {
  return koreaDate(new Date());
}

// The date `moment` falls on in Korea.
export function koreaDate(moment: Date) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(moment);
}

// `date` moved by `days` (YYYY-MM-DD).
export function addDays(date: string, days: number) {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

// The Monday of the week `date` is in (YYYY-MM-DD).
export function weekStart(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

// Whole days from `from` to `to` (both YYYY-MM-DD).
export function daysBetween(from: string, to: string) {
  return (Date.parse(to) - Date.parse(from)) / 86_400_000;
}
