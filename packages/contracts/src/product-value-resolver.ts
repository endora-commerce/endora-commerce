/**
 * Feature 022, rewritten by feature 168 (`specs/168-product-editor-scope-switcher/`, research R1) —
 * the product value resolver over `product_value_overrides` rows.
 *
 * The fallback chain is {@link resolveScoped}'s — C×L → C → G, restricted to the field's scope
 * set, a present row winning whatever it holds and `{ "v": null }` being an empty override
 * (FR-013). This file only adapts the override table's row shape to {@link ScopedRow}; it adds no
 * second chain. There is no Language level and no "primary language" (FR-010, FR-014): the Global
 * value is one value.
 *
 * Shared by the backend and the admin SPA through `@endora-commerce/contracts`.
 */

import {
  resolveScoped,
  type ScopeLevel,
  type ScopeRef,
  type ScopedResolution,
  type ScopedRow,
  type ScopedSource,
} from './product-scope-model.js';

/**
 * An attribute's scope flag (feature 168, R15): a scopable attribute may carry Channel and — for
 * text — Channel × language overrides. The levels derive from the flag and the value type
 * (`attributeScopeSet`).
 */
export type AttributeScope = {
  scopable: boolean;
};

/** The context a value is resolved in: no channel → Global; a channel without a language → C. */
export type ResolverContext = {
  channelId: string | null;
  languageCode: string | null;
};

export type OverrideRow = {
  attributeKey: string;
  channelId: string;
  languageCode: string | null;
  /** `{ v: null }` is an empty override (FR-013). */
  value: { v: unknown };
};

/** Where an effective value comes from — {@link ScopedSource}. */
export type ResolvedSource = ScopedSource;

export type Resolved = ScopedResolution<unknown>;

/**
 * Whether a value counts as present: not `undefined` / `null`, and not an empty string, array or
 * object. A helper for Global values read from a JSON column; never used to skip an override row.
 */
export function isNonEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true;
}

/** The scope a {@link ResolverContext} names. A language without a channel resolves at Global. */
export function scopeOfContext(ctx: ResolverContext): ScopeRef {
  if (ctx.channelId === null) return { level: 'global' };
  if (ctx.languageCode === null) return { level: 'channel', channelId: ctx.channelId };
  return { level: 'channel_language', channelId: ctx.channelId, languageCode: ctx.languageCode };
}

/** One override row as a {@link ScopedRow}: `{ v: null }` (or a missing `v`) is the empty override. */
export function overrideToScopedRow(row: Pick<OverrideRow, 'channelId' | 'languageCode' | 'value'>): ScopedRow<unknown> {
  const v = row.value?.v;
  return {
    channelId: row.channelId,
    languageCode: row.languageCode,
    value: v === null || v === undefined ? { kind: 'empty' } : { kind: 'value', value: v },
  };
}

export type ResolveAttributeArgs = {
  /** The Global value: `products.name` / `.description`, or `attribute_values[key]`. */
  baseline: unknown;
  /** Overrides pre-filtered to a single product. */
  overrides: readonly OverrideRow[];
  attributeKey: string;
  /** The field's scope set. */
  levels: readonly ScopeLevel[];
  ctx: ResolverContext;
};

/** Resolve one attribute value in `ctx`. Rows of another key, channel or language never match. */
export function resolveAttribute(args: ResolveAttributeArgs): Resolved {
  const rows = args.overrides.filter((o) => o.attributeKey === args.attributeKey).map(overrideToScopedRow);
  return resolveScoped({
    global: args.baseline === undefined ? null : args.baseline,
    rows,
    scope: scopeOfContext(args.ctx),
    levels: args.levels,
  });
}

export type AttributeDef = {
  attributeKey: string;
  levels: readonly ScopeLevel[];
  baseline: unknown;
};

export type ResolveAllResult = {
  values: Record<string, unknown>;
  sources: Record<string, ResolvedSource>;
};

/** Resolve every attribute of one product in one context. */
export function resolveAll(
  attributeDefs: readonly AttributeDef[],
  overrides: readonly OverrideRow[],
  ctx: ResolverContext,
): ResolveAllResult {
  const values: Record<string, unknown> = {};
  const sources: Record<string, ResolvedSource> = {};
  for (const def of attributeDefs) {
    const { value, source } = resolveAttribute({
      attributeKey: def.attributeKey,
      baseline: def.baseline,
      levels: def.levels,
      overrides,
      ctx,
    });
    values[def.attributeKey] = value;
    sources[def.attributeKey] = source;
  }
  return { values, sources };
}
