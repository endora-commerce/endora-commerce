/**
 * RP-15 — a link's validity window is two instants. The operator picks calendar dates
 * (`<input type="date">`, `YYYY-MM-DD`); the panel turns *from* into the start of that day
 * and *to* into its last millisecond, in the operator's own (browser) time zone, and shows a
 * stored instant back as the local date it falls on.
 */

function parts(date: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
}

/** The local start of `date`, as an ISO instant; `null` for an empty field. */
export function startOfDayInstant(date: string): string | null {
  const p = parts(date);
  return p ? new Date(p[0], p[1], p[2], 0, 0, 0, 0).toISOString() : null;
}

/** The local end of `date` (23:59:59.999), as an ISO instant; `null` for an empty field. */
export function endOfDayInstant(date: string): string | null {
  const p = parts(date);
  return p ? new Date(p[0], p[1], p[2], 23, 59, 59, 999).toISOString() : null;
}

/** The local calendar date an instant falls on, `YYYY-MM-DD`; `''` for none. */
export function localDateOf(instant: string | null | undefined): string {
  if (!instant) return '';
  const d = new Date(instant);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
