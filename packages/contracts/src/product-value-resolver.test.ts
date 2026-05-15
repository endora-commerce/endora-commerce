import { describe, expect, it } from 'vitest';
import { resolveAttribute } from './product-value-resolver.js';
import type {
  AttributeScope,
  OverrideRow,
  ResolverContext,
} from './product-value-resolver.js';

const KEY = 'attr';

const scope = (channelScoped: boolean, languageScoped: boolean): AttributeScope => ({
  channelScoped,
  languageScoped,
});

const ctx = (
  channelId: string | null,
  languageCode: string | null,
  primaryLanguage = 'pl',
): ResolverContext => ({ channelId, languageCode, primaryLanguage });

const row = (
  channelId: string,
  languageCode: string | null,
  v: unknown,
  attributeKey = KEY,
): OverrideRow => ({ attributeKey, channelId, languageCode, value: { v } });

/**
 * Matrix from specs/022-product-scope-editor/contracts/resolver.contract.md §5.
 * Every row exercises one combination of (attribute scope, ctx, baseline,
 * overrides) and asserts the resolver returns the expected (value, source).
 */
describe('resolveAttribute — 12-row contract matrix', () => {
  it('row 1: global-only attribute, no ctx, scalar baseline', () => {
    const result = resolveAttribute({
      attributeKey: KEY,
      baseline: 'X',
      overrides: [],
      scope: scope(false, false),
      ctx: ctx(null, null),
    });
    expect(result).toEqual({ value: 'X', source: 'global' });
  });

  it('row 2: language-scoped, pl ctx, direct hit', () => {
    const result = resolveAttribute({
      attributeKey: KEY,
      baseline: { pl: 'Polski', en: 'English' },
      overrides: [],
      scope: scope(false, true),
      ctx: ctx(null, 'pl'),
    });
    expect(result).toEqual({ value: 'Polski', source: 'global+language' });
  });

  it('row 3: language-scoped, de ctx, falls back to primary then any', () => {
    const result = resolveAttribute({
      attributeKey: KEY,
      baseline: { pl: 'Polski' },
      overrides: [],
      scope: scope(false, true),
      ctx: ctx(null, 'de'),
    });
    expect(result).toEqual({ value: 'Polski', source: 'global' });
  });

  it('row 4: channel-only, hit', () => {
    const result = resolveAttribute({
      attributeKey: KEY,
      baseline: 'baseline',
      overrides: [row('c1', null, 'override')],
      scope: scope(true, false),
      ctx: ctx('c1', null),
    });
    expect(result).toEqual({ value: 'override', source: 'channel' });
  });

  it('row 5: channel-only, no override, falls back to baseline', () => {
    const result = resolveAttribute({
      attributeKey: KEY,
      baseline: 'baseline',
      overrides: [],
      scope: scope(true, false),
      ctx: ctx('c1', null),
    });
    expect(result).toEqual({ value: 'baseline', source: 'global' });
  });

  it('row 6: channel+language, channel+lang hit', () => {
    const result = resolveAttribute({
      attributeKey: KEY,
      baseline: { pl: 'P', en: 'E' },
      overrides: [row('c1', 'en', 'CL-en')],
      scope: scope(true, true),
      ctx: ctx('c1', 'en'),
    });
    expect(result).toEqual({ value: 'CL-en', source: 'channel+language' });
  });

  it('row 7: channel+language, only channel-only override exists', () => {
    const result = resolveAttribute({
      attributeKey: KEY,
      baseline: { pl: 'P', en: 'E' },
      overrides: [row('c1', null, 'C-only')],
      scope: scope(true, true),
      ctx: ctx('c1', 'en'),
    });
    expect(result).toEqual({ value: 'C-only', source: 'channel' });
  });

  it('row 8: channel+language, falls back to global+language', () => {
    const result = resolveAttribute({
      attributeKey: KEY,
      baseline: { pl: 'P', en: 'E' },
      overrides: [],
      scope: scope(true, true),
      ctx: ctx('c1', 'en'),
    });
    expect(result).toEqual({ value: 'E', source: 'global+language' });
  });

  it('row 9: channel+language, de ctx missing → primary language fallback', () => {
    const result = resolveAttribute({
      attributeKey: KEY,
      baseline: { pl: 'P' },
      overrides: [],
      scope: scope(true, true),
      ctx: ctx('c1', 'de'),
    });
    expect(result).toEqual({ value: 'P', source: 'global' });
  });

  it('row 10: channel+language, no channel ctx → falls through to baseline', () => {
    const result = resolveAttribute({
      attributeKey: KEY,
      baseline: { pl: 'P' },
      overrides: [row('c1', 'en', 'CL-en')],
      scope: scope(true, true),
      ctx: ctx(null, null),
    });
    expect(result).toEqual({ value: 'P', source: 'global' });
  });

  it('row 11: channel+language, empty baseline & no overrides → absent', () => {
    const result = resolveAttribute({
      attributeKey: KEY,
      baseline: {},
      overrides: [],
      scope: scope(true, true),
      ctx: ctx('c1', 'en'),
    });
    expect(result).toEqual({ value: null, source: 'absent' });
  });

  it('row 12: orphan override is ignored when scope is global-only', () => {
    const result = resolveAttribute({
      attributeKey: KEY,
      baseline: 'X',
      overrides: [row('c1', 'en', 'orphan')],
      scope: scope(false, false),
      ctx: ctx('c1', 'en'),
    });
    expect(result).toEqual({ value: 'X', source: 'global' });
  });
});

describe('resolveAttribute — additional edge cases', () => {
  it('empty string baseline is treated as absent for language-scoped attrs', () => {
    const result = resolveAttribute({
      attributeKey: KEY,
      baseline: { pl: '', en: 'English' },
      overrides: [],
      scope: scope(false, true),
      ctx: ctx(null, 'pl', 'pl'),
    });
    expect(result.value).toBe('English');
    expect(result.source).toBe('global');
  });

  it('only returns matching attributeKey from the overrides bag', () => {
    const result = resolveAttribute({
      attributeKey: KEY,
      baseline: 'baseline',
      overrides: [
        row('c1', null, 'wrong-key', 'other_attr'),
        row('c1', null, 'correct'),
      ],
      scope: scope(true, false),
      ctx: ctx('c1', null),
    });
    expect(result.value).toBe('correct');
  });
});
