import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';

/**
 * Issue #644 (#86) — an import of an export-only entity was `405
 * VALIDATION_FAILED` with the English *"Import is not supported for
 * "orders"."* in every language. The entity exists, the caller holds its
 * permission (the gate answers 403 first) and the body is not looked at yet:
 * the adapter's capability refuses the request, which is not validation of
 * anything submitted. It now has its own code, `IMPORT_NOT_SUPPORTED`, and a
 * sentence in English and Polish.
 *
 * The sentence does not name the entity: `details.entity` is a machine slug,
 * and interpolating it would put English into the Polish sentence. So the slug
 * is asserted in `details`, and the Polish sentence is asserted to differ.
 *
 * The sentences are written out here rather than read from the bundle: a test
 * that loads the file it checks asserts only that JSON parses. The operator is
 * answered in their stored language (D-132), so each case sets it.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const SENTENCES = {
  en: 'This kind of data can only be exported. Importing it is not supported.',
  pl: 'Ten rodzaj danych można tylko eksportować. Import nie jest dla niego obsługiwany.',
} as const;

describe('an import of an export-only entity has its own refusal (issue #644)', () => {
  let h: BackendServerHandle;
  let languageBefore: string | null = null;

  beforeAll(async () => {
    h = await setupBackendServer();
    languageBefore =
      (await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;
  }, 60_000);

  afterAll(async () => {
    if (h) await setAdminLanguage(languageBefore);
    await teardownBackendServer(h);
  });

  async function setAdminLanguage(value: string | null): Promise<void> {
    const em = h.em().fork();
    const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    admin.preferredLanguage = value;
    await em.flush();
  }

  it.each(['en', 'pl'] as const)(
    'IMPORT_NOT_SUPPORTED for an import of orders (%s)',
    async (language) => {
      await setAdminLanguage(language);
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/import/orders',
        headers: { 'content-type': 'text/csv', cookie: 'b2b_session=stub-admin-session' },
        payload: 'id\n',
      });
      expect(res.statusCode, res.body).toBe(405);
      const error = (res.json() as ErrorBody).error;
      expect(error.code).toBe('IMPORT_NOT_SUPPORTED');
      expect(error.details).toEqual({ entity: 'orders' });
      expect(error.message).toBe(SENTENCES[language]);
      if (language === 'pl') expect(error.message).not.toBe(SENTENCES.en);
    },
  );

  it('routes the code to import_export, the module that raises it', () => {
    expect(DECLARED_ERROR_TRANSLATION_TARGETS['IMPORT_NOT_SUPPORTED']?.moduleId).toBe(
      'import_export',
    );
  });
});
