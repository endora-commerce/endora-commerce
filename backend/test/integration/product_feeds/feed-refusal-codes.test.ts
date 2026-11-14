import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser, Language } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';

/**
 * Issue #631 (#86) — three refusals of the feed form were `400
 * VALIDATION_FAILED` with an English `field: message` literal: a language that
 * exists but is switched off, a currency the sales channel does not offer, and
 * a slug another feed holds. Each is a well-formed request the installation's
 * state refuses. The envelope never replaces the message of
 * `VALIDATION_FAILED`, so an operator working in Polish read English, and the
 * allowed currencies were baked into the text. Each now has its own code, a
 * sentence in English and Polish, and the values that sentence names in
 * `details`. `details.field` stays, so a form can still place the sentence.
 *
 * The sentences are written out here rather than read from the bundle: a test
 * that loads the file it checks asserts only that JSON parses. The operator is
 * answered in their stored language (D-132), so each case sets it.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const INACTIVE_LANGUAGE = 'xx-QA';

const LANGUAGE_INACTIVE = {
  en: (code: string) =>
    `The language "${code}" is not active on this installation, so a feed cannot be published in it. Activate the language or choose another one.`,
  pl: (code: string) =>
    `Język „${code}” nie jest aktywny w tej instalacji, więc nie można publikować w nim feedu. Aktywuj ten język albo wybierz inny.`,
};
const CURRENCY_NOT_OFFERED = {
  en: (code: string, allowed: string) =>
    `The sales channel does not offer the currency "${code}". Choose one it offers: ${allowed}.`,
  pl: (code: string, allowed: string) =>
    `Kanał sprzedaży nie oferuje waluty „${code}”. Wybierz jedną z oferowanych: ${allowed}.`,
};
const SLUG_TAKEN = {
  en: (slug: string) => `Another feed already uses the slug "${slug}". Choose a different slug.`,
  pl: (slug: string) => `Inny feed używa już adresu (slug) „${slug}”. Wybierz inny adres.`,
};

describe('feed form refusals carry their own code and sentence (issue #631)', () => {
  let h: BackendServerHandle;
  let languageBefore: string | null = null;
  let templateId: string;
  let channelId: string;
  let allowedCurrencies: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    languageBefore =
      (await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;

    const templates = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/feed-templates',
      ...ADMIN,
    });
    expect(templates.statusCode).toBe(200);
    const rows = (templates.json() as { data: Array<{ id: string; systemCode: string | null }> })
      .data;
    templateId = rows.find((t) => t.systemCode === 'google_merchant_v1')!.id;

    const channel = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });
    channelId = channel.id;
    const currencies = channel.currencies ?? [];
    allowedCurrencies = (currencies.length > 0 ? currencies : [channel.defaultCurrency]).join(', ');

    em.create(Language, { code: INACTIVE_LANGUAGE, label: 'Switched-off language', isActive: false });
    await em.flush();
  }, 60_000);

  afterAll(async () => {
    if (h) {
      await setAdminLanguage(languageBefore);
      await h.em().fork().nativeDelete(Language, { code: INACTIVE_LANGUAGE });
    }
    await teardownBackendServer(h);
  });

  async function setAdminLanguage(value: string | null): Promise<void> {
    const em = h.em().fork();
    const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    admin.preferredLanguage = value;
    await em.flush();
  }

  function body(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      name: 'Refusal feed',
      slug: `refusal-feed-${randomUUID().slice(0, 8)}`,
      feedTemplateId: templateId,
      salesChannelId: channelId,
      languageCode: 'en-US',
      currencyCode: 'PLN',
      pricePresentation: 'gross',
      taxCountry: 'PL',
      ...over,
    };
  }

  async function createFeed(): Promise<{ id: string; slug: string }> {
    const payload = body();
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload,
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = String((res.json() as { data: { feed: { id: string } } }).data.feed.id);
    return { id, slug: String(payload['slug']) };
  }

  async function refused(
    request: { method: 'POST' | 'PATCH'; url: string; payload: Record<string, unknown> },
    code: string,
  ): Promise<ErrorBody['error']> {
    const res = await h.app.inject({ ...request, ...ADMIN });
    expect(res.statusCode, res.body).toBe(400);
    const error = (res.json() as ErrorBody).error;
    expect(error.code).toBe(code);
    return error;
  }

  it.each(['en', 'pl'] as const)(
    'PRODUCT_FEED_LANGUAGE_INACTIVE for a language that exists but is switched off (%s)',
    async (language) => {
      await setAdminLanguage(language);
      const error = await refused(
        {
          method: 'POST',
          url: '/api/v1/admin/product-feeds',
          payload: body({ languageCode: INACTIVE_LANGUAGE }),
        },
        'PRODUCT_FEED_LANGUAGE_INACTIVE',
      );
      expect(error.details).toEqual({ field: 'languageCode', languageCode: INACTIVE_LANGUAGE });
      expect(error.message).toBe(LANGUAGE_INACTIVE[language](INACTIVE_LANGUAGE));
      if (language === 'pl') expect(error.message).not.toBe(LANGUAGE_INACTIVE.en(INACTIVE_LANGUAGE));
    },
  );

  it('keeps VALIDATION_FAILED for a language code that names nothing', async () => {
    await setAdminLanguage('pl');
    const error = await refused(
      { method: 'POST', url: '/api/v1/admin/product-feeds', payload: body({ languageCode: 'zz-ZZ' }) },
      'VALIDATION_FAILED',
    );
    expect(error.details).toEqual({ field: 'languageCode' });
  });

  it.each(['en', 'pl'] as const)(
    'PRODUCT_FEED_CURRENCY_NOT_OFFERED for a currency the channel does not carry (%s)',
    async (language) => {
      await setAdminLanguage(language);
      const error = await refused(
        {
          method: 'POST',
          url: '/api/v1/admin/product-feeds',
          payload: body({ currencyCode: 'JPY' }),
        },
        'PRODUCT_FEED_CURRENCY_NOT_OFFERED',
      );
      expect(error.details).toEqual({
        field: 'currencyCode',
        currencyCode: 'JPY',
        salesChannelId: channelId,
        allowed: allowedCurrencies,
      });
      expect(error.message).toBe(CURRENCY_NOT_OFFERED[language]('JPY', allowedCurrencies));
      if (language === 'pl') {
        expect(error.message).not.toBe(CURRENCY_NOT_OFFERED.en('JPY', allowedCurrencies));
      }
    },
  );

  it.each(['en', 'pl'] as const)(
    'PRODUCT_FEED_SLUG_TAKEN on create and on update (%s)',
    async (language) => {
      await setAdminLanguage(language);
      const taken = await createFeed();
      const other = await createFeed();

      const onCreate = await refused(
        { method: 'POST', url: '/api/v1/admin/product-feeds', payload: body({ slug: taken.slug }) },
        'PRODUCT_FEED_SLUG_TAKEN',
      );
      expect(onCreate.details).toEqual({ field: 'slug', slug: taken.slug });
      expect(onCreate.message).toBe(SLUG_TAKEN[language](taken.slug));
      if (language === 'pl') expect(onCreate.message).not.toBe(SLUG_TAKEN.en(taken.slug));

      const onUpdate = await refused(
        {
          method: 'PATCH',
          url: `/api/v1/admin/product-feeds/${other.id}`,
          payload: { slug: taken.slug },
        },
        'PRODUCT_FEED_SLUG_TAKEN',
      );
      expect(onUpdate.details).toEqual({ field: 'slug', slug: taken.slug });
      expect(onUpdate.message).toBe(SLUG_TAKEN[language](taken.slug));
    },
  );

  it.each(['en', 'pl'] as const)('PRODUCT_FEED_SLUG_TAKEN on duplicate (%s)', async (language) => {
    await setAdminLanguage(language);
    const taken = await createFeed();

    const error = await refused(
      {
        method: 'POST',
        url: `/api/v1/admin/product-feeds/${taken.id}/duplicate`,
        payload: { name: 'Copy', slug: taken.slug },
      },
      'PRODUCT_FEED_SLUG_TAKEN',
    );
    expect(error.details).toEqual({ field: 'slug', slug: taken.slug });
    expect(error.message).toBe(SLUG_TAKEN[language](taken.slug));
    if (language === 'pl') expect(error.message).not.toBe(SLUG_TAKEN.en(taken.slug));
  });

  it('routes the three codes to product_feeds, the module that raises them', () => {
    for (const code of [
      'PRODUCT_FEED_LANGUAGE_INACTIVE',
      'PRODUCT_FEED_CURRENCY_NOT_OFFERED',
      'PRODUCT_FEED_SLUG_TAKEN',
    ]) {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]?.moduleId, code).toBe('product_feeds');
    }
  });
});
