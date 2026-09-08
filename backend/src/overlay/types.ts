// Overlay resolution — shared types (build/composition-time only).
//
// The overlay layer resolves a per-deployment source set = core modules PLUS a
// deployment's overlay modules, deterministically at build/composition time.
// See specs/103-overlay-shadowing-retirement/contracts/override-manifest-v2.md,
// which supersedes feature 057's override-manifest and overlay-resolution
// contracts.
//
// The overridable-unit taxonomy that used to live here — `OverridableKind`,
// `RejectedKind`, `UnitKind`, `OverlayContribution`, `ResolvedOverride`,
// `unitKey`, `OverrideEntry` — is gone with the mechanism it described (D-201).
// An overlay module owns every file it ships; nothing shadows a core unit, so
// there is no unit to key, group or classify.
//
// **This file stayed in the application when the loader moved**
// (`specs/110-instance-repository/` T114), and the reason is the paragraph
// below: every deployment's generated divergence artefact names it by a
// **relative** path, deliberately, so that a committed artefact's import does
// not depend on that deployment's own dependency graph. A bare specifier here
// would be the one committed artefact that stops being readable in a tree which
// has not installed the package.

/**
 * The committed, per-deployment divergence report — re-exported from
 * `@endora-commerce/contracts`, where the shape is published.
 *
 * It is re-exported here rather than imported at each site because the emitted
 * artefact names *this* module by a relative path: a generated file under
 * `src/apps/<deployment>/` that reached for a bare specifier would be the one
 * committed artefact whose import depends on the deployment's own dependency
 * graph rather than on the tree it sits in.
 *
 * The shape supersedes v2's `OverrideManifest`
 * (`specs/107-override-report-and-ladder/contracts/divergence-report.md`, which
 * supersedes `specs/103-…/contracts/override-manifest-v2.md` §1–§2). That one
 * recorded one fact — which overlay modules a deployment adds — and the field
 * survives as `overlayModules`.
 */
export type {
  DivergenceBoundary,
  DivergenceDetail,
  DivergenceEntry,
  DivergenceKey,
  DivergenceKind,
  DivergenceReport,
} from '@endora-commerce/contracts';

/**
 * Result of resolving a deployment overlay.
 *
 * Declared in `@endora-commerce/platform/overlay` since
 * `specs/110-instance-repository/` T114 and re-exported here: the resolution is
 * the loader's, and no committed artefact names this type, so nothing held it to
 * this file the way the divergence shapes above are held to it.
 */
export type { OverlayResolution } from '@endora-commerce/platform/overlay';
