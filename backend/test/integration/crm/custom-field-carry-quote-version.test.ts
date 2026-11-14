import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  CRM_ADMIN,
  createCrmOpportunity,
  restoreDefaultCrmWorkflow,
  whenCrmEventSettled,
} from '../../helpers/seed-crm.js';
import { topUpStock } from '../../helpers/seed-commerce.js';

/**
 * QA finding for `specs/162-custom-fields-value-carry/` (US3-1, FR-013): the
 * Opportunity → Quote Request carry bumps `quote_requests.version`
 * (`quote-request-custom-field-carry-receiver.ts`: `quote.version += 1`).
 *
 * `createOnBehalf` emits `rfq.created_by_admin.v1` outside any bus scope, so CRM's
 * subscriber runs **after** (concurrently with) the create request: the version
 * and `ETag` the create response returns are the pre-carry ones. An operator who
 * creates a Quote Request from an Opportunity that carries a value, and then
 * edits it with the version the create response returned, is refused
 * `409 VERSION_CONFLICT` although nobody else touched the request.
 *
 * These tests PIN that behaviour. If it is fixed (carry inside the create, or
 * no bump, or the response re-read after the carry) the first test fails by
 * design and the pin must be inverted.
 */
const CUSTOM_FIELDS_API = '/api/v1/admin/custom-fields';
const RUN = randomUUID().slice(0, 8);
const fixtureKey = (name: string) => `cfc_${RUN}_${name}`;
const option = (value: string, sortOrder = 0) => ({ value, label: {}, labelDefault: value, isDefault: false, sortOrder });

describe('crm — the version a Quote Request created from an Opportunity reports, after a carry', () => {
  let h: BackendServerHandle;
  const created: string[] = [];

  const define = async (entityType: string, key: string, extra: Record<string, unknown> = {}) => {
    const response = await h.app.inject({
      method: 'POST',
      url: `${CUSTOM_FIELDS_API}/definitions`,
      cookies: CRM_ADMIN,
      payload: {
        entityType,
        key,
        label: {},
        labelDefault: key,
        valueType: 'select',
        required: false,
        sortOrder: 0,
        config: {},
        options: [option('fair'), option('web', 1)],
        ...extra,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    created.push((response.json() as { data: { id: string } }).data.id);
  };

  const createFromOpportunity = (opportunityId: string) =>
    whenCrmEventSettled(h, 'rfq.created_by_admin.v1', () => true, async () => {
      const response = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/quote-requests',
        cookies: CRM_ADMIN,
        payload: {
          organizationId: TEST_ORGANIZATION_ID,
          customerAccountId: TEST_CUSTOMER_ID,
          items: [{ productId: SEED_PRODUCT_101_ID, quantity: 4, agreedUnitPrice: 25 }],
          origin: { type: 'crm_opportunity', id: opportunityId },
        },
      });
      expect(response.statusCode, response.body).toBe(201);
      return {
        id: (response.json() as { data: { id: string } }).data.id,
        version: (response.json() as { data: { version: number } }).data.version,
        etag: String(response.headers['etag']),
      };
    });

  const storedVersion = async (id: string): Promise<number> => {
    const rows = (await h
      .em()
      .getConnection()
      .execute(`select version from "quote_requests" where id = ?`, [id])) as Array<{ version: number }>;
    return Number(rows[0]!.version);
  };

  const edit = (id: string, ifMatch: string) =>
    h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${id}`,
      cookies: CRM_ADMIN,
      headers: { 'if-match': ifMatch },
      payload: { headerNote: `note ${RUN}` },
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    await topUpStock(h.em(), [SEED_PRODUCT_101_ID], 10_000);
  });

  afterAll(async () => {
    for (const id of [...created].reverse()) {
      await h.app.inject({ method: 'DELETE', url: `${CUSTOM_FIELDS_API}/definitions/${id}`, cookies: CRM_ADMIN });
    }
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('PIN: a carry runs after the create response, so the returned version is stale and the first edit is refused 409', async () => {
    const key = fixtureKey('versioned');
    await define('quote_request', key);
    await define('opportunity', key, { carryTo: ['quote_request'] });
    const opportunity = await createCrmOpportunity(h, { customFieldValues: { [key]: 'fair' } });

    const rfq = await createFromOpportunity(opportunity.id);
    const stored = await storedVersion(rfq.id);

    expect(stored, 'carry must have bumped the stored version').toBeGreaterThan(rfq.version);
    expect(rfq.etag).toBe(`"${rfq.version}"`);

    const stale = await edit(rfq.id, rfq.etag);
    expect(stale.statusCode, stale.body).toBe(409);
    expect((stale.json() as { error?: { code?: string }; code?: string }).error?.code ?? (stale.json() as { code?: string }).code).toBe(
      'VERSION_CONFLICT',
    );

    const fresh = await edit(rfq.id, `"${stored}"`);
    expect(fresh.statusCode, fresh.body).toBe(200);
  });

  it('control: an Opportunity that carries nothing leaves the version alone, and the returned version edits', async () => {
    const key = fixtureKey('nothing');
    await define('quote_request', key);
    await define('opportunity', key, { carryTo: ['quote_request'] });
    const opportunity = await createCrmOpportunity(h, {});

    const rfq = await createFromOpportunity(opportunity.id);
    expect(await storedVersion(rfq.id)).toBe(rfq.version);
    const response = await edit(rfq.id, rfq.etag);
    expect(response.statusCode, response.body).toBe(200);
  });
});
