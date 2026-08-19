import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type CouponDropReason } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { promotionServiceFor } from '../../helpers/promotion-service.js';
import { ERROR_TRANSLATION_KEYS } from '../../../src/modules/_i18n/services/error-translation.js';
import { CustomerGroup } from '../../../src/modules/customer_accounts/entities/customer-group.entity.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * Issue #231 — a refused coupon must say *why*, in the buyer's language.
 *
 * `carts` ships a written, translated sentence for every member of
 * `couponDropReasonSchema`. Every one of them was unreachable, for a two-word
 * reason: the throw put the discriminator in `details.reason`, and
 * `refusalToken` (`src/http/error-envelope.ts`) reads `details.code`. The
 * envelope therefore never built the `errors.CART_COUPON_REJECTED.<token>` key
 * the sentences are filed under, and a buyer under the minimum spend was told
 * the code "could not be applied" — or, before the family was routed to
 * `carts`, was shown the raw string `CART_COUPON_REJECTED`.
 *
 * The assertions are the **exact wording**, deliberately. A generic sentence
 * satisfies every assertion that merely checks for a 4xx or a non-empty
 * message, which is precisely how seven finished sentences stayed dead through
 * a green suite.
 */
describe('a refused coupon carries the sentence written for its reason (issue #231)', () => {
  let h: BackendServerHandle;
  let vipGroupId: string;

  /**
   * The English sentence each reason renders, copied from
   * `src/modules/carts/i18n/en.json`. Written out rather than read from the
   * bundle: a test that loads the same file it is checking asserts only that
   * JSON parses.
   */
  const EN: Record<CouponDropReason, string> = {
    invalid_code: 'This coupon code is invalid.',
    expired: 'This coupon code has expired.',
    below_min_spend: 'Add more to your cart to unlock this promotion.',
    wrong_channel: 'This coupon does not apply in this sales channel.',
    wrong_customer_group: 'This coupon is not available for your customer group.',
    wrong_organization: 'This coupon is not available for your organization.',
    coupon_format_invalid: "Coupon codes use only uppercase letters, digits, '-' and '_'.",
  };

  const PL: Record<CouponDropReason, string> = {
    invalid_code: 'Nieprawidłowy kod kuponu.',
    expired: 'Kod kuponu wygasł.',
    below_min_spend: 'Dodaj więcej produktów, aby odblokować tę promocję.',
    wrong_channel: 'Ten kupon nie obowiązuje w tym kanale sprzedaży.',
    wrong_customer_group: 'Ten kupon nie jest dostępny dla Twojej grupy klientów.',
    wrong_organization: 'Ten kupon nie jest dostępny dla Twojej organizacji.',
    coupon_format_invalid: "Kody kuponów mogą zawierać tylko duże litery, cyfry, '-' i '_'.",
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const vip = em.create(CustomerGroup, { code: 'i231-vip', name: 'VIP (issue 231)' });
    await em.persistAndFlush(vip);
    vipGroupId = vip.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** An anonymous cart holding one line, so the coupon route gets past `CART_EMPTY`. */
  async function cartWithALine(label: string): Promise<Record<string, string>> {
    const cookies = { b2b_cart_anon: `anon-i231-${label}-${Date.now()}` };
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      cookies,
    });
    expect(add.statusCode).toBe(200);
    return cookies;
  }

  interface Refusal {
    error: {
      code: string;
      message: string;
      details: { reason: string; code?: string };
    };
  }

  async function applyAndExpectRefusal(
    cookies: Record<string, string>,
    code: string,
  ): Promise<Refusal['error']> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/coupon',
      payload: { code },
      cookies,
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as Refusal;
    expect(body.error.code).toBe(ERROR_CODES.CART_COUPON_REJECTED);
    return body.error;
  }

  it('invalid_code — an unknown code is named as invalid, not merely "not applied"', async () => {
    const cookies = await cartWithALine('invalid');
    const error = await applyAndExpectRefusal(cookies, 'W231NOSUCHCODE');
    expect(error.details.reason).toBe('invalid_code');
    // Additive: `reason` is what the published contract carries, `code` is what
    // the envelope reads. Both, so no client branching on `reason` breaks.
    expect(error.details.code).toBe('invalid_code');
    expect(error.message).toBe(EN.invalid_code);
  });

  it('expired — a lapsed code says it expired', async () => {
    await promotionServiceFor(h).upsert({
      code: 'W231EXPIRED',
      name: 'Expired (issue 231)',
      kind: 'percentage_off',
      value: 10,
      validUntil: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const cookies = await cartWithALine('expired');
    const error = await applyAndExpectRefusal(cookies, 'W231EXPIRED');
    expect(error.details.reason).toBe('expired');
    expect(error.details.code).toBe('expired');
    expect(error.message).toBe(EN.expired);
  });

  it('below_min_spend — the buyer is told to add more, not that the code is bad', async () => {
    await promotionServiceFor(h).upsert({
      code: 'W231MINSPEND',
      name: 'High minimum (issue 231)',
      kind: 'percentage_off',
      value: 10,
      minCartSubtotal: 100_000,
    });
    const cookies = await cartWithALine('minspend');
    const error = await applyAndExpectRefusal(cookies, 'W231MINSPEND');
    expect(error.details.reason).toBe('below_min_spend');
    expect(error.details.code).toBe('below_min_spend');
    expect(error.message).toBe(EN.below_min_spend);
  });

  it('wrong_organization — an organization-restricted code says so', async () => {
    await promotionServiceFor(h).upsert({
      code: 'W231ORGONLY',
      name: 'Organization only (issue 231)',
      kind: 'percentage_off',
      value: 10,
      organizationId: TEST_ORGANIZATION_ID,
    });
    const cookies = await cartWithALine('org');
    const error = await applyAndExpectRefusal(cookies, 'W231ORGONLY');
    expect(error.details.reason).toBe('wrong_organization');
    expect(error.details.code).toBe('wrong_organization');
    expect(error.message).toBe(EN.wrong_organization);
  });

  it('wrong_customer_group — a group-restricted code says so', async () => {
    await promotionServiceFor(h).upsert({
      code: 'W231VIPONLY',
      name: 'VIP only (issue 231)',
      kind: 'percentage_off',
      value: 10,
      customerGroupId: vipGroupId,
    });
    const cookies = await cartWithALine('group');
    const error = await applyAndExpectRefusal(cookies, 'W231VIPONLY');
    expect(error.details.reason).toBe('wrong_customer_group');
    expect(error.details.code).toBe('wrong_customer_group');
    expect(error.message).toBe(EN.wrong_customer_group);
  });

  /**
   * The routing move the seven sentences needed, asserted on the code that
   * pays for it in the same request.
   *
   * `CART_COUPON_REJECTED` was routed to `core`, which holds no sentence for
   * it, so the buyer was shown the literal string `CART_COUPON_REJECTED` — the
   * token key could not have been read even once it was built. Moving the
   * family to `carts` moves `CART_EMPTY` with it, and this is the assertion
   * that the move improved rather than broke it: `_i18n` answered `Cart Empty.`
   * in English and `Błąd: cart empty.` — an English fragment prefixed with the
   * Polish word for "error" — in Polish.
   */
  it('CART_EMPTY, which moved bundles with the family, keeps a written sentence', async () => {
    const cookies = { b2b_cart_anon: `anon-i231-empty-${Date.now()}` };
    await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies });
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/coupon',
      payload: { code: 'W231ANYTHING' },
      cookies,
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe(ERROR_CODES.CART_EMPTY);
    expect(body.error.message).toBe('Your cart is empty.');

    const target = ERROR_TRANSLATION_KEYS[ERROR_CODES.CART_EMPTY];
    expect(target.moduleId).toBe('carts');
    expect(await h.adminI18n.i18nService.translate(target.moduleId, target.key, 'pl')).toBe(
      'Twój koszyk jest pusty.',
    );
  });

  /**
   * The five cases above are every reason a backend code path can produce
   * today: `cart-coupon-service.ts` answers `invalid_code`, `expired`,
   * `below_min_spend`, `wrong_organization` and `wrong_customer_group`, and
   * nothing anywhere in `backend/src` produces `wrong_channel` or
   * `coupon_format_invalid` — the storefront raises the second one itself
   * before it calls the API. So those two are covered where they can be: at the
   * key the envelope builds, which is the seam the defect lived in.
   */
  describe('every reason resolves at the key the envelope builds', () => {
    const target = ERROR_TRANSLATION_KEYS[ERROR_CODES.CART_COUPON_REJECTED];
    const reasons = Object.keys(EN) as CouponDropReason[];

    it.each(reasons)('%s — en and pl', async (reason) => {
      // Exactly the key `error-envelope.ts` composes from `details.code`.
      const key = `${target.key}.${reason}`;
      const en = await h.adminI18n.i18nService.translate(target.moduleId, key, 'en');
      const pl = await h.adminI18n.i18nService.translate(target.moduleId, key, 'pl');
      expect(en).toBe(EN[reason]);
      expect(pl).toBe(PL[reason]);
      // `hasUnfilledPlaceholder` discards the whole translation when a
      // `{placeholder}` survives interpolation, and `details` carries no value
      // any of these could name.
      expect(en).not.toMatch(/\{\w+\}/);
      expect(pl).not.toMatch(/\{\w+\}/);
    });
  });
});
