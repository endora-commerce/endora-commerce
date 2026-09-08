import type { AdminI18nTranslatePort, AdminUserReadPort } from '@endora-commerce/contracts';
import type { ErrorEnvelopeOptions } from '../../http/error-envelope.js';
import { createRequestLanguageResolver } from './request-language.js';

/**
 * What a composition supplies: the deployment's routing table, and the two
 * container reads the envelope's injected callbacks are built over.
 *
 * The two reads are **thunks**, and that is the contract rather than a style:
 * each names a gated port, so it resolves per call and a switched-off owner
 * answers at the call site instead of through a handle the composition is
 * holding. Capturing either at composition time is the shape D-70 keeps
 * removing from a composition root.
 */
export interface ErrorEnvelopeCompositionInputs {
  /**
   * `ErrorCode → {moduleId, key}` for the deployment's own resolved manifest
   * set — `buildErrorTranslationTargets`' output, which is a composition input
   * because which modules a deployment resolved is a composition's fact.
   */
  readonly errorTranslationTargets: NonNullable<ErrorEnvelopeOptions['errorTranslationTargets']>;
  /** Owner: `admin_users`. The stored preference of a signed-in admin. */
  readonly adminUserReadPort: () => AdminUserReadPort;
  /** Owner: `_i18n`. The lookup, over the merged bundle. */
  readonly translate: () => AdminI18nTranslatePort;
}

/**
 * The error envelope's options, assembled from what a composition supplies
 * (`specs/110-instance-repository/` T118).
 *
 * **Written here because both composition roots had it, character for
 * character.** The production root and `backend/test/helpers/test-server.ts`
 * each carried the same twenty lines — the same language ladder, the same
 * `translated === \`${moduleId}.${key}\`` test — and
 * `test/contract/kernel/harness-parity.test.ts` exists precisely because a
 * difference between two hand-maintained roots is a class of defect the suite
 * reports green on. Issue #234 is the standing proof: both roots' language
 * closure read `if (request.actor.kind !== 'admin') return null`, so every
 * Polish error sentence the platform shipped was unreachable for a buyer, in
 * production and in every test at once. One declaration cannot drift from
 * itself.
 *
 * The two decisions it owns, and neither is a root's:
 *
 *  - **the language ladder** is `createRequestLanguageResolver`'s (D-137), and
 *    what a root supplies to it is the one rung that reads a module's table;
 *  - **"the lookup found nothing" is `moduleId.key` coming back**, which is
 *    `_i18n`'s answer for a key it cannot resolve. Reading it as a miss and
 *    keeping the raising code's own sentence is the envelope's rule, not the
 *    deployment's, so it belongs beside the envelope.
 *
 * What stays a composition's is the two container reads and the target map,
 * which is why they arrive as parameters — the platform may not name the module
 * that registers a container name (D-52/D-53), and which modules a deployment
 * resolved is a fact only its own root holds.
 */
export function composeErrorEnvelopeOptions(
  inputs: ErrorEnvelopeCompositionInputs,
): ErrorEnvelopeOptions {
  return {
    errorTranslationTargets: inputs.errorTranslationTargets,
    // Issue #234 — the ladder is one kernel function, and the composition keeps
    // the one rung that reads a module's table (D-137).
    resolvePreferredLanguage: createRequestLanguageResolver({
      adminPreferredLanguage: async (adminUserId) =>
        (await inputs.adminUserReadPort().findById(adminUserId))?.preferredLanguage ?? null,
    }),
    translateErrorMessage: async ({ moduleId, key, language, originalMessage, params }) => {
      const translated = await inputs.translate().translate(moduleId, key, language, params);
      return translated === `${moduleId}.${key}` ? originalMessage : translated;
    },
  };
}
