import { describe, expect, it } from 'vitest';
import {
  resolveThresholds,
  type ThresholdLevel,
} from './threshold-resolver.js';

const G: ThresholdLevel = { high: 100, medium: 20, low: 1 };

describe('resolveThresholds (T023)', () => {
  it('falls back to global when product + category are absent', () => {
    expect(resolveThresholds({ globalThresholds: G })).toEqual({ high: 100, medium: 20, low: 1 });
  });

  it('product overrides category and global per-key', () => {
    expect(
      resolveThresholds({
        productThresholds: { high: null, medium: null, low: 5 },
        categoryThresholds: [{ high: 50, medium: 10, low: null }],
        globalThresholds: G,
      }),
    ).toEqual({ high: 50, medium: 10, low: 5 });
  });

  it('walks the category list in order and picks the first defined value', () => {
    expect(
      resolveThresholds({
        categoryThresholds: [
          { high: null, medium: null, low: null },
          { high: 70, medium: null, low: null },
          { high: 50, medium: 30, low: null },
        ],
        globalThresholds: G,
      }),
    ).toEqual({ high: 70, medium: 30, low: 1 });
  });

  it('product wins over category', () => {
    expect(
      resolveThresholds({
        productThresholds: { high: 60, medium: null, low: null },
        categoryThresholds: [{ high: 50, medium: 10, low: 2 }],
        globalThresholds: G,
      }),
    ).toEqual({ high: 60, medium: 10, low: 2 });
  });
});
