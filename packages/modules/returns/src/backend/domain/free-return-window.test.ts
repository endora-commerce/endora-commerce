import { describe, expect, it } from 'vitest';
import { isWithinFreeWindow } from './free-return-window.js';

/**
 * Feature 046 (US7 / SC-005); issue #905 (design D3.4) moved the window from
 * `anchor + days × 24 h` to calendar days in `returns.time_zone`, ending at the
 * end of the last day, with a last day on a Saturday or Sunday moved to the
 * Monday — the counting the statutory period uses.
 */
describe('isWithinFreeWindow (US7 / SC-005)', () => {
  const WARSAW = 'Europe/Warsaw';
  // Monday 1 June 2026, 14:00 in Warsaw.
  const anchor = new Date('2026-06-01T12:00:00.000Z');
  const day = (n: number): Date => new Date(anchor.getTime() + n * 24 * 60 * 60 * 1000);

  it('qualifies on the anchor day and within the window', () => {
    expect(isWithinFreeWindow(anchor, anchor, 14, WARSAW)).toBe(true);
    expect(isWithinFreeWindow(day(13), anchor, 14, WARSAW)).toBe(true);
  });

  it('qualifies until the end of the last calendar day in the zone (inclusive boundary)', () => {
    // Monday 15 June ends at 22:00 UTC (CEST).
    expect(isWithinFreeWindow(day(14), anchor, 14, WARSAW)).toBe(true);
    expect(isWithinFreeWindow(new Date(day(14).getTime() + 1), anchor, 14, WARSAW)).toBe(true);
    expect(isWithinFreeWindow(new Date('2026-06-15T21:59:59.999Z'), anchor, 14, WARSAW)).toBe(true);
  });

  it('does not qualify once the last day is over', () => {
    expect(isWithinFreeWindow(new Date('2026-06-15T22:00:00.000Z'), anchor, 14, WARSAW)).toBe(false);
    expect(isWithinFreeWindow(day(15), anchor, 14, WARSAW)).toBe(false);
  });

  it('moves a last day on a weekend to the Monday', () => {
    // 1 June + 5 = Saturday 6 June → Monday 8 June.
    expect(isWithinFreeWindow(new Date('2026-06-08T21:59:59.999Z'), anchor, 5, WARSAW)).toBe(true);
    expect(isWithinFreeWindow(new Date('2026-06-08T22:00:00.000Z'), anchor, 5, WARSAW)).toBe(false);
  });

  it('treats days = 0 as no free-return option', () => {
    expect(isWithinFreeWindow(anchor, anchor, 0, WARSAW)).toBe(false);
  });

  it('is never free when the order has not reached its completing status', () => {
    expect(isWithinFreeWindow(anchor, null, 14, WARSAW)).toBe(false);
  });
});
