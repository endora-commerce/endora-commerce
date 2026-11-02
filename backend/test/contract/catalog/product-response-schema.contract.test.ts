import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  paginationSchema,
  productDetailSchema,
  productListCapabilitiesSchema,
  productSummarySchema,
} from '@endora-commerce/contracts';
import { z } from 'zod';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

const CUSTOMER = { cookies: { b2b_session: 'stub-customer-session' } };
const ANONYMOUS = {};

/**
 * The page the storefront's listing reads: the contract publishes its parts
 * (`productSummarySchema`, `paginationSchema`, `productListCapabilitiesSchema`)
 * and `storefront/lib/api/catalog.ts` assembles them into `ListProductsResponse`
 * — this is that assembly, as a schema.
 */
const productListPageSchema = z.object({
  data: z.array(productSummarySchema),
  pagination: paginationSchema,
  capabilities: productListCapabilitiesSchema,
});

/**
 * The storefront catalogue reads answer what `@endora-commerce/contracts`
 * publishes, and nothing beside it (Constitution II, issue #128).
 *
 * The product listing and the product detail page are the two replies every
 * storefront visit starts with. Each is read anonymously and as a signed-in
 * buyer — the prices, and so the fields that carry them, differ between the
 * two — and parsed with a **strict copy** of the published schema
 * (`test/helpers/strict-schema.ts`): a declared field answered with a type the
 * schema refuses, a required field not answered and a key no schema declares
 * all red this file.
 */
describe('storefront catalogue responses parse with the published product schemas', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  for (const [who, actor] of [
    ['an anonymous visitor', ANONYMOUS],
    ['a signed-in buyer', CUSTOMER],
  ] as const) {
    it(`GET /api/v1/catalog/products — the listing page, for ${who}`, async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/products', ...actor });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as { data: unknown[] };
      expect(body.data.length).toBeGreaterThan(0);
      expect(disagreements(deepStrict(productListPageSchema), body)).toEqual([]);
    });

    it(`GET /api/v1/catalog/products/:idOrSlug — the product page, for ${who}`, async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products/${SEED_PRODUCT_101_ID}`,
        ...actor,
      });
      expect(res.statusCode, res.body).toBe(200);
      const detail = (res.json() as { data: unknown }).data;
      expect(disagreements(deepStrict(productDetailSchema), detail)).toEqual([]);
    });
  }
});
