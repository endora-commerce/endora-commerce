import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orderCommentSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import {
  acceptedQuoteRequest,
  checkOutBasket,
  convertQuoteRequestToCart,
  whenOrderCreatedSettled,
} from '../../helpers/quote-conversion.js';
import { topUpStock } from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * The Order system note is the administrators' alone
 * (`specs/162-custom-fields-value-carry/` T039; SC-006, FR-010a).
 *
 * After a placement that could not carry a value, the note naming it is in the
 * admin comments reply — and nowhere a buyer, an API key or a mailbox reads:
 * not the buyer's comments route, not the buyer's order detail, not the
 * API-key order read, not any message sent for the placement.
 */
const ADMIN = { b2b_session: 'stub-admin-session' };
const CUSTOMER = { b2b_session: 'stub-customer-session' };
const API = '/api/v1/admin/custom-fields';
const RUN = randomUUID().slice(0, 8);
const KEY = `cfc_${RUN}_note_visibility`;
const VALUE = `value_${RUN}`;

describe('orders — the carry system note is shown to administrators only (SC-006)', () => {
  let h: BackendServerHandle;
  const mailer = new InMemoryMailer();
  const created: string[] = [];
  let orderId = '';
  let apiKeyToken = '';
  let mailed = '';

  const define = async (entityType: string, audience: 'customer' | 'internal', carryTo: string[] = []) => {
    const response = await h.app.inject({
      method: 'POST',
      url: `${API}/definitions`,
      cookies: ADMIN,
      payload: {
        entityType,
        key: KEY,
        label: {},
        labelDefault: KEY,
        valueType: 'text',
        required: false,
        sortOrder: 0,
        config: {},
        options: [],
        audience,
        carryTo,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const id = (response.json() as { data: { id: string } }).data.id;
    created.push(id);
    return id;
  };

  const get = async (
    url: string,
    auth: { cookies: Record<string, string> } | { headers: Record<string, string> },
  ) => {
    const response = await h.app.inject({ method: 'GET', url, ...auth });
    expect(response.statusCode, response.body).toBe(200);
    return response;
  };

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    await topUpStock(h.em(), [SEED_PRODUCT_101_ID]);
    await h
      .em()
      .getConnection()
      .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
        TEST_CUSTOMER_ID,
      ]);

    // An internal → internal carry whose target then became customer-visible:
    // the value is skipped `audience_mismatch` and the note names it.
    const orderDefinitionId = await define('order', 'internal');
    await define('quote_request', 'internal', ['order']);
    const drift = await h.app.inject({
      method: 'PATCH',
      url: `${API}/definitions/${orderDefinitionId}`,
      cookies: ADMIN,
      payload: { audience: 'customer' },
    });
    expect(drift.statusCode, drift.body).toBe(200);

    const rfq = await acceptedQuoteRequest(h, { quantity: 2, agreedUnitPrice: 11.25 });
    await h
      .em()
      .getConnection()
      .execute(`update "quote_requests" set custom_field_values = ?::jsonb where id = ?`, [
        JSON.stringify({ [KEY]: VALUE }),
        rfq.id,
      ]);
    await convertQuoteRequestToCart(h, rfq.id);
    const sentBefore = mailer.sent.length;
    orderId = (await whenOrderCreatedSettled(h, () => checkOutBasket(h))).id;
    mailed = mailer.sent
      .slice(sentBefore)
      .map((message) => `${message.subject ?? ''} ${message.html ?? ''} ${message.text ?? ''}`)
      .join('\n');

    const minted = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      cookies: ADMIN,
      payload: {
        name: `cfc ${RUN} note visibility`,
        scopes: ['orders:read'],
        binding: {
          organizationId: TEST_ORGANIZATION_ID,
          salesChannelId: await systemDefaultSalesChannelId(h.em()),
          customerAccountId: TEST_CUSTOMER_ID,
        },
      },
    });
    expect(minted.statusCode, minted.body).toBe(201);
    apiKeyToken = (minted.json() as { data: { bearerToken: string } }).data.bearerToken;
  });

  afterAll(async () => {
    for (const id of [...created].reverse()) {
      await h.app.inject({ method: 'DELETE', url: `${API}/definitions/${id}`, cookies: ADMIN });
    }
    await teardownBackendServer(h);
  });

  it('the admin comments reply holds the note, author-less, internal and silent', async () => {
    const response = await get(`/api/v1/admin/orders/${orderId}/comments`, { cookies: ADMIN });
    const comments = (response.json() as { data: unknown[] }).data.map((comment) => orderCommentSchema.parse(comment));
    const notes = comments.filter((comment) => comment.systemNote);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      authorAdminUserId: null,
      authorCustomerAccountId: null,
      isCustomerVisible: false,
      notifyCustomer: false,
      systemNote: {
        kind: 'custom_field_carry_skipped',
        source: { entityType: 'quote_request' },
        skipped: [{ key: KEY, reason: 'audience_mismatch' }],
      },
    });
  });

  it('the buyer’s comments route holds nothing of it', async () => {
    const response = await get(`/api/v1/orders/${orderId}/comments`, { cookies: CUSTOMER });
    expect((response.json() as { data: unknown[] }).data).toEqual([]);
    expect(response.body).not.toContain(KEY);
    expect(response.body).not.toContain('systemNote');
  });

  it('the buyer’s order detail holds nothing of it', async () => {
    const response = await get(`/api/v1/orders/${orderId}`, { cookies: CUSTOMER });
    expect(response.body).not.toContain(KEY);
    expect(response.body).not.toContain(VALUE);
    expect(response.body).not.toContain('systemNote');
  });

  it('the API-key order read holds nothing of it', async () => {
    const response = await get(`/api/v1/external/orders/${orderId}`, {
      headers: { authorization: `Bearer ${apiKeyToken}` },
    });
    expect(response.body).not.toContain(KEY);
    expect(response.body).not.toContain(VALUE);
    expect(response.body).not.toContain('systemNote');
  });

  it('no message sent for the placement holds anything of it', () => {
    expect(mailed).not.toContain(KEY);
    expect(mailed).not.toContain(VALUE);
  });
});
