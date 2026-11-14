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
import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { promotionServiceFor } from '../../helpers/promotion-service.js';

/**
 * Issue #628 (#86) — seven refusals of `promotions` were `VALIDATION_FAILED`
 * with a machine token glued to the front of an English message
 * (`coupon_code_taken: SUMMER`, `rule_in_use: referenced by 2 promotion(s)`).
 * The envelope never replaces the message of `VALIDATION_FAILED`, so the reader
 * saw the token, and a client could not tell any of them from a malformed
 * request. One of them was a buyer's: a promotion whose usage limit was reached
 * between the cart and placement answered `promotion_unavailable: usage limit
 * reached for <uuid>`. Each now has its own code, a sentence in English and
 * Polish, and the values that sentence names in `details`.
 *
 * The sentences are written out here rather than read from the bundle: a test
 * that loads the file it checks asserts only that JSON parses. The operator is
 * answered in their stored language (D-132), so each admin case sets it; the
 * buyer is answered through `Accept-Language`.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

type Language = 'en' | 'pl';

const COUPON_CODE_TAKEN: Record<Language, (code: string) => string> = {
  en: (code) => `The coupon code ${code} is already in use. Choose a different code.`,
  pl: (code) => `Kod kuponu ${code} jest już używany. Wybierz inny kod.`,
};
const COUPON_SPACE_EXHAUSTED: Record<Language, (generated: number, requested: number) => string> = {
  en: (generated, requested) =>
    `Only ${generated} of ${requested} unique codes fit this length and format. Make the codes longer or widen the format.`,
  pl: (generated, requested) =>
    `W tej długości i formacie mieści się tylko ${generated} z ${requested} unikalnych kodów. Wydłuż kody albo poszerz format.`,
};
const RULE_NAME_TAKEN: Record<Language, (name: string) => string> = {
  en: (name) => `A rule named ${name} already exists. Choose a different name.`,
  pl: (name) => `Reguła o nazwie ${name} już istnieje. Wybierz inną nazwę.`,
};
const RULE_IN_USE: Record<Language, (count: number) => string> = {
  en: (count) => `Promotions that use this rule: ${count}. Remove the rule from them before you delete it.`,
  pl: (count) => `Promocje, które korzystają z tej reguły: ${count}. Odłącz od nich regułę, zanim ją usuniesz.`,
};
const ATTRIBUTE_NOT_ELIGIBLE: Record<Language, (key: string) => string> = {
  en: (key) =>
    `The attribute ${key} is not usable in promotion rules. Turn that on for the attribute in the catalogue, or choose another attribute.`,
  pl: (key) =>
    `Atrybutu ${key} nie można używać w regułach promocyjnych. Włącz to dla atrybutu w katalogu albo wybierz inny atrybut.`,
};
const USAGE_LIMIT_WITH_COUPON: Record<Language, (code: string) => string> = {
  en: (code) =>
    `The promotion of coupon ${code} has reached its usage limit, so the order was not placed. Remove the coupon or go back to your cart to see the current price.`,
  pl: (code) =>
    `Promocja kuponu ${code} osiągnęła limit użyć, więc zamówienie nie zostało złożone. Usuń kupon albo wróć do koszyka, aby zobaczyć aktualną cenę.`,
};

const RULE = { kind: 'condition', field: { kind: 'builtin', key: 'cartTotal' }, op: 'gte', values: [1000] };

describe('promotions refusals carry their own code and sentence (issue #628)', () => {
  let h: BackendServerHandle;
  let languageBefore: string | null = null;
  const admin = { b2b_session: 'stub-admin-session' };
  const customer = { b2b_session: 'stub-customer-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
    languageBefore =
      (await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;
  }, 60_000);

  beforeEach(async () => {
    const connection = h.em().getConnection();
    await connection.execute('truncate table promotions cascade');
    await connection.execute('truncate table promotion_rules cascade');
    await connection.execute('truncate table promotion_usage_counters cascade');
  });

  afterAll(async () => {
    if (h) {
      await setAdminLanguage(languageBefore);
      const connection = h.em().getConnection();
      await connection.execute('truncate table promotions cascade');
      await connection.execute('truncate table promotion_rules cascade');
      await connection.execute('truncate table promotion_usage_counters cascade');
    }
    await teardownBackendServer(h);
  });

  async function setAdminLanguage(value: string | null): Promise<void> {
    const em = h.em().fork();
    const user = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    user.preferredLanguage = value;
    await em.flush();
  }

  const adminCall = (method: 'POST' | 'PUT' | 'DELETE' | 'PATCH', url: string, payload?: Record<string, unknown>) =>
    h.app.inject({ method, url, cookies: admin, ...(payload ? { payload } : {}) });

  function refusal(response: { statusCode: number; body: string }, status: number, code: string): ErrorBody['error'] {
    expect(response.statusCode, response.body).toBe(status);
    const error = (JSON.parse(response.body) as ErrorBody).error;
    expect(error.code).toBe(code);
    return error;
  }

  async function createPromotion(payload: Record<string, unknown> = {}): Promise<string> {
    const response = await adminCall('POST', '/api/v1/admin/promotions', {
      name: 'Coupon 10%',
      action: { type: 'percentage_off_cart', percent: 10 },
      rule: { kind: 'all' },
      ...payload,
    });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { data: { id: string } }).data.id;
  }

  async function createRule(name: string): Promise<string> {
    const response = await adminCall('POST', '/api/v1/admin/promotion-rules', { name, definition: RULE });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { data: { id: string } }).data.id;
  }

  function expectTranslated(error: ErrorBody['error'], language: Language, sentence: Record<Language, string>): void {
    expect(error.message).toBe(sentence[language]);
    if (language === 'pl') expect(error.message).not.toBe(sentence.en);
  }

  describe.each(['en', 'pl'] as const)('for an operator working in %s', (language) => {
    beforeEach(async () => {
      await setAdminLanguage(language);
    });

    it('PROMOTION_COUPON_CODE_TAKEN when a coupon code is taken', async () => {
      const promotionId = await createPromotion();
      const path = `/api/v1/admin/promotions/${promotionId}/coupons`;
      expect((await adminCall('POST', path, { code: 'I628TAKEN' })).statusCode).toBe(201);

      const error = refusal(await adminCall('POST', path, { code: 'I628TAKEN' }), 409, 'PROMOTION_COUPON_CODE_TAKEN');

      expect(error.details).toEqual({ couponCode: 'I628TAKEN' });
      expectTranslated(error, language, { en: COUPON_CODE_TAKEN.en('I628TAKEN'), pl: COUPON_CODE_TAKEN.pl('I628TAKEN') });
    });

    it('PROMOTION_COUPON_SPACE_EXHAUSTED when the format holds fewer codes than asked for', async () => {
      const promotionId = await createPromotion();
      // Three digits hold 1,000 codes.
      const error = refusal(
        await adminCall('POST', `/api/v1/admin/promotions/${promotionId}/coupon-batches`, {
          count: 2000,
          length: 3,
          format: 'digits',
        }),
        400,
        'PROMOTION_COUPON_SPACE_EXHAUSTED',
      );

      expect(error.details).toEqual({ requested: 2000, generated: expect.any(Number) });
      const generated = error.details?.['generated'] as number;
      expect(generated).toBeLessThan(2000);
      expectTranslated(error, language, {
        en: COUPON_SPACE_EXHAUSTED.en(generated, 2000),
        pl: COUPON_SPACE_EXHAUSTED.pl(generated, 2000),
      });
    });

    it('PROMOTION_RULE_NAME_TAKEN when a rule is created or renamed onto a taken name', async () => {
      await createRule('VIP');
      const otherId = await createRule('Wholesale');
      const sentence = { en: RULE_NAME_TAKEN.en('VIP'), pl: RULE_NAME_TAKEN.pl('VIP') };

      const created = refusal(
        await adminCall('POST', '/api/v1/admin/promotion-rules', { name: 'VIP', definition: RULE }),
        409,
        'PROMOTION_RULE_NAME_TAKEN',
      );
      expect(created.details).toEqual({ name: 'VIP' });
      expectTranslated(created, language, sentence);

      const renamed = refusal(
        await adminCall('PUT', `/api/v1/admin/promotion-rules/${otherId}`, { name: 'VIP', definition: RULE }),
        409,
        'PROMOTION_RULE_NAME_TAKEN',
      );
      expect(renamed.details).toEqual({ name: 'VIP' });
      expectTranslated(renamed, language, sentence);
    });

    it('PROMOTION_RULE_IN_USE when a rule promotions use is deleted', async () => {
      const ruleId = await createRule('In use');
      await createPromotion({ name: 'First', rule: undefined, ruleId });
      await createPromotion({ name: 'Second', rule: undefined, ruleId });

      const error = refusal(
        await adminCall('DELETE', `/api/v1/admin/promotion-rules/${ruleId}`),
        409,
        'PROMOTION_RULE_IN_USE',
      );

      expect(error.details).toEqual({ ruleId, promotionCount: 2 });
      expectTranslated(error, language, { en: RULE_IN_USE.en(2), pl: RULE_IN_USE.pl(2) });
    });

    it('PROMOTION_ATTRIBUTE_NOT_ELIGIBLE when a criterion names an attribute not usable in rules', async () => {
      const off = await adminCall('PATCH', '/api/v1/admin/catalog/attributes/material', { isPromoRule: false });
      expect(off.statusCode, off.body).toBe(200);

      const error = refusal(
        await adminCall('POST', '/api/v1/admin/promotions', {
          name: 'Should not save',
          kind: 'percentage_off',
          value: 10,
          criteria: [{ type: 'attribute', attributeKey: 'material', op: 'in', values: ['steel'] }],
        }),
        400,
        'PROMOTION_ATTRIBUTE_NOT_ELIGIBLE',
      );

      expect(error.details).toEqual({ attributeKey: 'material' });
      expectTranslated(error, language, {
        en: ATTRIBUTE_NOT_ELIGIBLE.en('material'),
        pl: ATTRIBUTE_NOT_ELIGIBLE.pl('material'),
      });
    });
  });

  /**
   * The buyer's case, through placement. The cart's soft check reads the
   * promotion's own counter, the placement gate the coupon's (`buildGuards`,
   * a `per_coupon` coupon scopes the global limit), so a coupon whose use is
   * already counted is applied to the cart and refused when the order is
   * placed — the state "reached between the cart and placement" is in.
   */
  it.each(['en', 'pl'] as const)(
    'PROMOTION_USAGE_LIMIT_REACHED when the last use went between the cart and placement (%s)',
    async (language) => {
      await seedCartForStubCustomer(h.em());
      const promotion = await promotionServiceFor(h).upsert({
        name: 'Last use',
        action: { type: 'percentage_off_cart', percent: 10 },
        rule: { kind: 'all' },
        usageLimitGlobal: 1,
      });
      const code = `I628LAST${language.toUpperCase()}`;
      const coupon = await adminCall('POST', `/api/v1/admin/promotions/${promotion.id}/coupons`, { code });
      expect(coupon.statusCode, coupon.body).toBe(201);
      const couponId = (coupon.json() as { data: { id: string } }).data.id;
      const applied = await h.app.inject({ method: 'POST', url: '/api/v1/cart/coupon', cookies: customer, payload: { code } });
      expect(applied.statusCode, applied.body).toBe(200);
      await h
        .em()
        .getConnection()
        .execute(
          `insert into "promotion_usage_counters" ("id", "scope_type", "scope_key", "count") values (?, 'coupon', ?, 1)`,
          [randomUUID(), couponId],
        );

      const error = refusal(
        await h.app.inject({
          method: 'POST',
          url: '/api/v1/orders',
          cookies: customer,
          headers: { 'accept-language': language },
          payload: {
            deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
            billingAddressId: '00000000-0000-4000-8000-0000000000d2',
            deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
            paymentMethodId: SEED_PAYMENT_METHOD_ID,
          },
        }),
        409,
        'PROMOTION_USAGE_LIMIT_REACHED',
      );

      expect(error.details).toEqual({ code: 'with_coupon', promotionId: promotion.id, couponCode: code });
      expectTranslated(error, language, {
        en: USAGE_LIMIT_WITH_COUPON.en(code),
        pl: USAGE_LIMIT_WITH_COUPON.pl(code),
      });
      // The buyer is never shown the promotion's id.
      expect(error.message).not.toContain(promotion.id);
    },
  );

  it('routes the six codes to promotions, the module that raises them', () => {
    for (const code of [
      'PROMOTION_USAGE_LIMIT_REACHED',
      'PROMOTION_COUPON_CODE_TAKEN',
      'PROMOTION_COUPON_SPACE_EXHAUSTED',
      'PROMOTION_RULE_NAME_TAKEN',
      'PROMOTION_RULE_IN_USE',
      'PROMOTION_ATTRIBUTE_NOT_ELIGIBLE',
    ]) {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]?.moduleId, code).toBe('promotions');
    }
  });
});
