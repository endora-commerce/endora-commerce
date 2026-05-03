import { describe, expect, it } from 'vitest';
import { resolveDisplayBand } from '../../../src/modules/inventory/services/display-band-resolver.js';

describe('resolveDisplayBand (T023)', () => {
  it('returns "available" when manageStock is false regardless of on-hand', () => {
    expect(
      resolveDisplayBand({
        manageStock: false,
        cumulativeOnHand: 0,
        thresholds: { high: 100, medium: 20, low: 1 },
      }),
    ).toBe('available');
  });

  it('returns "out_of_stock" when on-hand is zero', () => {
    expect(
      resolveDisplayBand({
        manageStock: true,
        cumulativeOnHand: 0,
        thresholds: { high: 100, medium: 20, low: 1 },
      }),
    ).toBe('out_of_stock');
  });

  it.each([
    [120, 'high'],
    [60, 'medium'],
    [10, 'low'],
    [1, 'low'],
  ] as const)('on-hand %i resolves to %s', (onHand, expected) => {
    expect(
      resolveDisplayBand({
        manageStock: true,
        cumulativeOnHand: onHand,
        thresholds: { high: 100, medium: 20, low: 1 },
      }),
    ).toBe(expected);
  });

  it('honours the most-specific level when thresholds differ', () => {
    // Category overrides high to 50 → on-hand 60 should land on `high`.
    expect(
      resolveDisplayBand({
        manageStock: true,
        cumulativeOnHand: 60,
        thresholds: { high: 50, medium: 10, low: 1 },
      }),
    ).toBe('high');
  });

  it('falls through to `low` when thresholds are missing but on-hand > 0', () => {
    expect(
      resolveDisplayBand({
        manageStock: true,
        cumulativeOnHand: 5,
        thresholds: { high: null, medium: null, low: null },
      }),
    ).toBe('low');
  });
});
