import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

/**
 * Issue #1223 — feature 172 (`specs/172-product-content-attributes/`, FR-012,
 * FR-014) raises `ATTRIBUTE_VALUE_REJECTED` for two refusals that are not the
 * one its sentence describes ("Some attributes do not belong to this product's
 * attribute set."): a Page Builder content attribute's key sent in
 * `attributeValues` — the attribute usually *is* in the set — and a content
 * `PUT` for a key that is not a content attribute of the set. Each now carries
 * a token in `details.code` with a sentence of its own in English and Polish,
 * naming the key(s). The genuine "not in the set" refusal keeps the code's
 * sentence and its `[{ path, issue }]` details; that case is held here too.
 *
 * The sentences are written out here rather than read from the bundle, and the
 * operator is answered in their stored language (D-132), so each case sets it.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

const LANGUAGES = ['en', 'pl'] as const;
type Language = (typeof LANGUAGES)[number];

const ADMIN = { b2b_session: 'stub-admin-session' };
const BASE = '/api/v1/admin/catalog';

const SENTENCES = {
  pageBuilderContent: {
    en: (keys: string) =>
      `Page Builder content cannot be saved as an attribute value: ${keys}. Edit it on the product's content screen.`,
    pl: (keys: string) =>
      `Treści Page Builder nie można zapisać jako wartości atrybutu: ${keys}. Edytuj ją na ekranie treści produktu.`,
  },
  notContentAttribute: {
    en: (key: string) => `The attribute ${key} is not a Page Builder content attribute of this product's attribute set.`,
    pl: (key: string) => `Atrybut ${key} nie jest atrybutem treści Page Builder w zestawie atrybutów tego produktu.`,
  },
  notInSet: {
    en: "Some attributes do not belong to this product's attribute set.",
    pl: 'Niektóre atrybuty nie należą do zestawu atrybutów tego produktu.',
  },
} as const;

describe('ATTRIBUTE_VALUE_REJECTED says why for Page Builder content (issue #1223)', () => {
  let h: BackendServerHandle;
  let languageBefore: string | null = null;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  const CONTENT = `i1223_guide_${suffix}`;
  const PLAIN = `i1223_plain_${suffix}`;
  const OUTSIDE = `i1223_out_${suffix}`;
  let setId = '';
  let productId = '';
  /** Only what this file creates is removed — never a table-wide wipe. */
  const createdAttributes: string[] = [];

  const call = (method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
    h.app.inject({ method, url: `${BASE}${url}`, cookies: ADMIN, ...(payload ? { payload } : {}) });

  async function createAttribute(key: string, type: 'input' | 'page_builder'): Promise<string> {
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
    createdAttributes.push(key);
    return (response.json() as { data: { id: string } }).data.id;
  }

  async function setAdminLanguage(value: string | null): Promise<void> {
    const em = h.em().fork();
    const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    admin.preferredLanguage = value;
    await em.flush();
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    languageBefore = (await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;
    const content = await createAttribute(CONTENT, 'page_builder');
    const plain = await createAttribute(PLAIN, 'input');
    await createAttribute(OUTSIDE, 'input');

    const set = await call('POST', '/attribute-sets', { code: `i1223_${suffix}`, name: { 'en-US': 'Set 1223' } });
    expect(set.statusCode, set.body).toBe(201);
    setId = (set.json() as { data: { id: string } }).data.id;
    const assign = await call('POST', `/attribute-sets/${setId}/attributes`, {
      assignments: [
        { attributeId: plain, position: 0 },
        { attributeId: content, position: 1 },
      ],
    });
    expect(assign.statusCode, assign.body).toBeLessThan(300);

    const product = await call('POST', '/products', {
      sku: `I1223-${suffix}`,
      type: 'simple',
      name: 'Drill 1223',
      description: 'Drill',
      categoryIds: [],
      attributeSetId: setId,
      attributeValues: {},
      visibility: 'public',
    });
    expect(product.statusCode, product.body).toBe(201);
    productId = (product.json() as { data: { id: string } }).data.id;
  }, 60_000);

  afterAll(async () => {
    if (h) {
      await setAdminLanguage(languageBefore);
      if (productId) await call('DELETE', `/products/${productId}`);
      if (setId) await call('DELETE', `/attribute-sets/${setId}`);
      for (const key of createdAttributes) await call('DELETE', `/attributes/${key}`);
    }
    await teardownBackendServer(h);
  });

  function refusal(response: { statusCode: number; body: string }): ErrorBody['error'] {
    expect(response.statusCode, response.body).toBe(400);
    const error = (JSON.parse(response.body) as ErrorBody).error;
    expect(error.code).toBe('ATTRIBUTE_VALUE_REJECTED');
    return error;
  }

  function expectSentence(error: ErrorBody['error'], language: Language, sentence: Record<Language, string>): void {
    expect(error.message).toBe(sentence[language]);
    if (language === 'pl') expect(error.message).not.toBe(sentence.en);
  }

  describe.each(LANGUAGES)('for an operator working in %s', (language) => {
    beforeEach(async () => {
      await setAdminLanguage(language);
    });

    it('page_builder_content when a content key is sent in attributeValues, although it is in the set', async () => {
      const error = refusal(await call('PATCH', `/products/${productId}`, { attributeValues: { [CONTENT]: 'text' } }));
      expect(error.details).toEqual({ code: 'page_builder_content', attributeKeys: CONTENT });
      expectSentence(error, language, {
        en: SENTENCES.pageBuilderContent.en(CONTENT),
        pl: SENTENCES.pageBuilderContent.pl(CONTENT),
      });
    });

    it('not_content_attribute when the content PUT names an ordinary attribute of the set', async () => {
      const error = refusal(
        await call('PUT', `/products/${productId}/content/${PLAIN}`, { content: { languages: {} } }),
      );
      expect(error.details).toEqual({ code: 'not_content_attribute', attributeKey: PLAIN });
      expectSentence(error, language, {
        en: SENTENCES.notContentAttribute.en(PLAIN),
        pl: SENTENCES.notContentAttribute.pl(PLAIN),
      });
    });

    it('keeps the attribute-set sentence and the per-key details for a key outside the set', async () => {
      const error = refusal(await call('PATCH', `/products/${productId}`, { attributeValues: { [OUTSIDE]: 'x' } }));
      expect(error.details).toEqual([
        { path: `attributeValues.${OUTSIDE}`, issue: "attribute is not assigned to this Product's AttributeSet" },
      ]);
      expectSentence(error, language, SENTENCES.notInSet);
    });
  });
});
