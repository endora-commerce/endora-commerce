/**
 * Feature 022 — product value resolver.
 *
 * Pure-function fusion of (baseline + channel-aware overrides) into an
 * effective value per (channelId, languageCode) context. This file
 * is the SINGLE source of truth for the four-scope fallback chain:
 * the backend imports it from `@endora-commerce/contracts` (no behavioural
 * duplication in `backend/src/modules/catalog/services/...`) and the
 * admin SPA imports it to compute its "effective-value preview"
 * client-side so switcher toggles do not need a network round-trip.
 *
 * The matrix below MUST stay aligned with
 * specs/023-product-scope-editor/contracts/resolver.contract.md §5.
 */

export type ResolverContext = {
  /** `null` = "Global / no channel" — see FR-010 / FR-040. */
  channelId: string | null;
  /** `null` = use `primaryLanguage`. */
  languageCode: string | null;
  /** Platform's primary admin language (e.g. `'pl'`). */
  primaryLanguage: string;
};

export type AttributeScope = {
  channelScoped: boolean;
  languageScoped: boolean;
};

export type OverrideRow = {
  attributeKey: string;
  channelId: string;
  languageCode: string | null;
  value: { v: unknown };
};

export type ResolvedSource =
  | 'channel+language'
  | 'channel'
  | 'global+language'
  | 'global'
  | 'absent';

export type Resolved = {
  /** Effective scalar (or `null` when no slot yielded). */
  value: unknown;
  /** Which slot produced the value (or `'absent'`). */
  source: ResolvedSource;
};

export type ResolveAttributeArgs = {
  /**
   * Raw baseline. Either a scalar (global-only attribute) or a
   * `Record<lang, value>` (language-scoped attribute). For system
   * attributes Name and Description this is the JSONB at
   * `products.name` / `products.description`.
   */
  baseline: unknown;
  /** Overrides pre-filtered to a single product. */
  overrides: readonly OverrideRow[];
  attributeKey: string;
  scope: AttributeScope;
  ctx: ResolverContext;
};

function isNonEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true;
}

function pickLang(baseline: unknown, lang: string): unknown {
  if (baseline === null || baseline === undefined) return undefined;
  if (typeof baseline !== 'object') return undefined;
  return (baseline as Record<string, unknown>)[lang];
}

function firstNonEmpty(baseline: unknown): unknown {
  if (baseline === null || baseline === undefined) return undefined;
  if (typeof baseline !== 'object') return baseline;
  const keys = Object.keys(baseline as Record<string, unknown>).sort();
  for (const k of keys) {
    const v = (baseline as Record<string, unknown>)[k];
    if (isNonEmpty(v)) return v;
  }
  return undefined;
}

/**
 * Resolve one attribute value for the given context using the four-step
 * fallback chain. The resolver is tolerant of "orphan" override rows
 * left behind when an attribute's scope flags were toggled after writes
 * happened — orphan rows are silently skipped (matrix row 12).
 */
export function resolveAttribute(args: ResolveAttributeArgs): Resolved {
  const { baseline, overrides, attributeKey, scope, ctx } = args;
  const matching = overrides.filter((o) => o.attributeKey === attributeKey);

  // Step 1 — channel + language slot.
  if (
    scope.channelScoped &&
    scope.languageScoped &&
    ctx.channelId !== null &&
    ctx.languageCode !== null
  ) {
    const hit = matching.find(
      (o) => o.channelId === ctx.channelId && o.languageCode === ctx.languageCode,
    );
    if (hit && isNonEmpty(hit.value.v)) {
      return { value: hit.value.v, source: 'channel+language' };
    }
  }

  // Step 2 — channel-only slot. Reachable when the attribute is
  // channel-scoped AND we have a channel context. Honored regardless
  // of whether the attribute is also language-scoped: a per-channel
  // "language-agnostic" override (a row written when the flag was
  // different, or a deliberate language-agnostic channel override)
  // still wins over the global baseline.
  if (scope.channelScoped && ctx.channelId !== null) {
    const hit = matching.find(
      (o) => o.channelId === ctx.channelId && o.languageCode === null,
    );
    if (hit && isNonEmpty(hit.value.v)) {
      return { value: hit.value.v, source: 'channel' };
    }
  }

  // Step 3 — global + language baseline (for language-scoped attrs).
  // Only emit source `'global+language'` when the caller asked for a
  // specific language AND we found it. When `ctx.languageCode` is null
  // (e.g., "Global / no language" admin view), the primary-language
  // fallback is reported as `'global'` so the editor's "inherited from
  // X" badge does not falsely claim a language-specific hit.
  if (scope.languageScoped) {
    if (ctx.languageCode !== null) {
      const direct = pickLang(baseline, ctx.languageCode);
      if (isNonEmpty(direct)) {
        return { value: direct, source: 'global+language' };
      }
    }
    const fallbackPrimary = pickLang(baseline, ctx.primaryLanguage);
    if (isNonEmpty(fallbackPrimary)) {
      return { value: fallbackPrimary, source: 'global' };
    }
    const anyLang = firstNonEmpty(baseline);
    if (isNonEmpty(anyLang)) {
      return { value: anyLang, source: 'global' };
    }
    return { value: null, source: 'absent' };
  }

  // Step 4 — pure global (non-language-scoped attribute).
  if (isNonEmpty(baseline)) {
    return { value: baseline, source: 'global' };
  }
  return { value: null, source: 'absent' };
}

export type AttributeDef = {
  attributeKey: string;
  scope: AttributeScope;
  /**
   * For system attributes Name and Description the baseline lives at
   * `products.name` / `products.description`. For user-defined
   * attributes the baseline is `products.attribute_values[attributeKey]`.
   * Resolver consumers populate this field once per (attribute, product)
   * pair to keep this function free of any read coupling.
   */
  baseline: unknown;
};

export type ResolveAllResult = {
  /** Effective scalar per attribute key. */
  values: Record<string, unknown>;
  /** Source per attribute key — used by the admin "inherited from X" badge. */
  sources: Record<string, ResolvedSource>;
};

/**
 * Bulk resolve every attribute for one product in one (ctx) pass.
 * Loops `attributeDefs` and applies `resolveAttribute` per entry; the
 * `sources` map is for the admin UI and may be ignored by the
 * storefront.
 */
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
      scope: def.scope,
      overrides,
      ctx,
    });
    values[def.attributeKey] = value;
    sources[def.attributeKey] = source;
  }
  return { values, sources };
}
