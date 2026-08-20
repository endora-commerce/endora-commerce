import type { DisplayMode } from '@b2b/contracts';

/**
 * Pure display-mode resolver (feature 011 / FR-039).
 *
 * Walks the chain Product → Category → Organization → Settings (default for
 * signed-in, unauthenticated for guests) and returns the first non-`inherit`
 * value. Guests carry `organizationId === null`, in which case the
 * Organization-level lookup is skipped.
 *
 * The category-level lookup picks the most specific category override the
 * product belongs to — defined as the deepest category in the tree, with
 * a deterministic tie-break on `(sort_order asc, id asc)`. The category
 * depth + tie-break logic lives at the SQL layer; this pure resolver just
 * receives the already-picked override row (or null).
 */
export type CustomerKind = 'guest' | 'signed_in';

export type ResolvedFrom =
  | 'product'
  | 'category'
  | 'organization'
  | 'settings.default'
  | 'settings.unauthenticated';

export interface DisplayModeOverrideLookup {
  /** Product-level override row or null. */
  productOverride: DisplayMode | null;
  /** Most-specific category-level override the product belongs to, or null. */
  categoryOverride: DisplayMode | null;
  /** Organization-level override or null (also null for guests). */
  organizationOverride: DisplayMode | null;
}

export interface SettingsDefaults {
  defaultDisplayMode: DisplayMode;
  unauthenticatedDisplayMode: DisplayMode;
}

export interface ResolvedDisplayMode {
  mode: DisplayMode;
  resolvedFrom: ResolvedFrom;
}

export function resolveDisplayMode(
  customer: CustomerKind,
  overrides: DisplayModeOverrideLookup,
  settings: SettingsDefaults,
): ResolvedDisplayMode {
  if (overrides.productOverride !== null) {
    return { mode: overrides.productOverride, resolvedFrom: 'product' };
  }
  if (overrides.categoryOverride !== null) {
    return { mode: overrides.categoryOverride, resolvedFrom: 'category' };
  }
  if (customer === 'signed_in' && overrides.organizationOverride !== null) {
    return { mode: overrides.organizationOverride, resolvedFrom: 'organization' };
  }
  if (customer === 'guest') {
    return {
      mode: settings.unauthenticatedDisplayMode,
      resolvedFrom: 'settings.unauthenticated',
    };
  }
  return { mode: settings.defaultDisplayMode, resolvedFrom: 'settings.default' };
}

/**
 * One category-scope override, with the three fields the chain ranks it by.
 *
 * `resolveDisplayMode` above receives the already-picked override; the ranking
 * that picks it used to live inline in `PriceListService`, which is why the
 * batched path could have ranked differently from the per-product one. It is
 * here now, so both hand their candidates to the same comparator.
 */
export interface DisplayModeCategoryCandidate {
  mode: DisplayMode;
  /** Ancestors above the category itself — deeper is more specific. */
  depth: number;
  sortOrder: number;
  categoryId: string;
}

/** Most specific first: deepest, then `(sort_order asc, id asc)` as tie-break. */
export function pickCategoryOverride(
  candidates: readonly DisplayModeCategoryCandidate[],
): DisplayModeCategoryCandidate | null {
  let best: DisplayModeCategoryCandidate | null = null;
  for (const candidate of candidates) {
    if (best === null) {
      best = candidate;
      continue;
    }
    if (candidate.depth !== best.depth) {
      if (candidate.depth > best.depth) best = candidate;
      continue;
    }
    if (candidate.sortOrder !== best.sortOrder) {
      if (candidate.sortOrder < best.sortOrder) best = candidate;
      continue;
    }
    if (candidate.categoryId.localeCompare(best.categoryId) < 0) best = candidate;
  }
  return best;
}

export type DisplayModeDecision =
  | { source: 'product' | 'category' | 'organization'; mode: DisplayMode }
  | { source: 'settings' };

/**
 * The chain's decision with the settings tier left **unread**.
 *
 * The eager `resolveDisplayMode` above wants both settings values in hand,
 * which is one query per product on a listing page and two more on a cart line
 * that an override already answered. This form names the settings step instead
 * of taking its value, so the per-product path reads the pair only when it is
 * reached and the batched path reads it once for the whole page.
 *
 * `organizationOverride` is the caller's answer to "is this a signed-in
 * customer with an organization" — a guest passes `null`, exactly as the
 * eager resolver's `customer === 'signed_in'` guard requires.
 */
export function decideDisplayMode(inputs: {
  productOverride: DisplayMode | null;
  categoryCandidates: readonly DisplayModeCategoryCandidate[];
  organizationOverride: DisplayMode | null;
}): DisplayModeDecision {
  if (inputs.productOverride !== null) {
    return { source: 'product', mode: inputs.productOverride };
  }
  const category = pickCategoryOverride(inputs.categoryCandidates);
  if (category !== null) return { source: 'category', mode: category.mode };
  if (inputs.organizationOverride !== null) {
    return { source: 'organization', mode: inputs.organizationOverride };
  }
  return { source: 'settings' };
}

/** Which `pricing.*` settings key answers for this customer kind. */
export function settingsDisplayModeKey(
  customer: CustomerKind,
): 'default_display_mode' | 'unauthenticated_display_mode' {
  return customer === 'guest' ? 'unauthenticated_display_mode' : 'default_display_mode';
}
