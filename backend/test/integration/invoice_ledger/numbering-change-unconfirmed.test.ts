import { randomBytes } from 'node:crypto';
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
 * Issue #644 (#86) — a routing write that changes the numbering mode without
 * `confirm: true` was `400 VALIDATION_FAILED` with the English *"Confirm the
 * numbering mode change."* in every language. `confirm` is required only when
 * the **stored** mode differs from the submitted one, so the refusal follows
 * from state, not from the body: a Polish operator reaches it with the box
 * unticked, or when another operator changed the mode after the page loaded.
 * It now has its own code, `INVOICE_LEDGER_NUMBERING_CHANGE_UNCONFIRMED`, and a
 * sentence in English and Polish.
 *
 * The sentence does not name the modes: `from` / `to` are machine values the
 * screen already labels. They are asserted in `details`, and the Polish
 * sentence is asserted to differ.
 *
 * The sentences are written out here rather than read from the bundle: a test
 * that loads the file it checks asserts only that JSON parses. The operator is
 * answered in their stored language (D-132), so each case sets it.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const ROUTING_URL = '/api/v1/admin/invoice-ledger/routing';

const SENTENCES = {
  en: 'Changing the invoice numbering source has to be confirmed. Tick the confirmation and save again.',
  pl: 'Zmianę źródła numeracji faktur trzeba potwierdzić. Zaznacz potwierdzenie i zapisz ponownie.',
} as const;

describe('an unconfirmed numbering mode change has its own refusal (issue #644)', () => {
  let h: BackendServerHandle;
  let languageBefore: string | null = null;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
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

  async function storedMode(): Promise<'endora' | 'vendor'> {
    const res = await h.app.inject({ method: 'GET', url: ROUTING_URL, ...ADMIN });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { numberingMode: 'endora' | 'vendor' } }).data.numberingMode;
  }

  it.each(['en', 'pl'] as const)(
    'INVOICE_LEDGER_NUMBERING_CHANGE_UNCONFIRMED for a mode change with confirm false (%s)',
    async (language) => {
      await setAdminLanguage(language);
      const from = await storedMode();
      const to = from === 'endora' ? 'vendor' : 'endora';

      const res = await h.app.inject({
        method: 'PUT',
        url: ROUTING_URL,
        ...ADMIN,
        payload: { numberingMode: to, confirm: false },
      });
      expect(res.statusCode, res.body).toBe(400);
      const error = (res.json() as ErrorBody).error;
      expect(error.code).toBe('INVOICE_LEDGER_NUMBERING_CHANGE_UNCONFIRMED');
      expect(error.details).toEqual({ field: 'confirm', from, to });
      expect(error.message).toBe(SENTENCES[language]);
      if (language === 'pl') expect(error.message).not.toBe(SENTENCES.en);
      expect(await storedMode()).toBe(from);
    },
  );

  it('routes the code to invoice_ledger, the module that raises it', () => {
    expect(
      DECLARED_ERROR_TRANSLATION_TARGETS['INVOICE_LEDGER_NUMBERING_CHANGE_UNCONFIRMED']?.moduleId,
    ).toBe('invoice_ledger');
  });
});
