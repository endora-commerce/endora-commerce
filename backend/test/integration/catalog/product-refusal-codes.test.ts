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
 * Issue #624 (#86), the product families — refusals of `catalog`'s product
 * writes that were raised as `VALIDATION_FAILED` although the request was well
 * formed and the stored state refused it: a SKU another product or variant
 * holds (`400 sku_in_use { … }`, where create answered `409
 * SKU_ALREADY_EXISTS`), a variant for a product that is not configurable, a
 * minimum order quantity on a type that takes none (on the product and per
 * channel), a set's required attributes left without a value
 * (`missing_required_attribute_values: …`), and the two grouped-item refusals.
 * `VALIDATION_FAILED` is the one code whose message the error envelope never
 * replaces, so the operator read the token or the English literal whatever
 * their language. Each now has its own code — or a token on an existing one —
 * a sentence in English and Polish, and the values it names in `details`.
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
  skuHeldByProduct: {
    en: (sku: string) => `The SKU ${sku} is already used by another product. Choose a different SKU.`,
    pl: (sku: string) => `SKU ${sku} jest już używany przez inny produkt. Wybierz inny SKU.`,
  },
  skuHeldByVariant: {
    en: (sku: string) => `The SKU ${sku} is already used by a product variant. Choose a different SKU.`,
    pl: (sku: string) => `SKU ${sku} jest już używany przez wariant produktu. Wybierz inny SKU.`,
  },
  variantsNeedConfigurable: {
    en: 'Variants can be added only to configurable products, and this product is not one.',
    pl: 'Warianty można dodawać tylko do produktów konfigurowalnych, a ten produkt nie jest konfigurowalny.',
  },
  minimumNotSupported: {
    en: 'A minimum order quantity applies to simple and configurable products only, so it cannot be set on this product.',
    pl: 'Minimalna ilość zamówienia dotyczy tylko produktów prostych i konfigurowalnych, więc nie można jej ustawić dla tego produktu.',
  },
  valuesRequired: {
    en: (keys: string) => `These attributes are required by the product's attribute set and need a value: ${keys}.`,
    pl: (keys: string) => `Te atrybuty są wymagane w zestawie atrybutów produktu i muszą mieć wartość: ${keys}.`,
  },
  groupedSelf: {
    en: 'A grouped product cannot contain itself.',
    pl: 'Produkt grupowy nie może zawierać samego siebie.',
  },
  groupedItemExists: {
    en: (sku: string) => `The product ${sku} is already in this group.`,
    pl: (sku: string) => `Produkt ${sku} jest już w tej grupie.`,
  },
} as const;

