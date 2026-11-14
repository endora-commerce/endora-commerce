import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';

/**
 * Issue #1218 (#86), the refusals feature 172 added to `catalog`'s attribute
 * writes (`specs/172-product-content-attributes/`, FR-003, FR-005): a Page
 * Builder content attribute whose value type is changed, and a stored content
 * attribute patched to switch on a capability it holds off. Both requests are
 * well formed and the stored type refuses them, yet both were raised as
 * `VALIDATION_FAILED` — the one code whose message the error envelope never
 * replaces — so the operator read the thrower's English sentence whatever
 * their language. The type change now answers the value-type lock's code with
 * the token `page_builder`; the capability gets a code of its own. Each has a
 * sentence in English and Polish, filled from `details`.
 *
 * On create the request names the type itself, so the capability rule judges
 * the request alone and stays `VALIDATION_FAILED` (as #624 ruled for the
 * slider); that case is held here too.
 *
 * The sentences are written out here rather than read from the bundle: a test
 * that loads the file it checks asserts only that JSON parses. The operator is
 * answered in their stored language (D-132), so each case sets it.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

const LANGUAGES = ['en', 'pl'] as const;
type Language = (typeof LANGUAGES)[number];

const ADMIN = { b2b_session: 'stub-admin-session' };
const BASE = '/api/v1/admin/catalog';

const SENTENCES = {
  typeLocked: {
    en: (key: string) =>
      `The value type of the attribute ${key} cannot change to or from Page Builder content: a document and a single value cannot be converted into each other. Create a new attribute instead.`,
    pl: (key: string) =>
      `Typu wartości atrybutu ${key} nie można zmienić na treść Page Builder ani z niej: dokumentu i pojedynczej wartości nie da się przekształcić jedno w drugie. Zamiast tego utwórz nowy atrybut.`,
  },
  capabilityLocked: {
    en: (key: string, capabilities: string) =>
      `The attribute ${key} holds Page Builder content, so it cannot have: ${capabilities}.`,
    pl: (key: string, capabilities: string) =>
      `Atrybut ${key} przechowuje treść Page Builder, więc nie może mieć: ${capabilities}.`,
  },
} as const;

const ALL_CODES = ['ATTRIBUTE_VALUE_TYPE_LOCKED', 'CONTENT_ATTRIBUTE_CAPABILITY_LOCKED'] as const;

describe('catalog content-attribute refusals carry their own code and sentence (issue #1218)', () => {
  let h: BackendServerHandle;
  let languageBefore: string | null = null;
  /** Only what this file creates is removed — never a table-wide wipe. */
  const created: string[] = [];
  const unique = () => randomUUID().replace(/-/g, '').slice(0, 10);

  beforeAll(async () => {
    h = await setupBackendServer();
    languageBefore = (await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;
  }, 60_000);

  afterAll(async () => {
    if (h) {
      await setAdminLanguage(languageBefore);
      for (const key of created) {
        await h.app.inject({ method: 'DELETE', url: `${BASE}/attributes/${key}`, cookies: ADMIN });
      }
    }
    await teardownBackendServer(h);
  });

  async function setAdminLanguage(value: string | null): Promise<void> {
    const em = h.em().fork();
    const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    admin.preferredLanguage = value;
    await em.flush();
  }

  const call = (method: 'POST' | 'PATCH' | 'GET', url: string, payload?: Record<string, unknown>) =>
    h.app.inject({ method, url: `${BASE}${url}`, cookies: ADMIN, ...(payload ? { payload } : {}) });

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

  async function createAttribute(type: 'input' | 'page_builder'): Promise<string> {
    const key = `i1218_${unique()}`;
    const response = await call('POST', '/attributes', {
      key,
      label: { 'en-US': key },
      labelDefault: key,
      type,
      isSearchable: false,
      isFilterable: false,
      isVariantAxis: false,
    });
    expect(response.statusCode, response.body).toBe(201);
    created.push(key);
    return key;
  }

  async function storedType(key: string): Promise<string> {
    const response = await call('GET', `/attributes/${key}`);
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: { type: string } }).data.type;
  }

  describe.each(LANGUAGES)('for an operator working in %s', (language) => {
    beforeEach(async () => {
      await setAdminLanguage(language);
    });

    it('ATTRIBUTE_VALUE_TYPE_LOCKED (page_builder) when a content attribute changes type', async () => {
      const key = await createAttribute('page_builder');
      const error = refusal(await call('PATCH', `/attributes/${key}`, { type: 'input' }), 409, 'ATTRIBUTE_VALUE_TYPE_LOCKED');
      expect(error.details).toEqual({ code: 'page_builder', attributeKey: key });
      expectSentence(error, language, { en: SENTENCES.typeLocked.en(key), pl: SENTENCES.typeLocked.pl(key) });
      expect(await storedType(key)).toBe('page_builder');
    });

    it('ATTRIBUTE_VALUE_TYPE_LOCKED (page_builder) when an ordinary attribute becomes a content one', async () => {
      const key = await createAttribute('input');
      const error = refusal(
        await call('PATCH', `/attributes/${key}`, { type: 'page_builder' }),
        409,
        'ATTRIBUTE_VALUE_TYPE_LOCKED',
      );
      expect(error.details).toEqual({ code: 'page_builder', attributeKey: key });
      expectSentence(error, language, { en: SENTENCES.typeLocked.en(key), pl: SENTENCES.typeLocked.pl(key) });
      expect(await storedType(key)).toBe('input');
    });

    it('CONTENT_ATTRIBUTE_CAPABILITY_LOCKED when a stored content attribute switches a capability on', async () => {
      const key = await createAttribute('page_builder');
      const error = refusal(
        await call('PATCH', `/attributes/${key}`, { isSearchable: true, scopable: true }),
        400,
        'CONTENT_ATTRIBUTE_CAPABILITY_LOCKED',
      );
      expect(error.details).toEqual({ attributeKey: key, capabilities: 'isSearchable, scopable' });
      expectSentence(error, language, {
        en: SENTENCES.capabilityLocked.en(key, 'isSearchable, scopable'),
        pl: SENTENCES.capabilityLocked.pl(key, 'isSearchable, scopable'),
      });
    });

    it('keeps VALIDATION_FAILED when the create request itself names the type and the capability', async () => {
      const key = `i1218_${unique()}`;
      const response = await call('POST', '/attributes', {
        key,
        label: { 'en-US': key },
        labelDefault: key,
        type: 'page_builder',
        isSearchable: true,
        isFilterable: false,
        isVariantAxis: false,
      });
      const error = refusal(response, 400, 'VALIDATION_FAILED');
      expect(error.details).toEqual([{ path: 'isSearchable', issue: 'not available for Page Builder content' }]);
    });
  });

  it('routes the codes to catalog, the module that raises them', () => {
    for (const code of ALL_CODES) {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]?.moduleId, code).toBe('catalog');
    }
  });
});
