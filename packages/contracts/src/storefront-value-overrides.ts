import type { ScopeLevel } from './product-scope-model.js';
import { resolveAttribute, type OverrideRow } from './product-value-resolver.js';

/**
 * Issue #384, rewritten by feature 168 (research R1) — the effective Name, Description or
 * attribute a storefront read shows at the request's (channel, language), given the override
 * rows it already holds.
 *
 * Shared by every storefront read that shows a product's text — `catalog`'s product page and
 * listing cards, and `search`'s result cards — so one product cannot show two names depending on
 * which module answered. The chain is {@link resolveAttribute}'s (C×L → C → G); there is no
 * per-language baseline walk any more: the Global value is one string (FR-014).
 */

/** The request's resolution context: the resolved channel and its content language. */
export interface StorefrontOverrideContext {
  channelId: string;
  /** Already resolved against the channel; `null` = the channel scope only. */
  languageCode: string | null;
}

const TEXT_LEVELS: readonly ScopeLevel[] = ['G', 'C', 'CL'];

/**
 * The effective value of one field at `ctx`: the C×L row, else the C row, else `global`; an
 * empty override answers `null`.
 */
export function effectiveScopedValue(
  overrides: readonly OverrideRow[] | undefined,
  attributeKey: string,
  levels: readonly ScopeLevel[],
  ctx: StorefrontOverrideContext,
  global: unknown,
): unknown {
  return resolveAttribute({ attributeKey, baseline: global, overrides: overrides ?? [], levels, ctx }).value;
}

/**
 * The effective Name or Description at `ctx`: `null` when the answer is an empty override (a
 * description deliberately left empty) or there is no value at all.
 */
export function effectiveSystemText(
  overrides: readonly OverrideRow[] | undefined,
  attributeKey: 'name' | 'description',
  ctx: StorefrontOverrideContext,
  global: string | null,
): string | null {
  const value = effectiveScopedValue(overrides, attributeKey, TEXT_LEVELS, ctx, global);
  return typeof value === 'string' ? value : null;
}
