/**
 * Where each error code's sentence lives, for a test that needs the answer
 * synchronously (feature 090, Phase 4).
 *
 * `ERROR_TRANSLATION_KEYS` was a static table and a test could subscript it in a
 * `describe` body. Phase 4 deleted it: routing is the modules' own `errorCodes`
 * declarations, composed by `buildErrorTranslationTargets`, and the population
 * the composition roots hand that function is `resolvedManifestEntries()` —
 * which is `async`, because it discovers this deployment's overlay modules and
 * every installed package.
 *
 * This is the **committed core** half of that population, read straight out of
 * the generated manifest index, which is a plain static import. It is the right
 * source for a test asserting where a code this repository ships is routed, and
 * it is the wrong source for anything asking what a *running instance* routes —
 * for that, call `buildErrorTranslationTargets(await resolvedManifestEntries())`
 * and get the overlay and package declarations with it.
 *
 * The derivation is the one the platform runs. Nothing here re-implements the
 * collision rule or the key shape, so a test cannot come to disagree with the
 * envelope about either (D-100).
 */
import {
  buildErrorTranslationTargets,
  type ErrorTranslationTarget,
} from '@endora-commerce/mod-i18n/backend';

import { DISCOVERED_MANIFESTS } from '../../src/manifest-index.generated.js';

const composed = buildErrorTranslationTargets(
  DISCOVERED_MANIFESTS.map((entry) => ({
    manifest: entry.manifest,
    filePath: entry.manifestPath,
  })),
);

/**
 * Code → the module whose bundle holds its sentence, over the modules this
 * repository ships.
 *
 * A **contested** code is absent, exactly as it is at runtime: nobody wins
 * (`specs/090-module-owned-error-codes/contracts/error-code-declaration.md`
 * §3.1). So is a code no manifest declares — there is no fall-through since the
 * prefix chain went (§4.1), which is what `check:error-translations`' P3
 * reconciliation exists to keep true.
 */
export const DECLARED_ERROR_TRANSLATION_TARGETS: Readonly<
  Record<string, ErrorTranslationTarget>
> = composed.targets;

/** Codes more than one of this repository's modules declares. Empty, and gated. */
export const DECLARED_ERROR_CODE_COLLISIONS = composed.collisions;
