import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser, Organization } from '../../helpers/package-entities.js';
import { CUSTOMER_COOKIES, TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';
import { bindOrganizationsToFixtureChannelsSql } from '../../helpers/sales-channel-access.js';

/**
 * Issue #629 (#86) — the domain refusals of `organizations` that were raised as
 * `422 VALIDATION_FAILED` with an English sentence: a personal (B2C)
 * organization refused a second member, an invitation or a sales
 * representative, and a moderation action refused because the organization is
 * in another status. Each request is well formed and the stored organization
 * refuses it, yet `VALIDATION_FAILED` is the one code whose message the error
 * envelope never replaces, so the operator and the buyer read English whatever
 * their language. The personal refusals now answer `ORGANIZATION_PERSONAL` with
 * a token per action, the status guard `ORGANIZATION_STATUS_INVALID`; each has
 * a sentence in English and Polish, filled from `details`.
 *
 * `currentStatus` and `requiredStatus` are machine values, so the status
 * sentence names the statuses by their labels in the reader's language, which
 * the raise puts beside them (`currentStatusLabel`, `requiredStatusLabel`), as
 * `ORGANIZATION_PERMISSION_REQUIRED` carries `permissionLabel`.
 *
 * The sentences are written out here rather than read from the bundle: a test
 * that loads the file it checks asserts only that JSON parses. The operator is
 * answered in their stored language (D-132), the buyer by `Accept-Language`.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const LANGUAGES = ['en', 'pl'] as const;
type Language = (typeof LANGUAGES)[number];

const ADMIN = { b2b_session: 'stub-admin-session' };
const BUYER = 'stub-issue-629-personal-session';

const SENTENCES = {
  addMember: {
    en: (name: string) =>
      `The organization ${name} is a personal (individual) one, so it cannot have additional members.`,
    pl: (name: string) =>
      `Organizacja ${name} jest osobista (indywidualna), dlatego nie może mieć dodatkowych członków.`,
  },
  salesRep: {
    en: (name: string) =>
      `The organization ${name} is a personal (individual) one, so a sales representative cannot be assigned to it.`,
    pl: (name: string) =>
      `Organizacja ${name} jest osobista (indywidualna), dlatego nie można przypisać do niej przedstawiciela handlowego.`,
  },
  invite: {
    en: 'Your account is a personal (individual) one, so it cannot invite members.',
    pl: 'Twoje konto jest osobiste (indywidualne), dlatego nie może zapraszać członków.',
  },
  statusInvalid: {
    en: (current: string, required: string) =>
      `This organization's status is “${current}”, and this action needs the status “${required}”. Reload the page to see its current status.`,
    pl: (current: string, required: string) =>
      `Organizacja ma status „${current}”, a ta czynność wymaga statusu „${required}”. Odśwież stronę, aby zobaczyć jej aktualny status.`,
  },
} as const;

const STATUS_LABELS: Record<Language, Record<string, string>> = {
  en: { active: 'Active', pending_verification: 'Pending verification', blocked: 'Blocked' },
  pl: { active: 'Aktywna', pending_verification: 'Oczekuje na weryfikację', blocked: 'Zablokowana' },
};

const ALL_CODES = ['ORGANIZATION_PERSONAL', 'ORGANIZATION_STATUS_INVALID'] as const;

describe('organizations domain refusals carry their own code and sentence (issue #629)', () => {
  let h: BackendServerHandle;
  let languageBefore: string | null = null;
  let personalId: string;
  let personalName: string;
  let companyId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    languageBefore = (await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;

    personalId = randomUUID();
    personalName = `Issue 629 Individual ${personalId.slice(0, 8)}`;
    const personalAccountId = randomUUID();
    await h.em().execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","registered_address","path","is_personal","created_at","updated_at")
       values (?, ?, null, 'active', 'vat_exempt', '{}'::jsonb, ?, true, now(), now())`,
      [personalId, personalName, `/${personalId}/`],
    );
    await h.em().execute(
      `insert into "customer_accounts"
         ("id","organization_id","email","password_hash","first_name","last_name","created_at","updated_at")
       values (?, ?, ?, 'x', 'Indi', 'Vidual', now(), now())`,
      [personalAccountId, personalId, `${personalAccountId.slice(0, 8)}@issue-629.example`],
    );
    await bindOrganizationsToFixtureChannelsSql(h.em(), [personalId]);
    CUSTOMER_COOKIES[BUYER] = { customerAccountId: personalAccountId, organizationId: personalId };

    const em = h.em().fork();
    const company = em.create(Organization, {
      name: `Issue 629 Company ${personalId.slice(0, 8)}`,
      taxId: `PL629${Date.now()}`,
      status: 'active',
      vatStatus: 'vat_payer',
      isPersonal: false,
      registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
    });
    await em.persist(company).flush();
    companyId = company.id;
  }, 60_000);

  afterAll(async () => {
    delete CUSTOMER_COOKIES[BUYER];
    if (h) await setAdminLanguage(languageBefore);
    await teardownBackendServer(h);
  });

  async function setAdminLanguage(value: string | null): Promise<void> {
    const em = h.em().fork();
    const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    admin.preferredLanguage = value;
    await em.flush();
  }

  function refusal(response: { statusCode: number; body: string }, status: number, code: string): ErrorBody['error'] {
    expect(response.statusCode, response.body).toBe(status);
    const error = (JSON.parse(response.body) as ErrorBody).error;
    expect(error.code).toBe(code);
    return error;
  }

  function expectSentence(error: ErrorBody['error'], language: Language, sentence: Record<Language, string>): void {
    expect(error.message).toBe(sentence[language]);
    if (language === 'pl') expect(error.message).not.toBe(sentence.en);
  }

  async function companyVersion(): Promise<number> {
    return (await h.em().fork().findOneOrFail(Organization, { id: companyId })).version;
  }

  describe.each(LANGUAGES)('for an operator working in %s', (language) => {
    beforeEach(async () => {
      await setAdminLanguage(language);
    });

    it('ORGANIZATION_PERSONAL (add_member) when a member is added to a personal organization', async () => {
      const response = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${personalId}/members`,
        cookies: ADMIN,
        payload: {
          email: `issue-629-${randomUUID().slice(0, 8)}@example.com`,
          firstName: 'M',
          lastName: 'M',
          password: 'a-very-strong-pass',
        },
      });
      const error = refusal(response, 422, 'ORGANIZATION_PERSONAL');
      expect(error.details).toEqual({ code: 'add_member', organizationId: personalId, organizationName: personalName });
      expectSentence(error, language, {
        en: SENTENCES.addMember.en(personalName),
        pl: SENTENCES.addMember.pl(personalName),
      });
    });

    it('ORGANIZATION_PERSONAL (sales_rep) when a sales representative is assigned to a personal organization', async () => {
      const response = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${personalId}/sales-reps`,
        cookies: ADMIN,
        payload: { adminUserId: TEST_ADMIN_ID },
      });
      const error = refusal(response, 422, 'ORGANIZATION_PERSONAL');
      expect(error.details).toEqual({ code: 'sales_rep', organizationId: personalId, organizationName: personalName });
      expectSentence(error, language, {
        en: SENTENCES.salesRep.en(personalName),
        pl: SENTENCES.salesRep.pl(personalName),
      });
    });

    it('ORGANIZATION_STATUS_INVALID when an active organization is approved', async () => {
      const response = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${companyId}/approve`,
        cookies: ADMIN,
        payload: { expectedVersion: await companyVersion() },
      });
      const error = refusal(response, 422, 'ORGANIZATION_STATUS_INVALID');
      expect(error.details).toEqual({
        currentStatus: 'active',
        requiredStatus: 'pending_verification',
        currentStatusLabel: STATUS_LABELS[language]['active'],
        requiredStatusLabel: STATUS_LABELS[language]['pending_verification'],
      });
      expectSentence(error, language, {
        en: SENTENCES.statusInvalid.en(STATUS_LABELS.en['active']!, STATUS_LABELS.en['pending_verification']!),
        pl: SENTENCES.statusInvalid.pl(STATUS_LABELS.pl['active']!, STATUS_LABELS.pl['pending_verification']!),
      });
    });

    it('ORGANIZATION_STATUS_INVALID when an active organization is unblocked', async () => {
      const response = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${companyId}/unblock`,
        cookies: ADMIN,
        payload: { expectedVersion: await companyVersion() },
      });
      const error = refusal(response, 422, 'ORGANIZATION_STATUS_INVALID');
      expect(error.details).toMatchObject({ currentStatus: 'active', requiredStatus: 'blocked' });
      expectSentence(error, language, {
        en: SENTENCES.statusInvalid.en(STATUS_LABELS.en['active']!, STATUS_LABELS.en['blocked']!),
        pl: SENTENCES.statusInvalid.pl(STATUS_LABELS.pl['active']!, STATUS_LABELS.pl['blocked']!),
      });
    });
  });

  describe.each(LANGUAGES)('for a buyer reading %s', (language) => {
    it('ORGANIZATION_PERSONAL (invite) when a personal organization invites a member', async () => {
      const response = await h.app.inject({
        method: 'POST',
        url: '/api/v1/organizations/mine/invitations',
        cookies: { b2b_session: BUYER },
        headers: { 'accept-language': language },
        payload: { email: `issue-629-invite-${randomUUID().slice(0, 8)}@example.com` },
      });
      const error = refusal(response, 422, 'ORGANIZATION_PERSONAL');
      expect(error.details).toEqual({ code: 'invite', organizationId: personalId });
      expectSentence(error, language, SENTENCES.invite);
    });
  });

  it('routes the codes to organizations, the module that raises them', () => {
    for (const code of ALL_CODES) {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]?.moduleId, code).toBe('organizations');
    }
  });
});
