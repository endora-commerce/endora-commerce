import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminUser } from '../../helpers/package-entities.js';
import { join } from 'node:path';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '../../../src/http/error-envelope.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

/**
 * The admin arm of the request-language resolver, held where it is (D-132).
 *
 * **These assertions pass on the code that shipped the #234 defect, and that is
 * the point.** Feature 083 gives a buyer a `Accept-Language` rung and a channel
 * rung; an operator gets neither, because the admin SPA renders its chrome from
 * the stored `preferredLanguage` and ignores the browser
 * (`admin/src/App.tsx`). Answering an operator's errors from the browser would
 * put Polish refusals on an English screen — a half-translated screen looks
 * broken in a way a wholly English one does not.
 *
 * Written down because the admin arm is three lines next to the buyer arm and
 * reads like duplication. It is not: deleting it, or "simplifying" the two arms
 * into one ladder, changes every operator's error language. If these go red,
 * that is what happened.
 */
describe('the language an admin is answered in stays the stored preference (D-132)', () => {
  let h: BackendServerHandle;

  const EN_SETTING = 'Setting is not registered.';
  const PL_SETTING = 'Ustawienie nie jest zarejestrowane.';

  beforeAll(async () => {
    h = await setupBackendServer({
      extraModules: [
        async (instance) => {
          instance.get('/_test/w234-admin-error', async () => {
            throw new HttpError(
              404,
              ERROR_CODES.SETTING_NOT_REGISTERED,
              'Setting "x" not registered',
            );
          });
        },
      ],
    });
    await h.adminI18n.i18nService.installBundlesForModule(
      'settings',
      join(process.cwd(), 'src/modules/settings'),
      'i18n',
    );
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function setPreferredLanguage(value: 'pl' | 'en' | null): Promise<void> {
    const em = h.em();
    const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    admin.preferredLanguage = value;
    await em.flush();
  }

  async function errorMessage(headers: Record<string, string>): Promise<string> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/_test/w234-admin-error',
      cookies: { b2b_session: 'stub-admin-session' },
      headers,
    });
    expect(res.statusCode).toBe(404);
    return (res.json() as { error: { message: string } }).error.message;
  }

  it('R5 — an admin with no stored preference is answered in English, whatever the browser asks for', async () => {
    await setPreferredLanguage(null);
    expect(await errorMessage({ 'accept-language': 'pl' })).toBe(EN_SETTING);
  });

  it('R6 — an admin who stored Polish is answered in Polish, sending no header at all', async () => {
    await setPreferredLanguage('pl');
    expect(await errorMessage({})).toBe(PL_SETTING);
  });

  it('the stored preference is not overridden by a competing header either', async () => {
    // The other direction of B2, and the one T022 would have to rule on before
    // the admin SPA may start sending a header of its own.
    await setPreferredLanguage('pl');
    expect(await errorMessage({ 'accept-language': 'en-GB' })).toBe(PL_SETTING);
  });
});
