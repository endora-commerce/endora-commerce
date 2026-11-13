import { randomBytes } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLogEntry, SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { withModuleOff } from '../../helpers/off-state.js';
import {
  ScriptedTranslator,
  resetTranslationSettings,
  seedTranslationSettings,
} from '../../helpers/cms-translation.js';

/**
 * Feature 151 — the Page Builder translation across modules and over time:
 * settings applied without a restart (FR-004), the audit trail of what left the
 * platform (FR-031), and the off-state rows (FR-040, FR-041, T052).
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const CAPABILITY = '/api/v1/admin/cms/page-builder/translation';
const TRANSLATE = '/api/v1/admin/cms/page-builder/translate';
const SECRET_TEXT = 'Tajny tekst strony';

function canvas(text = SECRET_TEXT) {
  return { root: { props: {} }, content: [{ type: 'cms.Heading', props: { id: 'h', text } }] };
}

describe('Page Builder translation — integration (feature 151)', () => {
  let h: BackendServerHandle;
  const model = new ScriptedTranslator();

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
    h = await setupBackendServer({ registrations: { cmsTranslationLlmFetch: model.fetch } });
  }, 120_000);

  afterAll(async () => {
    await resetTranslationSettings(h);
    await teardownBackendServer(h);
    delete process.env['SETTINGS_SECRET_ENCRYPTION_KEY'];
  });

  beforeEach(() => {
    model.requests.length = 0;
    model.answer = { kind: 'echo' };
  });

  const capability = async () =>
    (await h.app.inject({ method: 'GET', url: CAPABILITY, cookies: ADMIN })).json().data as {
      status: string;
      provider?: string;
      model?: string;
    };
  const translate = (payload: Record<string, unknown>) =>
    h.app.inject({
      method: 'POST',
      url: TRANSLATE,
      cookies: ADMIN,
      payload: { targetLanguage: 'en-US', sourceLanguage: null, context: 'cms', data: canvas(), ...payload },
    });
  const audits = () => h.em().find(AuditLogEntry, { action: 'cms.page_builder.translate' }, { orderBy: { actedAt: 'asc' } });

  describe('configuration (FR-004)', () => {
    it('applies a change of either setting to the next request, without a restart', async () => {
      await seedTranslationSettings(h, { provider: 'openai', model: 'gpt-one' });
      expect(await capability()).toMatchObject({ status: 'ready', provider: 'openai', model: 'gpt-one' });

      await seedTranslationSettings(h, { provider: 'deepseek', model: 'deepseek-chat' });
      expect(await capability()).toMatchObject({ status: 'ready', provider: 'deepseek', model: 'deepseek-chat' });
      await translate({});
      expect(model.requests.at(-1)!.url).toBe('https://api.deepseek.com/chat/completions');

      await seedTranslationSettings(h, { enabled: false });
      expect((await capability()).status).toBe('disabled');
    });
  });

  describe('audit (FR-031)', () => {
    // Per case, not per block: 'records nothing…' switches the translation off,
    // so a case run after it in a shuffled order read 409 (issue #1118).
    beforeEach(async () => {
      await seedTranslationSettings(h, { provider: 'openai', model: 'gpt-audit', maxSourceCharacters: 1000 });
    });

    it('records one metadata-only entry per send, with the actor from the session', async () => {
      const before = (await audits()).length;
      const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
      const r = await translate({ resource: { type: 'cms_page', id: channel.id } });
      expect(r.statusCode).toBe(200);
      const rows = await audits();
      expect(rows.length).toBe(before + 1);
      const row = rows.at(-1)!;
      expect(row.actorAdminUserId).toBe(TEST_ADMIN_ID);
      expect(row.objectType).toBe('cms_page');
      expect(row.objectId).toBe(channel.id);
      expect(row.stateAfter).toEqual({
        targetLanguage: 'en-US',
        sourceLanguage: null,
        provider: 'openai',
        model: 'gpt-audit',
        segments: 1,
        characters: SECRET_TEXT.length,
        translatedSegments: 1,
        untranslatedSegments: 0,
        outcome: 'completed',
        limit: 1000,
        scope: 'canvas',
      });
      expect(JSON.stringify(row)).not.toContain(SECRET_TEXT);
    });

    it('records a failed attempt that reached the provider', async () => {
      model.answer = { kind: 'http', status: 401 };
      expect((await translate({})).statusCode).toBe(502);
      expect((await audits()).at(-1)!.stateAfter).toMatchObject({ outcome: 'failed', failure: 'credentials_rejected' });
    });

    it('records nothing for a request that sent nothing', async () => {
      const before = (await audits()).length;
      // 413 — above the configured limit.
      expect((await translate({ data: canvas('Słowo '.repeat(300)) })).statusCode).toBe(413);
      // 200 — nothing to translate.
      expect((await translate({ data: canvas('2024') })).statusCode).toBe(200);
      // 422 — selection not found.
      expect((await translate({ scope: { kind: 'text', componentId: 'h', selectedText: 'brak' } })).statusCode).toBe(422);
      // 400 — invalid body.
      expect((await translate({ sourceLanguage: 'en-US' })).statusCode).toBe(400);
      // 409 — switched off.
      await seedTranslationSettings(h, { enabled: false });
      expect((await translate({})).statusCode).toBe(409);
      expect((await audits()).length).toBe(before);
      expect(model.requests).toHaveLength(0);
    });
  });

  describe('off-state (FR-040, FR-041)', () => {
    beforeAll(async () => {
      await seedTranslationSettings(h, { provider: 'openai' });
    });

    it('cms off: both routes answer 503 MODULE_DISABLED', async () => {
      await withModuleOff('cms', 'deactivated', async () => {
        const cap = await h.app.inject({ method: 'GET', url: CAPABILITY, cookies: ADMIN });
        expect(cap.statusCode).toBe(503);
        expect(cap.json().error.code).toBe('MODULE_DISABLED');
        const tr = await translate({});
        expect(tr.statusCode).toBe(503);
      });
    });

    it('credentials off: unavailable and 409, while a CMS page still saves', async () => {
      await withModuleOff('credentials', 'deactivated', async () => {
        expect((await capability()).status).toBe('unavailable');
        const tr = await translate({});
        expect(tr.statusCode).toBe(409);
        expect(tr.json().error.code).toBe('CMS_TRANSLATION_UNAVAILABLE');

        const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
        const page = await h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/cms/pages',
          cookies: ADMIN,
          payload: {
            name: 'Translation off-state',
            slug: `translation-off-${Date.now()}`,
            active: true,
            description: null,
            salesChannelIds: [channel.id],
            languages: ['en-US'],
          },
        });
        expect(page.statusCode).toBe(201);
      });
      expect(model.requests).toHaveLength(0);
    });

    it('prompt_actions off: translation unaffected', async () => {
      await withModuleOff('prompt_actions', 'deactivated', async () => {
        expect((await capability()).status).toBe('ready');
        expect((await translate({})).statusCode).toBe(200);
      });
    });
  });
});
