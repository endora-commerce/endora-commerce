import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  removeCrmAssets,
  restoreDefaultCrmWorkflow,
  seedCrmAsset,
} from '../../helpers/seed-crm.js';

/**
 * Issue #639 (#86) — attaching a public library file to an Opportunity was
 * `422 VALIDATION_FAILED` with an English literal. The file exists and the
 * caller may see it; its visibility refuses it. The envelope never replaces the
 * message of `VALIDATION_FAILED`, so an operator working in Polish read
 * English, and a client could not tell it from a malformed request. It now has
 * its own code, `CRM_ATTACHMENT_NOT_PRIVATE` — the twin of `projects`'
 * `PROJECT_ATTACHMENT_NOT_PRIVATE` (issue #634), as the two
 * `*_ATTACHMENT_TOO_LARGE` codes are — with the asset's id and visibility in
 * `details`.
 *
 * The sentences are written out here rather than read from the bundle: a test
 * that loads the file it checks asserts only that JSON parses. The operator is
 * answered in their stored language (D-132), so each case sets it.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const NOT_PRIVATE = {
  en: 'An attachment must be a private file. Upload it to the media library as private.',
  pl: 'Załącznik musi być plikiem prywatnym. Prześlij go do biblioteki mediów jako prywatny.',
};

describe('crm refusals carry their own code and sentence (issue #639)', () => {
  let h: BackendServerHandle;
  let languageBefore: string | null = null;
  let opportunityId: string;
  const assets: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    languageBefore =
      (await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;
    opportunityId = (await createCrmOpportunity(h)).id;
  }, 60_000);

  afterAll(async () => {
    if (h) {
      await setAdminLanguage(languageBefore);
      await removeCrmAssets(h.em(), assets);
    }
    await teardownBackendServer(h);
  });

  async function setAdminLanguage(value: string | null): Promise<void> {
    const em = h.em().fork();
    const user = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    user.preferredLanguage = value;
    await em.flush();
  }

  it.each(['en', 'pl'] as const)(
    'CRM_ATTACHMENT_NOT_PRIVATE when a public file is attached (%s)',
    async (language) => {
      await setAdminLanguage(language);
      const file = await seedCrmAsset(h.em(), { visibility: 'public' });
      assets.push(file.id);

      const response = await h.app.inject({
        method: 'POST',
        url: `${CRM_API}/opportunities/${opportunityId}/attachments`,
        cookies: CRM_ADMIN,
        payload: { assetId: file.id },
      });

      expect(response.statusCode, response.body).toBe(422);
      const error = (JSON.parse(response.body) as ErrorBody).error;
      expect(error.code).toBe('CRM_ATTACHMENT_NOT_PRIVATE');
      expect(error.details).toEqual({ assetId: file.id, visibility: 'public' });
      expect(error.message).toBe(NOT_PRIVATE[language]);
      if (language === 'pl') expect(error.message).not.toBe(NOT_PRIVATE.en);
    },
  );

  it('routes the code to crm, the module that raises it', () => {
    expect(DECLARED_ERROR_TRANSLATION_TARGETS['CRM_ATTACHMENT_NOT_PRIVATE']?.moduleId).toBe('crm');
  });
});
