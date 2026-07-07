import { describe, expect, it } from 'vitest';
import { readScopedValue, writeScopedValue, clearScopedOverride } from '../fields/scoped-field.js';

describe('writeScopedValue', () => {
  it('writes base without touching tablet/desktop overrides', () => {
    const initial = { base: 8, tablet: 12, desktop: 16 };
    const result = writeScopedValue(initial, 'base', 24, 0);
    expect(result).toEqual({ base: 24, tablet: 12, desktop: 16 });
  });

  it('writes desktop override without changing base', () => {
    const initial = { base: 8 };
    const result = writeScopedValue(initial, 'desktop', 32, 0);
    expect(result).toEqual({ base: 8, desktop: 32 });
    expect(readScopedValue(result, 'base', 0)).toBe(8);
    expect(readScopedValue(result, 'desktop', 0)).toBe(32);
  });

  it('writes tablet override without changing base or desktop', () => {
    const initial = { base: 8, desktop: 20 };
    const result = writeScopedValue(initial, 'tablet', 12, 0);
    expect(result).toEqual({ base: 8, tablet: 12, desktop: 20 });
  });

  it('coerces plain values before writing scoped override', () => {
    const result = writeScopedValue(8, 'desktop', 32, 0);
    expect(result).toEqual({ base: 8, desktop: 32 });
    expect(readScopedValue(result, 'base', 0)).toBe(8);
  });

  it('preserves plain base when writing desktop override for gap-like defaults', () => {
    const result = writeScopedValue(24, 'desktop', 48, 0);
    expect(result).toEqual({ base: 24, desktop: 48 });
    expect(readScopedValue(result, 'base', 0)).toBe(24);
    expect(readScopedValue(result, 'tablet', 0)).toBe(24);
    expect(readScopedValue(result, 'desktop', 0)).toBe(48);
  });
});

describe('clearScopedOverride', () => {
  it('removes desktop override only', () => {
    const value = { base: 8, desktop: 32 };
    expect(clearScopedOverride(value, 'desktop', 0)).toEqual({ base: 8 });
    expect(readScopedValue(value, 'base', 0)).toBe(8);
  });
});
