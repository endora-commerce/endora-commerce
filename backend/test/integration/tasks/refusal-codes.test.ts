import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TaskDetailResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';
import { removeCrmAssets, seedCrmAsset } from '../../helpers/seed-crm.js';

/**
 * Issue #642 (#86) — attaching a public library file to a Task was
 * `422 VALIDATION_FAILED` with an English literal. The file exists and the
 * request is well formed; the file's visibility refuses it. The envelope never
 * replaces the message of `VALIDATION_FAILED`, so an operator working in Polish
 * read English. It is now the module's own attachment code,
 * `TASK_ATTACHMENT_REFUSED`, with the refusal token `not_private` choosing its
 * own sentence, and the asset's id and visibility in `details`.
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

describe('tasks refusals carry their own code and sentence (issue #642)', () => {
  let h: BackendServerHandle;
  let languageBefore: string | null = null;
  let taskId: string;
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/tasks';
  const assets: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    languageBefore =
      (await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;
    const response = await h.app.inject({
      method: 'POST',
      url: API,
      cookies: admin,
      payload: { title: 'Refused attachments' },
    });
    expect(response.statusCode, response.body).toBe(201);
    taskId = TaskDetailResponseSchema.parse(response.json()).data.id;
  }, 60_000);

  afterAll(async () => {
    if (h) {
      await setAdminLanguage(languageBefore);
      if (taskId) await h.em().getConnection().execute(`delete from "tasks" where "id" = ?`, [taskId]);
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
    'TASK_ATTACHMENT_REFUSED (not_private) when a public file is attached (%s)',
    async (language) => {
      await setAdminLanguage(language);
      const file = await seedCrmAsset(h.em(), { visibility: 'public' });
      assets.push(file.id);

      const response = await h.app.inject({
        method: 'POST',
        url: `${API}/${taskId}/attachments`,
        cookies: admin,
        payload: { assetId: file.id },
      });

      expect(response.statusCode, response.body).toBe(422);
      const error = (JSON.parse(response.body) as ErrorBody).error;
      expect(error.code).toBe('TASK_ATTACHMENT_REFUSED');
      expect(error.details).toEqual({
        code: 'not_private',
        reason: 'not_private',
        assetId: file.id,
        visibility: 'public',
      });
      expect(error.message).toBe(NOT_PRIVATE[language]);
      if (language === 'pl') expect(error.message).not.toBe(NOT_PRIVATE.en);
    },
  );

  it('routes the code to tasks, the module that raises it', () => {
    expect(DECLARED_ERROR_TRANSLATION_TARGETS['TASK_ATTACHMENT_REFUSED']?.moduleId).toBe('tasks');
  });
});
