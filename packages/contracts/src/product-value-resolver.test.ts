import { describe, expect, it } from 'vitest';
import {
  overrideToScopedRow,
  resolveAll,
  resolveAttribute,
  scopeOfContext,
  type OverrideRow,
  type ResolverContext,
} from './product-value-resolver.js';
import type { ScopeLevel } from './product-scope-model.js';

/**
 * Feature 022, rewritten by feature 168 (R1) — the override-table adapter over `resolveScoped`.
 * The chain itself is tested in `product-scope-model.test.ts`; this file holds the adapter: row
 * shape, `{ v: null }` as the empty override, key filtering, and the context → scope mapping.
 */

const KEY = 'attr';
const ALL: readonly ScopeLevel[] = ['G', 'C', 'CL'];
const GC: readonly ScopeLevel[] = ['G', 'C'];

const ctx = (channelId: string | null, languageCode: string | null): ResolverContext => ({ channelId, languageCode });
const row = (channelId: string, languageCode: string | null, v: unknown, attributeKey = KEY): OverrideRow => ({
  attributeKey,
  channelId,
  languageCode,
  value: { v },
});

describe('resolveAttribute (adapter)', () => {
  it('Global context reads the baseline only', () => {
    expect(resolveAttribute({ attributeKey: KEY, baseline: 'X', overrides: [row('c1', null, 'C')], levels: ALL, ctx: ctx(null, null) })).toEqual({
      value: 'X',
      source: 'set',
    });
  });

  it('C×L hit, then channel, then Global', () => {
    const overrides = [row('c1', 'pl', 'PL'), row('c1', null, 'C')];
    expect(resolveAttribute({ attributeKey: KEY, baseline: 'G', overrides, levels: ALL, ctx: ctx('c1', 'pl') }).source).toBe('set');
    expect(resolveAttribute({ attributeKey: KEY, baseline: 'G', overrides, levels: ALL, ctx: ctx('c1', 'de') })).toEqual({
      value: 'C',
      source: 'inherited_channel',
    });
    expect(resolveAttribute({ attributeKey: KEY, baseline: 'G', overrides: [], levels: ALL, ctx: ctx('c1', 'de') })).toEqual({
      value: 'G',
      source: 'inherited_global',
    });
  });

  it('{ v: null } is an empty override, never skipped (fixes F-a)', () => {
    expect(
      resolveAttribute({ attributeKey: KEY, baseline: 'G', overrides: [row('c1', 'pl', null)], levels: ALL, ctx: ctx('c1', 'pl') }),
    ).toEqual({ value: null, source: 'set_empty' });
    expect(
      resolveAttribute({ attributeKey: KEY, baseline: 'G', overrides: [row('c1', 'pl', '')], levels: ALL, ctx: ctx('c1', 'pl') }),
    ).toEqual({ value: '', source: 'set' });
  });

  it('an orphaned C×L row of a {G,C} attribute is ignored', () => {
    expect(
      resolveAttribute({ attributeKey: KEY, baseline: 5, overrides: [row('c1', 'pl', 9)], levels: GC, ctx: ctx('c1', 'pl') }),
    ).toEqual({ value: 5, source: 'inherited_global' });
  });

  it('only rows of the attribute key count', () => {
    expect(
      resolveAttribute({ attributeKey: KEY, baseline: 'G', overrides: [row('c1', null, 'other', 'other')], levels: ALL, ctx: ctx('c1', null) }),
    ).toEqual({ value: 'G', source: 'inherited_global' });
  });

  it('no baseline and no row is absent', () => {
    expect(resolveAttribute({ attributeKey: KEY, baseline: undefined, overrides: [], levels: ALL, ctx: ctx('c1', 'pl') })).toEqual({
      value: null,
      source: 'absent',
    });
  });
});

describe('scopeOfContext / overrideToScopedRow', () => {
  it('maps a context to a scope', () => {
    expect(scopeOfContext(ctx(null, null))).toEqual({ level: 'global' });
    expect(scopeOfContext(ctx(null, 'pl'))).toEqual({ level: 'global' });
    expect(scopeOfContext(ctx('c1', null))).toEqual({ level: 'channel', channelId: 'c1' });
    expect(scopeOfContext(ctx('c1', 'pl'))).toEqual({ level: 'channel_language', channelId: 'c1', languageCode: 'pl' });
  });

  it('wraps a row value', () => {
    expect(overrideToScopedRow(row('c1', null, 3)).value).toEqual({ kind: 'value', value: 3 });
    expect(overrideToScopedRow(row('c1', null, null)).value).toEqual({ kind: 'empty' });
  });
});

describe('resolveAll', () => {
  it('resolves each definition with its own levels', () => {
    const result = resolveAll(
      [
        { attributeKey: 'name', levels: ALL, baseline: 'Drill' },
        { attributeKey: 'size', levels: GC, baseline: 3 },
      ],
      [row('c1', 'pl', 'Wiertarka', 'name'), row('c1', 'pl', 9, 'size')],
      ctx('c1', 'pl'),
    );
    expect(result.values).toEqual({ name: 'Wiertarka', size: 3 });
    expect(result.sources).toEqual({ name: 'set', size: 'inherited_global' });
  });
});