describe('catalog product refusals carry their own code and sentence (issue #624)', () => {
  let h: BackendServerHandle;
  let languageBefore: string | null = null;
  let defaultChannelId: string;
  /** Only what this file creates is removed — never a table-wide wipe. */
  const created = { products: [] as string[], attributes: [] as string[], attributeSets: [] as string[] };
  const unique = () => randomUUID().replace(/-/g, '').slice(0, 10);

  beforeAll(async () => {
    h = await setupBackendServer();
    languageBefore = (await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;
    const [channel] = await h
      .em()
      .getConnection()
      .execute<Array<{ id: string }>>(`select "id" from "sales_channels" where "system_default" = true`);
    defaultChannelId = channel!.id;
  }, 60_000);

  afterAll(async () => {
    if (h) {
      await setAdminLanguage(languageBefore);
      if (created.products.length > 0) {
        const ids = `{${created.products.join(',')}}`;
        const connection = h.em().getConnection();
        // A group's items first: `child_product_id` is `on delete restrict`.
        await connection.execute(`delete from "grouped_items" where "parent_product_id" = any(?::uuid[])`, [ids]);
        await connection.execute(`delete from "products" where "id" = any(?::uuid[])`, [ids]);
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

  async function createProduct(
    type: 'simple' | 'configurable' | 'grouped' | 'bundle' = 'simple',
  ): Promise<{ id: string; sku: string }> {
    const sku = `I624-${unique()}`;
    const response = await call('POST', '/products', {
      sku,
      type,
      name: sku,
      description: 'Issue 624',
      categoryIds: [],
      attributeValues: {},
      visibility: 'public',
    });
    expect(response.statusCode, response.body).toBe(201);
    const id = (response.json() as { data: { id: string } }).data.id;
    created.products.push(id);
    return { id, sku };
  }

  describe.each(LANGUAGES)('for an operator working in %s', (language) => {
    beforeEach(async () => {
      await setAdminLanguage(language);
    });

    it('SKU_ALREADY_EXISTS (held_by_product) when a rename takes another product’s SKU — 409, as create', async () => {
      const holder = await createProduct();
      const renamed = await createProduct();
      const error = refusal(await call('PATCH', `/products/${renamed.id}`, { sku: holder.sku }), 409, 'SKU_ALREADY_EXISTS');
      expect(error.details).toEqual({ code: 'held_by_product', sku: holder.sku, conflictingProductId: holder.id });
      expectSentence(error, language, {
        en: SENTENCES.skuHeldByProduct.en(holder.sku),
        pl: SENTENCES.skuHeldByProduct.pl(holder.sku),
      });
    });

    it('SKU_ALREADY_EXISTS (held_by_variant) when a rename takes a variant’s SKU', async () => {
      const parent = await createProduct('configurable');
      const variantSku = `I624-V-${unique()}`;
      const variant = await call('POST', `/products/${parent.id}/variants`, { sku: variantSku, variantAttributeValues: { color: 'red' } });
      expect(variant.statusCode, variant.body).toBe(201);
      const variantId = (variant.json() as { data: { id: string } }).data.id;
      const renamed = await createProduct();

      const error = refusal(await call('PATCH', `/products/${renamed.id}`, { sku: variantSku }), 409, 'SKU_ALREADY_EXISTS');
      expect(error.details).toEqual({ code: 'held_by_variant', sku: variantSku, conflictingVariantId: variantId });
      expectSentence(error, language, {
        en: SENTENCES.skuHeldByVariant.en(variantSku),
        pl: SENTENCES.skuHeldByVariant.pl(variantSku),
      });
    });

    it('PRODUCT_TYPE_MISMATCH (variants_need_configurable) for a variant of a simple product', async () => {
      const parent = await createProduct('simple');
      const error = refusal(
        await call('POST', `/products/${parent.id}/variants`, { sku: `I624-V-${unique()}`, variantAttributeValues: {} }),
        400,
        'PRODUCT_TYPE_MISMATCH',
      );
      expect(error.details).toEqual({ code: 'variants_need_configurable', productId: parent.id, productType: 'simple' });
      expectSentence(error, language, SENTENCES.variantsNeedConfigurable);
    });

    it('MIN_ORDER_QUANTITY_NOT_SUPPORTED_FOR_TYPE on the product and per channel', async () => {
      const bundle = await createProduct('bundle');
      const onProduct = refusal(
        await call('PATCH', `/products/${bundle.id}`, { minOrderQuantity: 5 }),
        422,
        'MIN_ORDER_QUANTITY_NOT_SUPPORTED_FOR_TYPE',
      );
      expect(onProduct.details).toEqual({ field: 'minOrderQuantity', productType: 'bundle' });
      expectSentence(onProduct, language, SENTENCES.minimumNotSupported);

      await h
        .em()
        .getConnection()
        .execute(
          `insert into "sales_channel_products" ("sales_channel_id", "product_id") values (?, ?) on conflict do nothing`,
          [defaultChannelId, bundle.id],
        );
      const perChannel = refusal(
        await call('PATCH', `/products/${bundle.id}/scopes`, {
          channels: [{ channelId: defaultChannelId, minOrderQuantity: 5 }],
        }),
        422,
        'MIN_ORDER_QUANTITY_NOT_SUPPORTED_FOR_TYPE',
      );
      expect(perChannel.details).toEqual({ field: 'minOrderQuantity', productType: 'bundle', channelId: defaultChannelId });
      expectSentence(perChannel, language, SENTENCES.minimumNotSupported);
    });

    it('ATTRIBUTE_VALUES_REQUIRED when the new attribute set requires a value the product lacks', async () => {
      const key = `i624_${unique()}`;
      const attribute = await call('POST', '/attributes', {
        key,
        label: { 'en-US': key },
        labelDefault: key,
        type: 'input',
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
        isRequired: true,
      });
      expect(attribute.statusCode, attribute.body).toBe(201);
      created.attributes.push(key);
      const set = await call('POST', '/attribute-sets', { code: `i624_${unique()}`, name: { 'en-US': 'Issue 624' } });
      expect(set.statusCode, set.body).toBe(201);
      const setId = (set.json() as { data: { id: string } }).data.id;
      created.attributeSets.unshift(setId);
      const assigned = await call('POST', `/attribute-sets/${setId}/attributes`, {
        assignments: [{ attributeId: (attribute.json() as { data: { id: string } }).data.id, position: 0 }],
      });
      expect(assigned.statusCode, assigned.body).toBe(200);
      const product = await createProduct();

      const error = refusal(
        await call('PATCH', `/products/${product.id}`, { attributeSetId: setId }),
        400,
        'ATTRIBUTE_VALUES_REQUIRED',
      );
      expect(error.details).toEqual({ attributeKeys: key });
      expectSentence(error, language, { en: SENTENCES.valuesRequired.en(key), pl: SENTENCES.valuesRequired.pl(key) });
      // Out of the set again, so the cleanup can delete the attribute and the set.
      await call('DELETE', `/attribute-sets/${setId}/attributes/${(attribute.json() as { data: { id: string } }).data.id}`);
    });

    it('SELF_LINK_NOT_ALLOWED (grouped) when a grouped product would contain itself', async () => {
      const group = await createProduct('grouped');
      const error = refusal(
        await call('POST', `/products/${group.id}/grouped-items`, { childProductId: group.id, quantity: 1 }),
        400,
        'SELF_LINK_NOT_ALLOWED',
      );
      expect(error.details).toEqual({ code: 'grouped', productId: group.id });
      expectSentence(error, language, SENTENCES.groupedSelf);
    });

    it('GROUPED_ITEM_ALREADY_EXISTS when the child is already in the group', async () => {
      const group = await createProduct('grouped');
      const child = await createProduct('simple');
      const first = await call('POST', `/products/${group.id}/grouped-items`, { childProductId: child.id, quantity: 1 });
      expect(first.statusCode, first.body).toBe(201);
      const error = refusal(
        await call('POST', `/products/${group.id}/grouped-items`, { childProductId: child.id, quantity: 2 }),
        409,
        'GROUPED_ITEM_ALREADY_EXISTS',
      );
      expect(error.details).toEqual({ parentProductId: group.id, childProductId: child.id, childSku: child.sku });
      expectSentence(error, language, {
        en: SENTENCES.groupedItemExists.en(child.sku),
        pl: SENTENCES.groupedItemExists.pl(child.sku),
      });
    });
  });

  it('routes the new codes to catalog, the module that raises them', () => {
    for (const code of ['MIN_ORDER_QUANTITY_NOT_SUPPORTED_FOR_TYPE', 'ATTRIBUTE_VALUES_REQUIRED', 'GROUPED_ITEM_ALREADY_EXISTS']) {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]?.moduleId, code).toBe('catalog');
    }
  });
});
