import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  quoteRequestHistorySchema,
  quoteRequestSchema,
  quoteRequestSummarySchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';

const CUSTOMER = { cookies: { b2b_session: 'stub-customer-session' } };
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

/**
 * The quote-request read routes answer what `@endora-commerce/contracts`
 * publishes, and nothing beside it (Constitution II, issue #128).
 *
 * The buyer's create and detail replies are already parsed strictly by
 * `customer-routes.test.ts`, and the admin edit reply by `line-groups.test.ts`.
 * What was parsed by nothing is the two **lists** and the **admin detail** —
 * the replies the admin screens and the storefront account page read first —
 * so each is parsed here with a strict copy of its published schema: a
 * declared field answered with a type the schema refuses, a required field not
 * answered, and a key no schema declares all red this file.
 */
describe('quote-request responses parse with the published schemas', () => {
  let h: BackendServerHandle;
  let rfqId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      ...CUSTOMER,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5 }] },
    });
    expect(res.statusCode, res.body).toBe(201);
    rfqId = (res.json() as { data: { id: string } }).data.id;
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function data(url: string, actor: typeof CUSTOMER): Promise<unknown> {
    const res = await h.app.inject({ method: 'GET', url, ...actor });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: unknown }).data;
  }

  it('GET /api/v1/quote-requests — every row of the buyer list', async () => {
    const rows = (await data('/api/v1/quote-requests', CUSTOMER)) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toContain(rfqId);
    const strictRow = deepStrict(quoteRequestSummarySchema);
    expect(rows.flatMap((row) => disagreements(strictRow, row))).toEqual([]);
  });

  it('GET /api/v1/admin/quote-requests — every row of the admin list', async () => {
    const rows = (await data('/api/v1/admin/quote-requests', ADMIN)) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toContain(rfqId);
    const strictRow = deepStrict(quoteRequestSummarySchema);
    expect(rows.flatMap((row) => disagreements(strictRow, row))).toEqual([]);
  });

  it('GET /api/v1/admin/quote-requests/:id — the admin detail', async () => {
    const detail = await data(`/api/v1/admin/quote-requests/${rfqId}`, ADMIN);
    expect(disagreements(deepStrict(quoteRequestSchema), detail)).toEqual([]);
  });

  it('GET /api/v1/admin/quote-requests/:id/history — the readable history', async () => {
    const history = await data(`/api/v1/admin/quote-requests/${rfqId}/history`, ADMIN);
    expect(disagreements(deepStrict(quoteRequestHistorySchema), history)).toEqual([]);
  });
});
