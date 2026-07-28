/**
 * All calendar-date handling. The app deliberately keeps two notions of when an
 * expense happened: `spent_at` (an absolute UTC instant) and `local_date` (the
 * calendar day in the timezone you were standing in). Charts group by the
 * latter so an evening meal in Europe does not slide into the next day.
 */

/** `YYYY-MM-DD` for a Date, read in the device's current timezone. */
export function toLocalDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayLocal(): string {
  return toLocalDate(new Date());
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Inclusive comparison on `YYYY-MM-DD` strings, which sort lexicographically. */
export function isWithin(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

export function addDays(date: string, days: number): string {
  const d = parseLocalDate(date);
  d.setDate(d.getDate() + days);
  return toLocalDate(d);
}

/** Parses `YYYY-MM-DD` as a local midnight, avoiding the UTC shift `new Date(str)` applies. */
export function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function daysBetween(start: string, end: string): number {
  const ms = parseLocalDate(end).getTime() - parseLocalDate(start).getTime();
  return Math.round(ms / 86_400_000);
}

/** Every date from start to end inclusive. Used to give charts continuous axes. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const total = daysBetween(start, end);
  for (let i = 0; i <= total; i++) out.push(addDays(start, i));
  return out;
}

export function formatShortDate(date: string): string {
  const d = parseLocalDate(date);
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
}

export function formatLongDate(date: string): string {
  const d = parseLocalDate(date);
  return d.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'long' });
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseLocalDate(s);
  return toLocalDate(d) === s;
}
