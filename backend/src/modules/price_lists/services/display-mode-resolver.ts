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
