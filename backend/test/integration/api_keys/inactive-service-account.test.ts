import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser, CustomerAccount } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';

/**
 * Issue #644 (#86) — a bound API key whose service account exists and belongs
 * to the bound organization, but is blocked, deleted or anonymized, was refused
 * as `422 VALIDATION_FAILED` with an English issue list in every language. The
 * request is well formed and names a real account; the account's stored state
 * refuses it. It now has its own code, `API_KEY_SERVICE_ACCOUNT_INACTIVE`, and
 * a refusal token: `blocked` (reversible: unblock the account or pick another)
 * or `removed` (deleted or anonymized, terminal: pick another).
 *
 * The code is raised only when the inactive account is the **sole** problem.
 * Any validation issue beside it keeps the aggregate `VALIDATION_FAILED`, which
 * still lists the inactive account. An account that does not exist, or that
 * belongs to another organization, stays validation, each with its own message.
 *
 * The sentences are written out here rather than read from the bundle: a test
 * that loads the file it checks asserts only that JSON parses. The operator is
 * answered in their stored language (D-132), so each case sets it.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

const SENTENCES = {
  blocked: {
    en: 'The service account is blocked, so the API key cannot act as it. Unblock the account or choose another one.',
    pl: 'Konto serwisowe jest zablokowane, więc klucz API nie może działać w jego imieniu. Odblokuj konto albo wybierz inne.',
  },
  removed: {
    en: 'The service account has been removed, so the API key cannot act as it. Choose another account.',
    pl: 'Konto serwisowe zostało usunięte, więc klucz API nie może działać w jego imieniu. Wybierz inne konto.',
  },
} as const;

describe('an inactive service account has its own refusal (issue #644)', () => {
  let h: BackendServerHandle;
  let languageBefore: string | null = null;
  let channelId: string;
  const accounts = {
    blocked: randomUUID(),
    deleted: randomUUID(),
    anonymized: randomUUID(),
  };
  const created: string[] = Object.values(accounts);

  beforeAll(async () => {
    h = await setupBackendServer();
    channelId = (await h.salesChannels.resolver.getSystemDefault()).id;
    const em = h.em();
    languageBefore =
      (await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;
    const base = (id: string, label: string) => ({
      id,
      organizationId: TEST_ORGANIZATION_ID,
      email: `i644-${label}-${id.slice(0, 8)}@example.com`,
      passwordHash: 'x',
      firstName: 'Service',
      lastName: label,
      emailVerifiedAt: new Date(),
    });
    em.create(CustomerAccount, { ...base(accounts.blocked, 'blocked'), blockedAt: new Date() });
    em.create(CustomerAccount, { ...base(accounts.deleted, 'deleted'), deletedAt: new Date() });
    em.create(CustomerAccount, {
      ...base(accounts.anonymized, 'anonymized'),
      anonymizedAt: new Date(),
    });
    await em.flush();
  }, 60_000);

  afterAll(async () => {
    if (h) {
      await setAdminLanguage(languageBefore);
      await h.em().fork().nativeDelete(CustomerAccount, { id: { $in: created } });
    }
    await teardownBackendServer(h);
  });

  async function setAdminLanguage(value: string | null): Promise<void> {
    const em = h.em().fork();
    const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    admin.preferredLanguage = value;
    await em.flush();
  }

  async function refused(
    customerAccountId: string,
    over: Record<string, unknown> = {},
  ): Promise<ErrorBody['error']> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      ...ADMIN,
      payload: {
        name: `I644 key ${randomUUID().slice(0, 8)}`,
        scopes: ['orders:write'],
        binding: { organizationId: TEST_ORGANIZATION_ID, salesChannelId: channelId, customerAccountId },
        ...over,
      },
    });
    expect(res.statusCode, res.body).toBe(422);
    return (res.json() as ErrorBody).error;
  }

  const cases = [
    { account: 'blocked', token: 'blocked' },
    { account: 'deleted', token: 'removed' },
    { account: 'anonymized', token: 'removed' },
  ] as const;

  for (const { account, token } of cases) {
    it.each(['en', 'pl'] as const)(
      `API_KEY_SERVICE_ACCOUNT_INACTIVE with token ${token} for a ${account} account (%s)`,
      async (language) => {
        await setAdminLanguage(language);
        const error = await refused(accounts[account]);
        expect(error.code).toBe('API_KEY_SERVICE_ACCOUNT_INACTIVE');
        expect(error.details).toEqual({
          code: token,
          field: 'binding.customerAccountId',
          customerAccountId: accounts[account],
          organizationId: TEST_ORGANIZATION_ID,
        });
        expect(error.message).toBe(SENTENCES[token][language]);
        if (language === 'pl') expect(error.message).not.toBe(SENTENCES[token].en);
      },
    );
  }

  it('keeps VALIDATION_FAILED, listing the inactive account, when another issue is present', async () => {
    await setAdminLanguage('pl');
    const error = await refused(accounts.blocked, { expiresAt: '2020-01-01T00:00:00.000Z' });
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'expiresAt' }),
        expect.objectContaining({ path: 'binding.customerAccountId' }),
      ]),
    );
  });

  it('keeps VALIDATION_FAILED for an account that does not exist, with its own message', async () => {
    const error = await refused(randomUUID());
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toEqual([
      { path: 'binding.customerAccountId', issue: 'Service account does not exist.' },
    ]);
  });

  it('routes the code to api_keys, the module that raises it', () => {
    expect(DECLARED_ERROR_TRANSLATION_TARGETS['API_KEY_SERVICE_ACCOUNT_INACTIVE']?.moduleId).toBe(
      'api_keys',
    );
  });
});
