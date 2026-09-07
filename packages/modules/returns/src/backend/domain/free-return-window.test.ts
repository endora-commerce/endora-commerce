import { describe, expect, it } from 'vitest';
import { isWithinFreeWindow } from './free-return-window.js';

describe('isWithinFreeWindow (US7 / SC-005)', () => {
  const anchor = new Date('2026-06-01T12:00:00.000Z');
  const day = (n: number): Date => new Date(anchor.getTime() + n * 24 * 60 * 60 * 1000);

  it('qualifies on the anchor day and within the window', () => {
    expect(isWithinFreeWindow(anchor, anchor, 14)).toBe(true);
    expect(isWithinFreeWindow(day(13), anchor, 14)).toBe(true);
  });

  it('qualifies exactly on the last day (inclusive boundary)', () => {
    expect(isWithinFreeWindow(day(14), anchor, 14)).toBe(true);
  });

  it('does not qualify the moment after the window closes', () => {
    expect(isWithinFreeWindow(new Date(day(14).getTime() + 1), anchor, 14)).toBe(false);
    expect(isWithinFreeWindow(day(15), anchor, 14)).toBe(false);
  });

  it('treats days = 0 as no free-return option', () => {
    expect(isWithinFreeWindow(anchor, anchor, 0)).toBe(false);
  });

  it('is never free when the order has not reached its completing status', () => {
    expect(isWithinFreeWindow(anchor, null, 14)).toBe(false);
  });
});
