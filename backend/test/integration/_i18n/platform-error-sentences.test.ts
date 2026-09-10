import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { AdminUser } from '../../helpers/package-entities.js';
import { HttpError } from '@endora-commerce/platform/http';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

/**
 * The platform block's sentences survive the block being declared
 * (`specs/090-module-owned-error-codes/core-block-home.md` §3.2, and the
 * recommendation's step (c), which this file is the proof of).
 *
 * **Why this exists and why it is an integration test.** Phase 3 moves the
 * routing answer for `core`'s 100 codes into `@endora-commerce/mod-i18n`'s
 * manifest, so from that merge request onwards the composed map answers
 * `_i18n` where the chain answered `core`. `core` is not a module id — it is
 * the synthetic namespace `_i18n`'s bundle is exposed under
 * (`I18nService`'s `I18N_CHROME_MODULE_ID` / `CORE_NAMESPACE`, and
 * `data-model.md` §3 of feature 019) — so the merged bundle map has a `core`
 * key and **no `_i18n` key**. Measured against the built service before the
 * repair:
 *
 * ```
 * translate('core',  'errors.INTERNAL', 'pl') -> "Wewnętrzny błąd serwera."
 * translate('_i18n', 'errors.INTERNAL', 'pl') -> "_i18n.errors.INTERNAL"
 * ```
 *
 * And a placeholder is exactly what both composition roots convert **back to
 * the raiser's English message** (`composition.ts`, `test-server.ts`:
 * `translated === \`${moduleId}.${key}\` ? originalMessage : translated`). So
 * the failure mode this file refuses is silent: no throw, no log, no
 * `check:error-translations` finding — 41 codes lose their sentences in both
 * shipped languages, which is feature 090's own defect reintroduced by the
 * merge request that completes it.
 *
 * Nothing weaker can see it. A unit test over the resolver would assert the
 * resolver's own answer, and the degradation is at the **root**, one layer
 * above: the root asks for a sentence, gets a placeholder, and substitutes
 * prose that looks entirely reasonable. Only a real request that asserts the
 * **exact Polish sentence** distinguishes "translated" from "the English the
 * raiser wrote".
 *
 * Two audiences and two key shapes, because the block spans both:
 *
 *   - `INTERNAL`, keyed `errors.INTERNAL` — the platform's own unhandled-error
 *     fallback, reached through `setErrorHandler`'s last branch rather than
 *     through a code any module wrote;
 *   - `FORBIDDEN` + `details.code`, keyed `errors.FORBIDDEN.<token>` — the
 *     token path (issue #65), which resolves a second key inside the same
 *     bundle and would go with it.
 */
describe('the platform block keeps its sentences once `_i18n` declares it (feature 090)', () => {
  let h: BackendServerHandle;

  /**
   * Written out rather than read from `packages/modules/_i18n/i18n/pl.json`: a
   * test that loads the file it is checking asserts only that JSON parses.
   */
  const PL_INTERNAL = 'Wewnętrzny błąd serwera.';
  const EN_INTERNAL = 'Internal server error.';
  const PL_CANNOT_TRANSACT =
    'Twoja organizacja nie może składać zamówień w obecnym statusie. ' +
    'Skontaktuj się ze swoim opiekunem konta, aby przywrócić możliwość zamawiania.';

  /**
   * The message the raiser writes. It is deliberately **not** the English
   * sentence in the bundle: if the routing answer stops reaching the bundle,
   * the root answers this string, and an assertion against the English
   * sentence would be indistinguishable from a working translation.
   */
  const RAISED_FORBIDDEN_MESSAGE = 'Organization is blocked from transacting (raiser prose).';

  beforeAll(async () => {
    h = await setupBackendServer({
      extraModules: [
        async (instance) => {
          // Unhandled, on purpose: `setErrorHandler`'s fallback branch is what
          // produces `INTERNAL`, so this exercises the platform's own raise
          // site rather than a module's.
          instance.get('/_test/f090-internal', async () => {
            throw new Error('deliberate — feature 090 platform-block sentence proof');
          });
          instance.get('/_test/f090-forbidden-token', async () => {
            throw new HttpError(403, ERROR_CODES.FORBIDDEN, RAISED_FORBIDDEN_MESSAGE, {
              code: 'organization_cannot_transact',
            });
          });
        },
      ],
    });
    // The buyer arm resolves its language from `Accept-Language`; the admin arm
    // resolves it from the stored preference and ignores the header (D-132).
    const em = h.em();
    const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    admin.preferredLanguage = 'pl';
    await em.flush();
    // No bundle is installed by hand. Every key this file asserts is `_i18n`'s
    // own, and the harness refuses to hand back a server whose `_i18n` bundle
    // did not reconcile (`assertErrorTranslationsInstalled`).
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function message(
    url: string,
    expectedStatus: number,
    headers: Record<string, string>,
    cookies?: Record<string, string>,
  ): Promise<string> {
    const res = await h.app.inject({
      method: 'GET',
      url,
      headers,
      ...(cookies ? { cookies } : {}),
    });
    expect(res.statusCode).toBe(expectedStatus);
    return (res.json() as { error: { message: string } }).error.message;
  }

  it('a buyer asking for Polish gets the Polish `errors.INTERNAL` sentence', async () => {
    expect(await message('/_test/f090-internal', 500, { 'accept-language': 'pl' })).toBe(
      PL_INTERNAL,
    );
  });

  it('an admin whose stored preference is Polish gets it too', async () => {
    expect(
      await message('/_test/f090-internal', 500, {}, { b2b_session: 'stub-admin-session' }),
    ).toBe(PL_INTERNAL);
  });

  it('and English is still English — the assertion above is about the language, not about any sentence', async () => {
    expect(await message('/_test/f090-internal', 500, { 'accept-language': 'en' })).toBe(
      EN_INTERNAL,
    );
  });

  it('the token path resolves `errors.FORBIDDEN.<token>` in Polish, not the raiser prose', async () => {
    const answered = await message('/_test/f090-forbidden-token', 403, {
      'accept-language': 'pl',
    });
    expect(answered).toBe(PL_CANNOT_TRANSACT);
    // Said twice on purpose: the way this regresses is a fall back to the
    // raiser's own message, which is a perfectly plausible-looking answer.
    expect(answered).not.toBe(RAISED_FORBIDDEN_MESSAGE);
  });
});
