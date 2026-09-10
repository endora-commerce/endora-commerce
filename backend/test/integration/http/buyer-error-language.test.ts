import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * Issue #234 — a buyer is answered in the language their client renders in
 * (feature 083, D-130/D-131).
 *
 * `resolvePreferredLanguage` answered `null` for every actor that is not an
 * admin, and the envelope turns `null` into the platform fallback, so every
 * Polish error sentence the platform ships has been unreachable for buyers
 * since the hook was written. The suite could not notice: 27 files assert
 * `error.message`, none of them sends `Accept-Language` and none sends
 * `X-Sales-Channel`, so English was both the answer and the assertion.
 *
 * One test per rung of the buyer ladder, on the **exact** sentence:
 *
 *   1. `Accept-Language`, q-weighted        — R1, R2
 *   2. the resolved channel's `defaultLanguage` — R3, R4
 *   3. `LANGUAGE_FALLBACK`                   — covered by every other suite
 *
 * Asserting anything weaker than the sentence proves nothing here: a check for
 * a 4xx, or for a non-empty message, is satisfied by exactly the English the
 * defect produces.
 */
describe('the language a buyer is answered in (issue #234)', () => {
  let h: BackendServerHandle;

  /**
   * The sentences `src/modules/carts/i18n/{en,pl}.json` file under
   * `errors.CART_COUPON_REJECTED.invalid_code`, written out rather than read
   * from the bundle: a test that loads the file it is checking asserts only
   * that JSON parses.
   */
  const EN_INVALID_CODE = 'This coupon code is invalid.';
  const PL_INVALID_CODE = 'Nieprawidłowy kod kuponu.';

  /**
   * A channel of its own, whose `defaultLanguage` is Polish. The system-default
   * channel is `en-US` and is shared by the whole run — moving it would make a
   * claim about the platform rather than about this test (contract § 4).
   */
  const PL_CHANNEL_CODE = 'w234-pl-market';

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    if (!(await em.findOne(SalesChannel, { code: PL_CHANNEL_CODE }))) {
      await em.persistAndFlush(
        em.create(SalesChannel, {
          code: PL_CHANNEL_CODE,
          name: { en: 'Polish market (issue 234)' },
          defaultLanguage: 'pl-PL',
          languages: ['pl-PL'],
          defaultCurrency: 'PLN',
          currencies: ['PLN'],
        }),
      );
    }
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** An anonymous cart holding one line, so the coupon route gets past `CART_EMPTY`. */
  async function cartWithALine(label: string): Promise<Record<string, string>> {
    const cookies = { b2b_cart_anon: `anon-w234-${label}-${Date.now()}` };
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      cookies,
    });
    expect(add.statusCode).toBe(200);
    return cookies;
  }

  /** Refuse an unknown coupon code, under whatever headers the caller sends. */
  async function refusal(
    label: string,
    headers: Record<string, string>,
  ): Promise<{ message: string; contentLanguage: string | undefined; vary: string | undefined }> {
    const cookies = await cartWithALine(label);
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/coupon',
      payload: { code: 'W234NOSUCHCODE' },
      cookies,
      headers,
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { code: string; message: string; details: { reason: string } } };
    expect(body.error.code).toBe(ERROR_CODES.CART_COUPON_REJECTED);
    expect(body.error.details.reason).toBe('invalid_code');
    const header = (name: string): string | undefined => {
      const value = res.headers[name];
      const first = Array.isArray(value) ? value[0] : value;
      return first === undefined ? undefined : String(first);
    };
    return {
      message: body.error.message,
      contentLanguage: header('content-language'),
      vary: header('vary'),
    };
  }

  it('R1 — a buyer asking for Polish is refused in Polish', async () => {
    const { message } = await refusal('r1', { 'accept-language': 'pl' });
    expect(message).toBe(PL_INVALID_CODE);
  });

  it('R2 — the header is q-weighted, not read as its first tag', async () => {
    // The contract's row: `en-US` carries an implicit q=1 and outranks `pl`.
    const { message } = await refusal('r2', { 'accept-language': 'en-US,pl;q=0.9' });
    expect(message).toBe(EN_INVALID_CODE);

    // …and the row that tells the two parsers apart, over HTTP rather than
    // only in the unit proof. `split(',')[0]` — what `catalog`, `search` and
    // `cms` still do (T024) — answers English here, which is the wrong
    // language by the client's own statement.
    const weighted = await refusal('r2-weighted', { 'accept-language': 'en;q=0.2,pl;q=0.9' });
    expect(weighted.message).toBe(PL_INVALID_CODE);
  });

  it('R3 — with no header, the resolved channel answers, and pl-PL normalises to pl', async () => {
    const { message } = await refusal('r3', { 'x-sales-channel': PL_CHANNEL_CODE });
    expect(message).toBe(PL_INVALID_CODE);
  });

  it('R4 — a language the platform ships no bundle for falls through to the channel', async () => {
    // `de-DE` never becomes a language: it fails to normalise and the ladder
    // proceeds. It is not an error and is not echoed back (D-139 § 8.1).
    const { message } = await refusal('r4', {
      'accept-language': 'de-DE',
      'x-sales-channel': PL_CHANNEL_CODE,
    });
    expect(message).toBe(PL_INVALID_CODE);
  });

  it('R7 — a translated refusal says which language it answered in', async () => {
    // D-139 § 8.2: the channel resolver already echoes `X-Sales-Channel` for
    // exactly this reason. Had the error path echoed its language, #234 would
    // have been visible in a browser's network tab from the first day.
    const polish = await refusal('r7-pl', { 'accept-language': 'pl' });
    expect(polish.contentLanguage).toBe('pl');
    const english = await refusal('r7-en', { 'accept-language': 'en' });
    expect(english.contentLanguage).toBe('en');
    // And says the body varies with the header that chose it, so a shared
    // cache cannot serve one buyer's language to the next (D-139 § 8.3).
    expect(polish.vary).toContain('Accept-Language');
  });
});
