import { describe, expect, it } from 'vitest';
import {
  buildResponsiveColumnCountVars,
  buildResponsiveSpanVars,
  buildResponsiveSpacingVars,
  borderToCss,
  clampColumnSpan,
  gridTemplateColumnsFromCount,
  normalizeBorder,
  normalizeSpacing,
  resolveColumnCount,
  resolveColumnSpan,
  spacingToCss,
} from './box-styles.js';

describe('normalizeSpacing', () => {
  it('defaults missing value to uniform zero', () => {
    expect(normalizeSpacing(undefined)).toEqual({ mode: 'uniform', value: 0 });
  });

  it('clamps negative sides to zero', () => {
    expect(
      normalizeSpacing({ mode: 'sides', top: -4, right: 8, bottom: 0, left: 2 }),
    ).toEqual({ mode: 'sides', top: 0, right: 8, bottom: 0, left: 2 });
  });
});

describe('spacingToCss', () => {
  it('serializes uniform spacing', () => {
    expect(spacingToCss({ mode: 'uniform', value: 12 })).toBe('12px');
  });

  it('serializes per-side spacing', () => {
    expect(spacingToCss({ mode: 'sides', top: 4, right: 8, bottom: 12, left: 16 })).toBe(
      '4px 8px 12px 16px',
    );
  });
});

describe('normalizeBorder', () => {
  it('treats zero width as none', () => {
    expect(normalizeBorder({ mode: 'uniform', width: 0, style: 'solid', color: '#000' })).toEqual({
      mode: 'none',
    });
  });

  it('keeps uniform border', () => {
    expect(normalizeBorder({ mode: 'uniform', width: 2, style: 'dashed', color: '#abc' })).toEqual({
      mode: 'uniform',
      width: 2,
      style: 'dashed',
      color: '#abc',
    });
  });
});

describe('borderToCss', () => {
  it('returns undefined for none', () => {
    expect(borderToCss({ mode: 'none' })).toBeUndefined();
  });

  it('serializes uniform border', () => {
    expect(borderToCss({ mode: 'uniform', width: 1, style: 'solid', color: '#ccc' })).toBe(
      '1px solid #ccc',
    );
  });
});

describe('buildResponsiveSpacingVars', () => {
  it('emits tiered CSS variables', () => {
    expect(
      buildResponsiveSpacingVars('padding', {
        base: { mode: 'uniform', value: 8 },
        tablet: { mode: 'uniform', value: 16 },
      }),
    ).toEqual({
      '--pb-padding': '8px 8px 8px 8px',
      '--pb-padding-md': '16px 16px 16px 16px',
      '--pb-padding-lg': '16px 16px 16px 16px',
    });
  });
});

describe('column count helpers', () => {
  it('clamps column count to 1–12', () => {
    expect(resolveColumnCount(0, 'mobile')).toBe(1);
    expect(resolveColumnCount(20, 'desktop')).toBe(12);
    expect(resolveColumnCount({ base: 4, desktop: 6 }, 'desktop')).toBe(6);
  });

  it('builds grid template columns', () => {
    expect(gridTemplateColumnsFromCount(3)).toBe('repeat(3, minmax(0, 1fr))');
  });

  it('builds responsive column CSS vars', () => {
    expect(buildResponsiveColumnCountVars({ base: 1, tablet: 2, desktop: 4 })).toEqual({
      '--pb-cols': '1',
      '--pb-cols-md': '2',
      '--pb-cols-lg': '4',
    });
  });
});

describe('column span helpers', () => {
  it('clamps span to 1–12', () => {
    expect(clampColumnSpan(0)).toBe(1);
    expect(clampColumnSpan(20)).toBe(12);
    expect(resolveColumnSpan({ base: 6, desktop: 4 }, 'desktop')).toBe(4);
  });

  it('builds responsive span CSS vars', () => {
    expect(buildResponsiveSpanVars({ base: 12, tablet: 6, desktop: 4 })).toEqual({
      '--pb-col-span': '12',
      '--pb-col-span-md': '6',
      '--pb-col-span-lg': '4',
    });
  });
});
