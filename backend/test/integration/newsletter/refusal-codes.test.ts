import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser, NewsletterCampaign, NewsletterEmailBlock } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';
import { NewsletterCampaignService } from '../../../../packages/modules/newsletter/src/backend/services/campaign.service.js';

/**
 * Issue #626 (#86) — the `newsletter` admin refusals that were raised as
 * `VALIDATION_FAILED` with an English literal. `VALIDATION_FAILED` is the one
 * code whose message the error envelope never replaces, so an operator working
 * in Polish read English, and a client could not tell "this campaign is already
 * sent" from a malformed body. Each refusal now has a code of its own, a
 * sentence in English and Polish, and the values the sentence names in
 * `details`.
 *
 * The sentences are written out here rather than read from the bundle: a test
 * that loads the file it checks asserts only that JSON parses. The operator is
 * answered in their stored language (D-132), so each case sets it. The one
 * refusal no route can reach today — the sending provider, which the composed
 * registry always reports configured — is raised from the real service behind
 * a test route, so the real envelope, routing and installed bundles render it,
 * and the language comes from `Accept-Language` there.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const ADMIN = { b2b_session: 'stub-admin-session' };
const LANGUAGES = ['en', 'pl'] as const;
type Language = (typeof LANGUAGES)[number];

/** A unique suffix that satisfies the `^[a-z][a-z0-9_]*$` code and key rule. */
const RUN = `n${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

function tree(text: string): Record<string, unknown> {
  return {
    root: { props: {} },
    content: [{ type: 'transactional_emails.EmailText', props: { id: 't', text } }],
    zones: {},
  };
}

const SENTENCES = {
  automationActive: {
    en: 'This automation is active, so it cannot be edited. Pause it before editing.',
    pl: 'Ta automatyzacja jest aktywna, więc nie można jej edytować. Wstrzymaj ją przed edycją.',
  },
  campaignNotEditable: {
    en: (status: string) =>
      `This campaign has the status "${status}", so it can no longer be edited. Only draft and scheduled campaigns can be edited.`,
    pl: (status: string) =>
      `Ta kampania ma status „${status}”, więc nie można już jej edytować. Edytować można tylko kampanie w wersji roboczej i zaplanowane.`,
  },
  campaignNotCancellable: {
    en: (status: string) =>
      `This campaign has the status "${status}", so it can no longer be cancelled. Only draft and scheduled campaigns can be cancelled.`,
    pl: (status: string) =>
      `Ta kampania ma status „${status}”, więc nie można już jej anulować. Anulować można tylko kampanie w wersji roboczej i zaplanowane.`,
  },
  providerNotConfigured: {
    en: 'No sending provider is configured, so the campaign cannot be sent. Configure the sending provider first.',
    pl: 'Nie skonfigurowano dostawcy wysyłki, więc nie można wysłać kampanii. Najpierw skonfiguruj dostawcę wysyłki.',
  },
  customFieldKeyTaken: {
    en: (key: string) => `A custom field with the key "${key}" already exists. Choose another key.`,
    pl: (key: string) => `Pole niestandardowe o kluczu „${key}” już istnieje. Wybierz inny klucz.`,
  },
  emailBlockCodeTaken: {
    en: (code: string) => `An email block with the code "${code}" already exists. Choose another code.`,
    pl: (code: string) => `Blok e-mail o kodzie „${code}” już istnieje. Wybierz inny kod.`,
  },
  emailBlockSystem: {
    en: (code: string) => `Email block "${code}" is a system block, so it cannot be deleted.`,
    pl: (code: string) => `Blok e-mail „${code}” jest blokiem systemowym, więc nie można go usunąć.`,
  },
  tagCodeTaken: {
    en: (code: string) => `A tag with the code "${code}" already exists. Choose another code.`,
    pl: (code: string) => `Tag o kodzie „${code}” już istnieje. Wybierz inny kod.`,
  },
  tagInUse: {
    en: (code: string) =>
      `Tag "${code}" is used by a campaign or an automation, so it cannot be deleted. Remove it from them first.`,
    pl: (code: string) =>
      `Tag „${code}” jest używany przez kampanię lub automatyzację, więc nie można go usunąć. Najpierw usuń go z nich.`,
  },
} as const;

const ALL_CODES = [
  'NEWSLETTER_AUTOMATION_ACTIVE',
  'NEWSLETTER_CAMPAIGN_NOT_EDITABLE',
  'NEWSLETTER_CAMPAIGN_NOT_CANCELLABLE',
  'NEWSLETTER_PROVIDER_NOT_CONFIGURED',
  'NEWSLETTER_CUSTOM_FIELD_KEY_TAKEN',
  'NEWSLETTER_EMAIL_BLOCK_CODE_TAKEN',
  'NEWSLETTER_EMAIL_BLOCK_SYSTEM',
  'NEWSLETTER_TAG_CODE_TAKEN',
  'NEWSLETTER_TAG_IN_USE',
] as const;

describe('newsletter refusals carry their own code and sentence (issue #626)', () => {
  let h: BackendServerHandle;
  let languageBefore: string | null = null;

  beforeAll(async () => {
    h = await setupBackendServer({
      extraModules: [
        async (instance) => {
          // The send refusal as the composed service raises it, with a provider
          // check that answers "not configured".
          instance.post<{ Params: { id: string }; Body: { expectedVersion: number } }>(
            '/_test/i626-send/:id',
            async (request) => {
              const service = new NewsletterCampaignService({
                emFactory: () => h.em(),
                dispatch: undefined as never,
                content: undefined as never,
                isProviderConfigured: async () => false,
              });
              await service.send(request.params.id, request.body.expectedVersion);
              return { ok: true };
            },
          );
        },
      ],
    });
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

  function admin(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, payload?: unknown) {
    return h.app.inject({
      method,
      url: `/api/v1/admin/newsletter${path}`,
      cookies: ADMIN,
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
  }

  function refusal(
    res: { statusCode: number; body: string; json: () => unknown },
    status: number,
    code: string,
  ): ErrorBody['error'] {
    expect(res.statusCode, res.body).toBe(status);
    const error = (res.json() as ErrorBody).error;
    expect(error.code).toBe(code);
    return error;
  }

  function expectSentence(error: ErrorBody['error'], language: Language, sentences: Record<Language, string>) {
    expect(error.message).toBe(sentences[language]);
    if (language === 'pl') expect(error.message).not.toBe(sentences.en);
  }

  async function createCampaign(overrides: Record<string, unknown> = {}): Promise<{ id: string; version: number }> {
    const res = await admin('POST', '/campaigns', {
      name: `Campaign ${RUN}`,
      language: 'en-US',
      subject: 'S',
      content: tree('B'),
      targetType: 'all',
      ...overrides,
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  async function campaignSent(): Promise<{ id: string; version: number }> {
    const created = await createCampaign();
    const em = h.em().fork();
    const row = await em.findOneOrFail(NewsletterCampaign, { id: created.id });
    row.status = 'sent';
    await em.flush();
    return created;
  }

  async function createTag(code: string): Promise<{ id: string; code: string }> {
    const res = await admin('POST', '/tags', { code, name: `Tag ${code}` });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string; code: string } }).data;
  }

  describe('campaigns', () => {
    it.each(LANGUAGES)('refuses to edit a sent campaign (%s)', async (language) => {
      await setAdminLanguage(language);
      const campaign = await campaignSent();
      const error = refusal(
        await admin('PUT', `/campaigns/${campaign.id}`, { name: 'Renamed', expectedVersion: campaign.version }),
        422,
        'NEWSLETTER_CAMPAIGN_NOT_EDITABLE',
      );
      expect(error.details).toEqual({ campaignId: campaign.id, status: 'sent' });
      expectSentence(error, language, {
        en: SENTENCES.campaignNotEditable.en('sent'),
        pl: SENTENCES.campaignNotEditable.pl('sent'),
      });
    });

    it.each(LANGUAGES)('refuses to cancel a sent campaign (%s)', async (language) => {
      await setAdminLanguage(language);
      const campaign = await campaignSent();
      const error = refusal(
        await admin('POST', `/campaigns/${campaign.id}/cancel`, { expectedVersion: campaign.version }),
        422,
        'NEWSLETTER_CAMPAIGN_NOT_CANCELLABLE',
      );
      expect(error.details).toEqual({ campaignId: campaign.id, status: 'sent' });
      expectSentence(error, language, {
        en: SENTENCES.campaignNotCancellable.en('sent'),
        pl: SENTENCES.campaignNotCancellable.pl('sent'),
      });
    });

    it.each(LANGUAGES)('refuses to send without a sending provider (%s)', async (language) => {
      const campaign = await createCampaign();
      const res = await h.app.inject({
        method: 'POST',
        url: `/_test/i626-send/${campaign.id}`,
        payload: { expectedVersion: campaign.version },
        headers: { 'accept-language': language },
      });
      const error = refusal(res, 422, 'NEWSLETTER_PROVIDER_NOT_CONFIGURED');
      // The `provider_not_configured` token is gone: it was the only reason
      // under its code, so it added nothing (the shape #621 used for
      // `order_below_minimum`).
      expect(error.details).toBeUndefined();
      expectSentence(error, language, SENTENCES.providerNotConfigured);
    });
  });

  describe('automations', () => {
    it.each(LANGUAGES)('refuses to edit an active automation (%s)', async (language) => {
      await setAdminLanguage(language);
      const created = await admin('POST', '/automations', {
        name: `Automation ${RUN}`,
        triggerType: 'all',
        language: 'en-US',
        reentryPolicy: 'once',
        steps: [{ type: 'send', subject: 'A', content: tree('Email A') }],
      });
      expect(created.statusCode, created.body).toBe(201);
      const automation = (created.json() as { data: { id: string; version: number } }).data;
      const activated = await admin('POST', `/automations/${automation.id}/activate`, {
        expectedVersion: automation.version,
      });
      expect(activated.statusCode, activated.body).toBe(200);
      const version = (activated.json() as { data: { version: number } }).data.version;

      const error = refusal(
        await admin('PUT', `/automations/${automation.id}`, { name: 'Renamed', expectedVersion: version }),
        422,
        'NEWSLETTER_AUTOMATION_ACTIVE',
      );
      expect(error.details).toEqual({ automationId: automation.id, status: 'active' });
      expectSentence(error, language, SENTENCES.automationActive);
    });
  });

  describe('custom fields, email blocks and tags', () => {
    it.each(LANGUAGES)('refuses a custom field key that is taken (%s)', async (language) => {
      await setAdminLanguage(language);
      const key = `${RUN}_field_${language}`;
      const first = await admin('POST', '/custom-fields', { key, label: 'Field', type: 'text' });
      expect(first.statusCode, first.body).toBe(201);
      const error = refusal(
        await admin('POST', '/custom-fields', { key, label: 'Again', type: 'text' }),
        409,
        'NEWSLETTER_CUSTOM_FIELD_KEY_TAKEN',
      );
      expect(error.details).toEqual({ key });
      expectSentence(error, language, {
        en: SENTENCES.customFieldKeyTaken.en(key),
        pl: SENTENCES.customFieldKeyTaken.pl(key),
      });
    });

    it.each(LANGUAGES)('refuses an email block code that is taken (%s)', async (language) => {
      await setAdminLanguage(language);
      const code = `${RUN}_block_${language}`;
      const first = await admin('POST', '/blocks', { code, name: 'Block', content: tree('v1') });
      expect(first.statusCode, first.body).toBe(201);
      const error = refusal(
        await admin('POST', '/blocks', { code, name: 'Again', content: tree('v2') }),
        409,
        'NEWSLETTER_EMAIL_BLOCK_CODE_TAKEN',
      );
      // The block's code is `blockCode`: the envelope reads `details.code` as
      // the refusal token.
      expect(error.details).toEqual({ blockCode: code });
      expectSentence(error, language, {
        en: SENTENCES.emailBlockCodeTaken.en(code),
        pl: SENTENCES.emailBlockCodeTaken.pl(code),
      });
    });

    it.each(LANGUAGES)('refuses to delete a system email block (%s)', async (language) => {
      await setAdminLanguage(language);
      const system = await h.em().fork().findOneOrFail(NewsletterEmailBlock, { isSystem: true });
      const error = refusal(await admin('DELETE', `/blocks/${system.id}`), 422, 'NEWSLETTER_EMAIL_BLOCK_SYSTEM');
      expect(error.details).toEqual({ blockId: system.id, blockCode: system.code });
      expectSentence(error, language, {
        en: SENTENCES.emailBlockSystem.en(system.code),
        pl: SENTENCES.emailBlockSystem.pl(system.code),
      });
    });

    it.each(LANGUAGES)('refuses a tag code that is taken (%s)', async (language) => {
      await setAdminLanguage(language);
      const code = `${RUN}_tag_${language}`;
      await createTag(code);
      const error = refusal(await admin('POST', '/tags', { code, name: 'Again' }), 409, 'NEWSLETTER_TAG_CODE_TAKEN');
      expect(error.details).toEqual({ tagCode: code });
      expectSentence(error, language, {
        en: SENTENCES.tagCodeTaken.en(code),
        pl: SENTENCES.tagCodeTaken.pl(code),
      });
    });

    it.each(LANGUAGES)('refuses to delete a tag a campaign targets (%s)', async (language) => {
      await setAdminLanguage(language);
      const tag = await createTag(`${RUN}_used_${language}`);
      await createCampaign({ targetType: 'tag', targetTagIds: [tag.id] });
      const error = refusal(await admin('DELETE', `/tags/${tag.id}`), 409, 'NEWSLETTER_TAG_IN_USE');
      // The `tag_in_use` token is gone: the code says it.
      expect(error.details).toEqual({ tagId: tag.id, tagCode: tag.code });
      expectSentence(error, language, {
        en: SENTENCES.tagInUse.en(tag.code),
        pl: SENTENCES.tagInUse.pl(tag.code),
      });
    });
  });

  it('routes every code to newsletter, the module that raises them', () => {
    for (const code of ALL_CODES) {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]?.moduleId, code).toBe('newsletter');
    }
  });
});
