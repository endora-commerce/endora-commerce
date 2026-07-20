// Overlay resolution — shared types (build/composition-time only).
//
// The overlay layer resolves a per-deployment source set = core modules PLUS a
// deployment's overlay modules, deterministically at build/composition time.
// These types describe the overridable-unit taxonomy and the resolver output.
// See specs/057-overlay-pattern-multideploy/data-model.md.

/**
 * The kinds of core unit an overlay may replace in v1. Schema-level units
 * (entities, migrations) are intentionally excluded — see `RejectedKind`.
 */
export type OverridableKind = 'service' | 'route' | 'config';

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
  /**
   * For a `service` override: module-relative POSIX path of the core interface
   * file the overlay must satisfy (e.g. `services/pricing-service.interface.ts`).
   * `null` for `route`/`config` (no interface gate — see core-interfaces.md).
   */
  interfaceRelPath: string | null;
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
  /** Repo-relative POSIX path of the core interface checked, or `null`. */
  satisfiesInterface: string | null;
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
