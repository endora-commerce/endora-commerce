import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CustomFieldCarryReceiverPort } from '@endora-commerce/contracts';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import {
  acceptedQuoteRequest,
  checkOutBasket,
  convertQuoteRequestToCart,
  whenOrderCreatedSettled,
} from '../../helpers/quote-conversion.js';
import { submitCrmQuoteRequest } from '../../helpers/seed-crm.js';
import { topUpStock } from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * Carry-over never widens who reads a value (`specs/162-custom-fields-value-carry/`
 * T038; SC-005, FR-011).
 *
 * For each target type a non-administrator reads — the Order (the buyer's order
 * detail and the API-key order read) and the Quote Request (the buyer's request
 * detail):
 *
 * - (a) a `customer` → `customer` carry whose **source** is then made
 *   `internal` skips the value `audience_mismatch`, and no buyer or API-key
 *   reply holds it;
 * - (b) an `internal` → `internal` carry whose **target** is then made
 *   `customer` skips it likewise;
 * - (c) a `customer` → `internal` carry carries it, and only admin replies hold
 *   it.
 *
 * The Sales Opportunity has no non-administrator reader; its case is
 * `crm/custom-field-carry-into-opportunity.test.ts`' (T013).
 */
const ADMIN = { b2b_session: 'stub-admin-session' };
const CUSTOMER = { b2b_session: 'stub-customer-session' };
const API = '/api/v1/admin/custom-fields';
const RUN = randomUUID().slice(0, 8);
const fixtureKey = (name: string) => `cfc_${RUN}_${name}`;

type Audience = 'customer' | 'internal';

interface Case {
  name: string;
  source: Audience;
  target: Audience;
  /** The definition whose audience is changed once the carry is on — drift (FR-019). */
  drift?: { side: 'source' | 'target'; to: Audience };
  carried: boolean;
}

const CASES: readonly Case[] = [
  { name: 'a_source_internal', source: 'customer', target: 'customer', drift: { side: 'source', to: 'internal' }, carried: false },
  { name: 'b_target_customer', source: 'internal', target: 'internal', drift: { side: 'target', to: 'customer' }, carried: false },
  { name: 'c_customer_internal', source: 'customer', target: 'internal', carried: true },
];

