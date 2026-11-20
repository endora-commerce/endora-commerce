import { describe, expect, it } from 'vitest';

/**
 * RP-15 — the operator picks calendar dates; the panel sends instants: *from* is the start of
 * that day and *to* the end of it, both in the operator's (browser's) time zone.
 */
const { endOfDayInstant, localDateOf, startOfDayInstant } = await import(
  '../../../../packages/modules/related_payers/src/admin/lib/window'
);

describe('validity window conversion (RP-15)', () => {
  it('from is local midnight, to is the last millisecond of the local day', () => {
    const from = new Date(startOfDayInstant('2026-03-10')!);
    const to = new Date(endOfDayInstant('2026-03-10')!);
    expect([from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), from.getMinutes()]).toEqual([2026, 2, 10, 0, 0]);
    expect([to.getFullYear(), to.getMonth(), to.getDate(), to.getHours(), to.getMinutes(), to.getSeconds(), to.getMilliseconds()]).toEqual([
      2026, 2, 10, 23, 59, 59, 999,
    ]);
  });

  it('round-trips through the instant, on a daylight-saving day too', () => {
    for (const day of ['2026-01-01', '2026-03-29', '2026-10-25', '2026-12-31']) {
      expect(localDateOf(startOfDayInstant(day))).toBe(day);
      expect(localDateOf(endOfDayInstant(day))).toBe(day);
    }
  });

  it('sends ISO instants the contract accepts, and nothing for an empty field', () => {
    expect(startOfDayInstant('2026-03-10')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(startOfDayInstant('')).toBeNull();
    expect(endOfDayInstant('')).toBeNull();
    expect(localDateOf(null)).toBe('');
  });
});
