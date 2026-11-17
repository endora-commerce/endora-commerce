/**
 * How the analytics screen says a number of days and a share. Pure functions:
 * the screen's tests and the screen read the same ones. The range presets are
 * the kit's (`@endora-commerce/admin-kit/lib`, issue #464).
 */

/** A number of days in the language on screen, to one decimal; `Intl` supplies the unit and its plural. */
export function daysLabel(days: number, language: string): string {
  return new Intl.NumberFormat(language, {
    style: 'unit',
    unit: 'day',
    unitDisplay: 'long',
    maximumFractionDigits: 1,
  }).format(Math.max(0, days));
}

/** A share of a whole (0 – 1) as a whole percentage. */
export function percentLabel(share: number, language: string): string {
  return new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 }).format(share);
}

/** Days to two decimals — what a chart axis in days plots. */
export function chartDays(days: number): number {
  return Math.round(Math.max(0, days) * 100) / 100;
}
