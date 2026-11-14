import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser, Product } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';

/**
 * Issue #624 (#86), the attribute family — refusals of `catalog`'s attribute
 * and option writes that were raised as `VALIDATION_FAILED`, though the request
 * was well formed and the stored state refused it: a key another attribute
 * holds, a value type products already hold values of, an attribute still in a
 * set or on products, an option value or a default the stored options already
 * have, options or a slider on a type that takes none, and an option products
 * carry. `VALIDATION_FAILED` is the one code whose message the error envelope
 * never replaces, so the operator read the thrower's English sentence or a
 * machine token (`option_in_use: …`) whatever their language. Each now has its
 * own code, a sentence in English and Polish, and the values it names in
 * `details`.
 *
 * The sentences are written out here rather than read from the bundle: a test
 * that loads the file it checks asserts only that JSON parses. The operator is
 * answered in their stored language (D-132), so each case sets it.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const LANGUAGES = ['en', 'pl'] as const;
type Language = (typeof LANGUAGES)[number];

const ADMIN = { b2b_session: 'stub-admin-session' };
const BASE = '/api/v1/admin/catalog';

const SENTENCES = {
  keyTaken: {
    en: (key: string) => `An attribute with the key ${key} already exists. Choose a different key.`,
    pl: (key: string) => `Atrybut o kluczu ${key} już istnieje. Wybierz inny klucz.`,
  },
  valueTypeLocked: {
    en: (key: string) =>
      `The value type of the attribute ${key} cannot change while products hold values for it. Clear those values first.`,
    pl: (key: string) =>
      `Nie można zmienić typu wartości atrybutu ${key}, dopóki produkty mają jego wartości. Najpierw wyczyść te wartości.`,
  },
  inAttributeSets: {
    en: (key: string, count: number) =>
      `Attribute sets that contain the attribute ${key}: ${count}. Remove it from those sets before you delete it.`,
    pl: (key: string, count: number) =>
      `Zestawy atrybutów, które zawierają atrybut ${key}: ${count}. Usuń go z tych zestawów, zanim go usuniesz.`,
  },
  onProducts: {
    en: (key: string, count: number) =>
      `Products that hold a value of the attribute ${key}: ${count}. Clear those values before you delete it.`,
    pl: (key: string, count: number) =>
      `Produkty, które mają wartość atrybutu ${key}: ${count}. Wyczyść te wartości, zanim go usuniesz.`,
  },
  optionValueTaken: {
    en: (key: string, value: string) =>
      `The attribute ${key} already has an option with the value ${value}. Choose a different value.`,
    pl: (key: string, value: string) =>
      `Atrybut ${key} ma już opcję o wartości ${value}. Wybierz inną wartość.`,
  },
  defaultOptionTaken: {
    en: (key: string, value: string) =>
      `The attribute ${key} already has a default option, so ${value} cannot be the default too. Clear the current default first.`,
    pl: (key: string, value: string) =>
      `Atrybut ${key} ma już opcję domyślną, więc ${value} nie może być również domyślna. Najpierw odznacz obecną opcję domyślną.`,
  },
  optionsNotSupported: {
    en: (key: string) =>
      `The attribute ${key} takes no options: options belong to select and multiselect attributes.`,
    pl: (key: string) =>
      `Atrybut ${key} nie przyjmuje opcji: opcje mają atrybuty jednokrotnego i wielokrotnego wyboru.`,
  },
  optionInUse: {
    en: (key: string, value: string, count: number) =>
      `Products that carry the option ${value} of the attribute ${key}: ${count}. Clear it from them before you delete the option.`,
    pl: (key: string, value: string, count: number) =>
      `Produkty, które mają opcję ${value} atrybutu ${key}: ${count}. Usuń ją z nich, zanim usuniesz opcję.`,
  },
  sliderNotSupported: {
    en: (key: string) =>
      `The attribute ${key} cannot be shown as a slider: a slider is for number and price attributes.`,
    pl: (key: string) =>
      `Atrybutu ${key} nie można wyświetlać jako suwaka: suwak jest dla atrybutów liczbowych i cenowych.`,
  },
} as const;

const ALL_CODES = [
  'ATTRIBUTE_KEY_TAKEN',
  'ATTRIBUTE_VALUE_TYPE_LOCKED',
  'ATTRIBUTE_IN_USE',
  'ATTRIBUTE_OPTION_VALUE_TAKEN',
  'ATTRIBUTE_DEFAULT_OPTION_TAKEN',
  'ATTRIBUTE_OPTIONS_NOT_SUPPORTED',
  'ATTRIBUTE_OPTION_IN_USE',
  'ATTRIBUTE_SLIDER_NOT_SUPPORTED',
] as const;

describe('catalog attribute refusals carry their own code and sentence (issue #624)', () => {
  let h: BackendServerHandle;
  let languageBefore: string | null = null;
  /** Only what this file creates is removed — never a table-wide wipe. */
  const created = { attributes: [] as string[], attributeSets: [] as string[], products: [] as string[] };
  const unique = () => randomUUID().replace(/-/g, '').slice(0, 10);

  beforeAll(async () => {
    h = await setupBackendServer();
    languageBefore = (await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;
  }, 60_000);

  afterAll(async () => {
    if (h) {
      await setAdminLanguage(languageBefore);
      const sql = (statement: string, params: unknown[]) => h.em().getConnection().execute(statement, params);
      if (created.products.length > 0) {
        await sql(`delete from "products" where "id" = any(?::uuid[])`, [`{${created.products.join(',')}}`]);
      }
      for (const id of created.attributeSets) {
        await h.app.inject({ method: 'DELETE', url: `${BASE}/attribute-sets/${id}`, cookies: ADMIN });
      }
      for (const key of created.attributes) {
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

  const call = (method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
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

  async function createAttribute(
    type: 'input' | 'select',
    options: Array<{ value: string; labelDefault: string; isDefault?: boolean }> = [],
  ): Promise<{ id: string; key: string }> {
    const key = `i624_${unique()}`;
    const response = await call('POST', '/attributes', {
      key,
      label: { 'en-US': key },
      labelDefault: key,
      type,
      isSearchable: false,
      isFilterable: false,
      isVariantAxis: false,
      ...(options.length > 0 ? { options } : {}),
    });
    expect(response.statusCode, response.body).toBe(201);
    created.attributes.push(key);
    return { id: (response.json() as { data: { id: string } }).data.id, key };
  }

  /** A live product holding `values`, written past the set rules: the guards read stored state. */
  async function seedProductWith(values: Record<string, unknown>): Promise<void> {
    const em = h.em().fork();
    const stamp = unique();
    const product = em.create(Product, {
      sku: `I624-${stamp}`,
      slug: `i624-${stamp}`,
      type: 'simple',
      status: 'active',
      name: `I624 ${stamp}`,
      description: 'Issue 624',
      visibility: 'public',
      attributeValues: values,
    });
    await em.persistAndFlush(product);
    created.products.push(product.id);
  }

  async function optionsOf(attributeId: string): Promise<Array<{ id: string; value: string }>> {
    const response = await h.app.inject({ method: 'GET', url: `${BASE}/attributes/${attributeId}/options`, cookies: ADMIN });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: { items: Array<{ id: string; value: string }> } }).data.items;
  }

  describe.each(LANGUAGES)('for an operator working in %s', (language) => {
    beforeEach(async () => {
      await setAdminLanguage(language);
    });

    it('ATTRIBUTE_KEY_TAKEN when the key is another attribute’s', async () => {
      const { key } = await createAttribute('input');
      const error = refusal(
        await call('POST', '/attributes', {
          key,
          label: { 'en-US': key },
          labelDefault: key,
          type: 'input',
          isSearchable: false,
          isFilterable: false,
          isVariantAxis: false,
        }),
        409,
        'ATTRIBUTE_KEY_TAKEN',
      );
      expect(error.details).toEqual({ attributeKey: key });
      expectSentence(error, language, { en: SENTENCES.keyTaken.en(key), pl: SENTENCES.keyTaken.pl(key) });
    });

    it('ATTRIBUTE_VALUE_TYPE_LOCKED when products hold values of the type', async () => {
      const { key } = await createAttribute('input');
      await seedProductWith({ [key]: 'some text' });
      const error = refusal(await call('PATCH', `/attributes/${key}`, { type: 'number' }), 409, 'ATTRIBUTE_VALUE_TYPE_LOCKED');
      expect(error.details).toEqual({ attributeKey: key });
      expectSentence(error, language, { en: SENTENCES.valueTypeLocked.en(key), pl: SENTENCES.valueTypeLocked.pl(key) });
    });

    it('ATTRIBUTE_IN_USE (attribute_sets) when an attribute set contains it', async () => {
      const { id, key } = await createAttribute('input');
      const set = await call('POST', '/attribute-sets', { code: `i624_${unique()}`, name: { 'en-US': 'Issue 624' } });
      expect(set.statusCode, set.body).toBe(201);
      const setId = (set.json() as { data: { id: string } }).data.id;
      created.attributeSets.unshift(setId);
      const assigned = await call('POST', `/attribute-sets/${setId}/attributes`, {
        assignments: [{ attributeId: id, position: 0 }],
      });
      expect(assigned.statusCode, assigned.body).toBe(200);

      const error = refusal(await call('DELETE', `/attributes/${key}`), 409, 'ATTRIBUTE_IN_USE');
      expect(error.details).toEqual({ code: 'attribute_sets', attributeKey: key, attributeSetCount: 1 });
      expectSentence(error, language, {
        en: SENTENCES.inAttributeSets.en(key, 1),
        pl: SENTENCES.inAttributeSets.pl(key, 1),
      });
      // Out of the set again, so the cleanup can delete the attribute.
      await call('DELETE', `/attribute-sets/${setId}/attributes/${id}`);
    });

    it('ATTRIBUTE_IN_USE (products) when products hold its values', async () => {
      const { key } = await createAttribute('input');
      await seedProductWith({ [key]: 'one' });
      await seedProductWith({ [key]: 'two' });
      const error = refusal(await call('DELETE', `/attributes/${key}`), 409, 'ATTRIBUTE_IN_USE');
      expect(error.details).toEqual({ code: 'products', attributeKey: key, productCount: 2 });
      expectSentence(error, language, { en: SENTENCES.onProducts.en(key, 2), pl: SENTENCES.onProducts.pl(key, 2) });
    });

    it('ATTRIBUTE_OPTION_VALUE_TAKEN when the attribute already has the value', async () => {
      const { id, key } = await createAttribute('select', [{ value: 'matte', labelDefault: 'Matte' }]);
      const error = refusal(
        await call('POST', `/attributes/${id}/options`, { value: 'matte', labelDefault: 'Matte again' }),
        409,
        'ATTRIBUTE_OPTION_VALUE_TAKEN',
      );
      expect(error.details).toEqual({ attributeKey: key, value: 'matte' });
      expectSentence(error, language, {
        en: SENTENCES.optionValueTaken.en(key, 'matte'),
        pl: SENTENCES.optionValueTaken.pl(key, 'matte'),
      });
    });

    it('ATTRIBUTE_DEFAULT_OPTION_TAKEN on a new option and on an option made the default', async () => {
      const { id, key } = await createAttribute('select', [
        { value: 'matte', labelDefault: 'Matte', isDefault: true },
        { value: 'gloss', labelDefault: 'Gloss' },
      ]);
      const onCreate = refusal(
        await call('POST', `/attributes/${id}/options`, { value: 'satin', labelDefault: 'Satin', isDefault: true }),
        409,
        'ATTRIBUTE_DEFAULT_OPTION_TAKEN',
      );
      expect(onCreate.details).toEqual({ attributeKey: key, value: 'satin' });
      expectSentence(onCreate, language, {
        en: SENTENCES.defaultOptionTaken.en(key, 'satin'),
        pl: SENTENCES.defaultOptionTaken.pl(key, 'satin'),
      });

      const gloss = (await optionsOf(id)).find((option) => option.value === 'gloss')!;
      const onUpdate = refusal(
        await call('PATCH', `/attributes/${id}/options/${gloss.id}`, { isDefault: true }),
        409,
        'ATTRIBUTE_DEFAULT_OPTION_TAKEN',
      );
      expect(onUpdate.details).toEqual({ attributeKey: key, value: 'gloss' });
      expectSentence(onUpdate, language, {
        en: SENTENCES.defaultOptionTaken.en(key, 'gloss'),
        pl: SENTENCES.defaultOptionTaken.pl(key, 'gloss'),
      });
    });

    it('ATTRIBUTE_OPTIONS_NOT_SUPPORTED when the attribute’s type takes no options', async () => {
      const { id, key } = await createAttribute('input');
      const error = refusal(
        await call('POST', `/attributes/${id}/options`, { value: 'matte', labelDefault: 'Matte' }),
        400,
        'ATTRIBUTE_OPTIONS_NOT_SUPPORTED',
      );
      expect(error.details).toEqual({ attributeKey: key, valueType: 'string' });
      expectSentence(error, language, {
        en: SENTENCES.optionsNotSupported.en(key),
        pl: SENTENCES.optionsNotSupported.pl(key),
      });
    });

    it('ATTRIBUTE_OPTION_IN_USE (products) when products carry the option', async () => {
      const { id, key } = await createAttribute('select', [{ value: 'matte', labelDefault: 'Matte' }]);
      await seedProductWith({ [key]: 'matte' });
      const matte = (await optionsOf(id)).find((option) => option.value === 'matte')!;
      const error = refusal(await call('DELETE', `/attributes/${id}/options/${matte.id}`), 409, 'ATTRIBUTE_OPTION_IN_USE');
      expect(error.details).toEqual({ code: 'products', attributeKey: key, value: 'matte', productCount: 1 });
      expectSentence(error, language, {
        en: SENTENCES.optionInUse.en(key, 'matte', 1),
        pl: SENTENCES.optionInUse.pl(key, 'matte', 1),
      });
    });

    it('ATTRIBUTE_SLIDER_NOT_SUPPORTED when the stored type is not numeric', async () => {
      const { key } = await createAttribute('input');
      const error = refusal(
        await call('PATCH', `/attributes/${key}`, { displayAsSlider: true }),
        400,
        'ATTRIBUTE_SLIDER_NOT_SUPPORTED',
      );
      expect(error.details).toEqual({ attributeKey: key, valueType: 'string' });
      expectSentence(error, language, {
        en: SENTENCES.sliderNotSupported.en(key),
        pl: SENTENCES.sliderNotSupported.pl(key),
      });
    });
  });

  it('routes the codes to catalog, the module that raises them', () => {
    for (const code of ALL_CODES) {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]?.moduleId, code).toBe('catalog');
    }
  });
});