describe('custom_fields — a carried value is read by nobody its target hides it from (SC-005)', () => {
  let h: BackendServerHandle;
  let apiKeyToken = '';
  const created: string[] = [];

  const define = async (entityType: string, key: string, audience: Audience, carryTo: string[] = []) => {
    const response = await h.app.inject({
      method: 'POST',
      url: `${API}/definitions`,
      cookies: ADMIN,
      payload: {
        entityType,
        key,
        label: {},
        labelDefault: key,
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

  const setAudience = async (definitionId: string, audience: Audience) => {
    const response = await h.app.inject({
      method: 'PATCH',
      url: `${API}/definitions/${definitionId}`,
      cookies: ADMIN,
      payload: { audience },
    });
    expect(response.statusCode, response.body).toBe(200);
  };

  /** The source and target definitions of `c`, with the drift applied once the carry is on. */
  const configure = async (c: Case, sourceType: string, targetType: string) => {
    const key = fixtureKey(`${targetType}_${c.name}`);
    const targetId = await define(targetType, key, c.target);
    const sourceId = await define(sourceType, key, c.source, [targetType]);
    if (c.drift) await setAudience(c.drift.side === 'source' ? sourceId : targetId, c.drift.to);
    return { key, value: `value_${RUN}_${targetType}_${c.name}` };
  };

  const storedValues = async (table: 'orders' | 'quote_requests', id: string): Promise<Record<string, unknown>> => {
    const rows = (await h
      .em()
      .getConnection()
      .execute(`select custom_field_values from "${table}" where id = ?`, [id])) as Array<{
      custom_field_values: Record<string, unknown> | null;
    }>;
    expect(rows).toHaveLength(1);
    return rows[0]!.custom_field_values ?? {};
  };

  const read = async (
    url: string,
    auth: { cookies: Record<string, string> } | { headers: Record<string, string> },
  ): Promise<string> => {
    const response = await h.app.inject({ method: 'GET', url, ...auth });
    expect(response.statusCode, response.body).toBe(200);
    return response.body;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await topUpStock(h.em(), [SEED_PRODUCT_101_ID]);
    const minted = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      cookies: ADMIN,
      payload: {
        name: `cfc ${RUN} audience`,
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

  describe('Quote Request → Order, at placement', () => {
    beforeEach(async () => {
      await h
        .em()
        .getConnection()
        .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
          TEST_CUSTOMER_ID,
        ]);
    });

    it.each(CASES)('$name', async (c) => {
      const { key, value } = await configure(c, 'quote_request', 'order');
      const rfq = await acceptedQuoteRequest(h, { quantity: 2, agreedUnitPrice: 11.25 });
      await h
        .em()
        .getConnection()
        .execute(`update "quote_requests" set custom_field_values = ?::jsonb where id = ?`, [
          JSON.stringify({ [key]: value }),
          rfq.id,
        ]);
      await convertQuoteRequestToCart(h, rfq.id);
      const order = await whenOrderCreatedSettled(h, () => checkOutBasket(h));

      expect((await storedValues('orders', order.id))[key]).toBe(c.carried ? value : undefined);
      const admin = await read(`/api/v1/admin/orders/${order.id}`, { cookies: ADMIN });
      if (c.carried) {
        expect(admin).toContain(value);
      } else {
        expect(admin).not.toContain(value);
        const comments = await read(`/api/v1/admin/orders/${order.id}/comments`, { cookies: ADMIN });
        const notes = (JSON.parse(comments) as { data: Array<{ systemNote: { skipped: unknown[] } | null }> }).data
          .filter((comment) => comment.systemNote !== null)
          .map((comment) => comment.systemNote!.skipped);
        expect(notes).toEqual([[expect.objectContaining({ key, reason: 'audience_mismatch' })]]);
      }

      const buyer = await read(`/api/v1/orders/${order.id}`, { cookies: CUSTOMER });
      const external = await read(`/api/v1/external/orders/${order.id}`, {
        headers: { authorization: `Bearer ${apiKeyToken}` },
      });
      for (const body of [buyer, external]) {
        expect(body).not.toContain(value);
        expect(body).not.toContain(key);
      }
    });
  });

  describe('Sales Opportunity → Quote Request, pushed to its receiver', () => {
    let port: CustomFieldCarryReceiverPort;

    beforeAll(() => {
      port = (h.container.cradle as unknown as { quoteRequestCustomFieldCarryPort: CustomFieldCarryReceiverPort })
        .quoteRequestCustomFieldCarryPort;
    });

    it.each(CASES)('$name', async (c) => {
      const { key, value } = await configure(c, 'opportunity', 'quote_request');
      const rfq = await submitCrmQuoteRequest(h);
      const receipt = await enterSystemScope('test: crm pushes an opportunity’s values', () =>
        port.receiveCarriedValues({
          recordId: rfq.id,
          organizationId: TEST_ORGANIZATION_ID,
          source: { entityType: 'opportunity', recordId: randomUUID(), reference: `OPP-${RUN}`, values: { [key]: value } },
        }),
      );
      expect(receipt.outcome).toBe('applied');
      expect(receipt.carried).toEqual(c.carried ? [key] : []);
      expect(receipt.skipped.map((skip) => ({ key: skip.key, reason: skip.reason }))).toEqual(
        c.carried ? [] : [{ key, reason: 'audience_mismatch' }],
      );

      expect((await storedValues('quote_requests', rfq.id))[key]).toBe(c.carried ? value : undefined);
      const admin = await read(`/api/v1/admin/quote-requests/${rfq.id}`, { cookies: ADMIN });
      if (c.carried) expect(admin).toContain(value);
      else expect(admin).not.toContain(value);

      const buyer = await read(`/api/v1/quote-requests/${rfq.id}`, { cookies: CUSTOMER });
      expect(buyer).not.toContain(value);
      expect(buyer).not.toContain(key);
    });
  });
});
