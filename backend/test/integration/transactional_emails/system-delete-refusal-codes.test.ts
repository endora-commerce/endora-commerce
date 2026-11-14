import { randomUUID } from 'node:crypto';
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
 * Issue #638 (#86) — deleting a system email block or a system email template
 * was refused as `409 VALIDATION_FAILED` with an English sentence. The envelope
 * never replaces that code's message, so an operator working in Polish read
 * English, and a client could not tell the refusal from a malformed request.
 * Each now has its own code, a sentence in English and Polish, and the row's
 * id and code in `details` — as `blockCode` / `templateCode`, because the
 * envelope reads `details.code` as a refusal token.
 *
 * The sentences are written out here rather than read from the bundle: a test
 * that loads the file it checks asserts only that JSON parses. The operator is
 * answered in their stored language (D-132), so each case sets it.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };
const BASE = '/api/v1/admin/transactional-emails';

const SYSTEM_BLOCK = {
  en: (code: string) => `Email block "${code}" is a system block, so it cannot be deleted.`,
  pl: (code: string) => `Blok maila „${code}” jest blokiem systemowym, więc nie można go usunąć.`,
};
const SYSTEM_TEMPLATE = {
  en: (code: string) => `Email template "${code}" is a system template, so it cannot be deleted.`,
  pl: (code: string) =>
    `Szablon maila „${code}” jest szablonem systemowym, więc nie można go usunąć.`,
};

describe('system email block and template deletes carry their own code and sentence (issue #638)', () => {
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

  /** The seeded default header block is a system block (US3). */
  async function systemBlock(): Promise<{ id: string; code: string }> {
    const res = await h.app.inject({ method: 'GET', url: `${BASE}/blocks`, cookies: ADMIN_COOKIE });
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json() as { data: { items: Array<{ id: string; code: string; isSystem: boolean }> } })
      .data.items;
    const header = items.find((b) => b.code === 'default_email_header');
    expect(header?.isSystem).toBe(true);
    return { id: header!.id, code: header!.code };
  }

  /** No template is seeded as a system one, so a created template is marked so. */
  async function systemTemplate(): Promise<{ id: string; code: string }> {
    const code = `system_layout_${randomUUID().slice(0, 8)}`;
    const res = await h.app.inject({
      method: 'POST',
      url: `${BASE}/templates`,
      cookies: ADMIN_COOKIE,
      payload: { code, name: 'System layout', languages: ['en-US'] },
    });
    expect(res.statusCode, res.body).toBe(200);
    const id = (res.json() as { data: { id: string } }).data.id;
    await h.em().fork().getConnection().execute(
      'update "email_templates" set "is_system" = true where "id" = ?',
      [id],
    );
    return { id, code };
  }

  async function refusedDelete(url: string, code: string): Promise<ErrorBody['error']> {
    const res = await h.app.inject({ method: 'DELETE', url, cookies: ADMIN_COOKIE });
    expect(res.statusCode, res.body).toBe(409);
    const error = (res.json() as ErrorBody).error;
    expect(error.code).toBe(code);
    return error;
  }

  it.each(['en', 'pl'] as const)(
    'TRANSACTIONAL_EMAIL_SYSTEM_BLOCK when a system block is deleted (%s)',
    async (language) => {
      await setAdminLanguage(language);
      const block = await systemBlock();

      const error = await refusedDelete(`${BASE}/blocks/${block.id}`, 'TRANSACTIONAL_EMAIL_SYSTEM_BLOCK');

      expect(error.details).toEqual({ blockId: block.id, blockCode: block.code });
      expect(error.message).toBe(SYSTEM_BLOCK[language](block.code));
      if (language === 'pl') expect(error.message).not.toBe(SYSTEM_BLOCK.en(block.code));
      // Still there.
      expect((await systemBlock()).id).toBe(block.id);
    },
  );

  it.each(['en', 'pl'] as const)(
    'TRANSACTIONAL_EMAIL_SYSTEM_TEMPLATE when a system template is deleted (%s)',
    async (language) => {
      await setAdminLanguage(language);
      const template = await systemTemplate();

      const error = await refusedDelete(
        `${BASE}/templates/${template.id}`,
        'TRANSACTIONAL_EMAIL_SYSTEM_TEMPLATE',
      );

      expect(error.details).toEqual({ templateId: template.id, templateCode: template.code });
      expect(error.message).toBe(SYSTEM_TEMPLATE[language](template.code));
      if (language === 'pl') expect(error.message).not.toBe(SYSTEM_TEMPLATE.en(template.code));
      const read = await h.app.inject({
        method: 'GET',
        url: `${BASE}/templates/${template.id}`,
        cookies: ADMIN_COOKIE,
      });
      expect(read.statusCode).toBe(200);
    },
  );

  it('routes both codes to transactional_emails, the module that raises them', () => {
    for (const code of ['TRANSACTIONAL_EMAIL_SYSTEM_BLOCK', 'TRANSACTIONAL_EMAIL_SYSTEM_TEMPLATE']) {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]?.moduleId, code).toBe('transactional_emails');
    }
  });
});
