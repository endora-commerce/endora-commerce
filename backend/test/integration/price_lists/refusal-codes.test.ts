import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PriceBookWritePort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';

/**
 * Issue #636 (#86) — two refusals of `price_lists` fell through the
 * `validation()` helper's default `VALIDATION_FAILED`, though the request was
 * well formed and the stored state refused it: a variant's percentage or amount
 * adjustment left without the product's own base price in that currency, and a
 * channel set written to a base book. `VALIDATION_FAILED` is the one code whose
 * message the error envelope never replaces, so the reader got the English
 * literal, and the values sat only in the `[{ path, issue }]` array, which is
 * never interpolated. Each now has its own code, a sentence in English and
 * Polish, and the values that sentence names as scalar `details`.
 *
 * Neither refusal has a route today: the base-price one is raised by
 * `priceBookWritePort.replaceProductBaseTiers` (the PIM price import's seam),
 * the base-book one by `PriceBookService.replaceChannels`. Each is raised from
 * the composed service behind a test route, so the real envelope, routing and
 * installed bundles render it, and the language comes from `Accept-Language`.
 *
 * The sentences are written out here rather than read from the bundle: a test
 * that loads the file it checks asserts only that JSON parses.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const LANGUAGES = ['en', 'pl'] as const;
type Language = (typeof LANGUAGES)[number];

const SENTENCES = {
  basePriceRequired: {
    en: (currency: string) =>
      `A variant of this product has a percentage or amount adjustment, which needs the product's own base price in ${currency}. Keep a base price for the product in ${currency}, or remove the variant's adjustment first.`,
    pl: (currency: string) =>
      `Wariant tego produktu ma korektę procentową lub kwotową, która wymaga własnej ceny bazowej produktu w ${currency}. Zostaw produktowi cenę bazową w ${currency} albo najpierw usuń korektę wariantu.`,
  },
  baseHasNoChannels: {
    en: (currency: string) =>
      `The ${currency} base book applies in every sales channel and has no channel set. Bind a regular price book to the channels instead.`,
    pl: (currency: string) =>
      `Cennik bazowy ${currency} obowiązuje we wszystkich kanałach sprzedaży i nie ma zestawu kanałów. Przypisz do kanałów zwykły cennik.`,
  },
} as const;

describe('price_lists refusals carry their own code and sentence (issue #636)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;

  beforeAll(async () => {
    h = await setupBackendServer({
      extraModules: [
        async (instance) => {
          instance.post<{ Params: { productId: string } }>('/_test/i636-base-tiers/:productId', async (request) => {
            const port = (h.container as unknown as { resolve<T>(name: string): T }).resolve<PriceBookWritePort>(
              'priceBookWritePort',
            );
            // An empty PLN tier list for the product, keeping its variants' rows.
            await f.system(() => port.replaceProductBaseTiers(request.params.productId, { PLN: [] }));
            return { ok: true };
          });
          instance.post<{ Params: { bookId: string }; Body: { channelIds: string[] } }>(
            '/_test/i636-base-channels/:bookId',
            async (request) => {
              await f.system(() => f.books.replaceChannels(request.params.bookId, request.body.channelIds));
              return { ok: true };
            },
          );
        },
      ],
    });
    f = await setupPricingFixture(h);
  }, 5 * 60_000);

  afterAll(async () => {
    // Only the fixture's own products' base prices were touched; put them back.
    if (f) await f.resetBase();
    await teardownBackendServer(h);
  });

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

  it.each(LANGUAGES)(
    "PRICE_BOOK_BASE_PRICE_REQUIRED when a variant's adjustment would lose the product's base price (%s)",
    async (language) => {
      // P5r carries +10 % on P5's own PLN base price (the fixture's base state).
      const response = await h.app.inject({
        method: 'POST',
        url: `/_test/i636-base-tiers/${f.products.P5.id}`,
        headers: { 'accept-language': language },
      });
      const error = refusal(response, 400, 'PRICE_BOOK_BASE_PRICE_REQUIRED');
      expect(error.details).toEqual({
        productId: f.products.P5.id,
        currency: 'PLN',
        issues: [
          {
            path: 'byCurrency.PLN.product',
            issue: "A variant's percentage or amount adjustment needs the product's own base price in this currency.",
          },
        ],
      });
      expectSentence(error, language, {
        en: SENTENCES.basePriceRequired.en('PLN'),
        pl: SENTENCES.basePriceRequired.pl('PLN'),
      });
    },
  );

  it.each(LANGUAGES)('PRICE_BOOK_BASE_HAS_NO_CHANNELS when a channel set is written to a base book (%s)', async (language) => {
    const [base] = await h
      .em()
      .getConnection()
      .execute<Array<{ id: string }>>(`select "id" from "price_lists" where "is_system" = true and "currency_code" = 'PLN'`);
    expect(base, 'the fixture keeps a PLN base book').toBeDefined();
    const response = await h.app.inject({
      method: 'POST',
      url: `/_test/i636-base-channels/${base!.id}`,
      headers: { 'accept-language': language },
      payload: { channelIds: [f.channels.CH1.id] },
    });
    const error = refusal(response, 400, 'PRICE_BOOK_BASE_HAS_NO_CHANNELS');
    expect(error.details).toEqual({ priceBookId: base!.id, currency: 'PLN' });
    expectSentence(error, language, {
      en: SENTENCES.baseHasNoChannels.en('PLN'),
      pl: SENTENCES.baseHasNoChannels.pl('PLN'),
    });
  });

  it('routes the two codes to price_lists, the module that raises them', () => {
    for (const code of ['PRICE_BOOK_BASE_PRICE_REQUIRED', 'PRICE_BOOK_BASE_HAS_NO_CHANNELS']) {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]?.moduleId, code).toBe('price_lists');
    }
  });
});
