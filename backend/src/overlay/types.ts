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

/** The committed, per-deployment override-manifest artifact (v2). */
export interface OverrideManifest {
  /** Deployment name, or `'core'` for the bare-core build. */
  deployment: string;
  /**
   * The overlay root read, repo-relative; `null` for a bare-core build.
   *
   * Still an object rather than a bare `overlayRoot: string | null`, because a
   * deployment build genuinely has one input path and recording it is what
   * makes the artefact reproducible. Its sibling `coreRoot` recorded
   * `backend/src/modules`, which has held no module since 2026-08-28: the path
   * a scan read is worth recording only while the scan classifies against it,
   * and v2 has no core scan.
   */
  generatedFrom: { overlayRoot: string | null };
  /** Overlay-only module ids this deployment adds, sorted. */
  newModules: string[];
}

/** Result of resolving a deployment overlay. */
export interface OverlayResolution {
  deployment: string | null;
  newModules: string[];
}
