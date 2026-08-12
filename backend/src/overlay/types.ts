// Overlay resolution — shared types (build/composition-time only).
//
// The overlay layer resolves a per-deployment source set = core modules PLUS a
// deployment's overlay modules, deterministically at build/composition time.
// These types describe the overridable-unit taxonomy and the resolver output.
// See specs/057-overlay-pattern-multideploy/data-model.md.

/**
 * The kinds of core unit an overlay may replace. Schema-level units (entities,
 * migrations) are intentionally excluded — see `RejectedKind`.
 *
 * **`service` was removed in feature 072 (T067).** A service override no longer
 * shadows a file: it decorates a container registration
 * (`ctx.di.decorate`, D-28), which wraps core and delegates instead of
 * replacing it. Replacement is the reason a client override stops receiving
 * core fixes the day it is written; whatever core does to that method next
 * happens in a file the deployment no longer runs. Nothing needs to classify a
 * decoration by path, so the kind has no successor here.
 */
export type OverridableKind = 'route' | 'config';

/** Path classifications the resolver refuses to override in v1. */
export type RejectedKind = 'schema' | 'other';

export type UnitKind = OverridableKind | RejectedKind;

/**
 * One overlay file that targets a core unit. Produced by the overlay scan;
 * grouped by `unitKey()` to detect conflicts.
 */
export interface OverlayContribution {
  /** Owning core module id (folder name), e.g. `price_lists`. */
  moduleId: string;
  /** Overridable kind of the targeted unit. */
  kind: OverridableKind;
  /** Module-relative POSIX path of the unit, e.g. `services/pricing-service.ts`. */
  relPath: string;
  /** Absolute path to the overlay file. */
  overlayPath: string;
  /** Absolute path to the shadowed core file. */
  corePath: string;
}

/** Resolver output for a single core unit that an overlay replaced. */
export interface ResolvedOverride extends OverlayContribution {
  source: 'overlay';
  deployment: string;
}

/**
 * Stable grouping key for conflict detection: two contributions with the same
 * key target the same core unit and MUST NOT silently last-wins (FR-007).
 */
export function unitKey(c: Pick<OverlayContribution, 'moduleId' | 'kind' | 'relPath'>): string {
  return `${c.moduleId}:${c.kind}:${c.relPath}`;
}

/** One entry in the emitted override manifest (see contracts/override-manifest.md). */
export interface OverrideEntry {
  moduleId: string;
  kind: OverridableKind;
  unitKey: string;
  /** Repo-relative POSIX path to the overlay file (deterministic, no absolute paths). */
  overlayPath: string;
}

/** The committed, per-deployment override-manifest artifact. */
export interface OverrideManifest {
  /** Deployment name, or `'core'` for the bare-core build. */
  deployment: string;
  /** Scan roots used, repo-relative, for reproducibility. */
  generatedFrom: { coreRoot: string; overlayRoot: string | null };
  /** Every core unit replaced by an overlay, sorted by (moduleId, kind, unitKey). */
  overrides: OverrideEntry[];
  /** Overlay-only module ids added to the resolved set, sorted. */
  newModules: string[];
}

/** Result of resolving core + a deployment overlay. */
export interface OverlayResolution {
  deployment: string | null;
  overrides: ResolvedOverride[];
  newModules: string[];
}
