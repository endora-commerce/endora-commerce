import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Product } from '../../helpers/package-entities.js';
import {
  buyerChannelIds,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';

/**
 * Feature 155 QA (FR-023, SC-004) — the Polish sentence of the minimum refusal on
 * a buyer's quote-request create, whose own test asserts English only. The sentence is the catalogue bundle's
 * `errors.PRODUCT_BELOW_MINIMUM_QUANTITY` in Polish, with the minimum interpolated
 * and the product named; the code and the details stay the machine contract.
 */

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const PL_SENTENCE = /^Minimalna ilość zamówienia produktu „.+” to 10 szt\.$/u;

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

describe('155 QA — the minimum refusal is worded in Polish on quote-request create [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let A: MinimumProductFixture;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channels = await buyerChannelIds(em);
    A = await createMinimumProduct(em, {
      sku: `QAPL-A-${RUN}`,
      nameEn: `Anchor ${RUN}`,
      namePl: `Kotwa ${RUN}`,
      minOrderQuantity: 10,
      channelIds: channels,
    });
    await em.nativeUpdate(Product, { id: A.id }, { manageStock: false });
  }, 180_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('a buyer quote-request create of A × 5 with Accept-Language: pl answers the Polish sentence', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: CUSTOMER,
      headers: { 'accept-language': 'pl' },
      payload: { items: [{ productId: A.id, quantity: 5 }] },
    });
    expect(res.statusCode, res.body).toBe(422);
    const { error } = res.json() as ErrorBody;
    expect(error.code).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
    expect(error.message).toMatch(PL_SENTENCE);
    expect(error.details).toMatchObject({ productId: A.id, minimum: 10 });
  });

  it('the same request in English answers the English sentence', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: CUSTOMER,
      headers: { 'accept-language': 'en' },
      payload: { items: [{ productId: A.id, quantity: 5 }] },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as ErrorBody).error.message).toMatch(/has a minimum order quantity of 10 pcs\.$/);
  });

  // D3/D4 — the sentence is written in the request language (`request.responseLanguage()`).
  // Feature 170 (FR-030) — the product is named by its effective text at the request's (channel,
  // language): the system-default channel offers en-US alone, so a Polish request reads the
  // Global name there.
  it('names the product at the request scope inside the Polish sentence', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: CUSTOMER,
      headers: { 'accept-language': 'pl' },
      payload: { items: [{ productId: A.id, quantity: 5 }] },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as ErrorBody).error.message).toContain(A.nameEn);
    expect((res.json() as ErrorBody).error.details).toMatchObject({ productName: A.nameEn });
  });

  it('a q-weighted header (`en;q=0.2,pl;q=0.9`) answers Polish, the name at the request scope', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: CUSTOMER,
      headers: { 'accept-language': 'en;q=0.2,pl;q=0.9' },
      payload: { items: [{ productId: A.id, quantity: 5 }] },
    });
    expect(res.statusCode, res.body).toBe(422);
    const { error } = res.json() as ErrorBody;
    expect(error.message).toMatch(PL_SENTENCE);
    expect(error.message).toContain(A.nameEn);
  });
});
