import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { TEST_ADMIN_ID, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  assignToCrmBook,
  CRM_ADMIN,
  createCrmOpportunity,
  restoreDefaultCrmWorkflow,
  seedCrmOrganization,
  seedCrmSalesRep,
  whenCrmEventSettled,
} from '../../helpers/seed-crm.js';

/**
 * Sales Opportunity → Quote Request / Order custom-field carry
 * (`specs/162-custom-fields-value-carry/` US3; FR-007 – FR-010a, FR-012 – FR-015;
 * research R-10).
 *
 * A document an administrator creates **from** an Opportunity is linked to it
 * by CRM's subscriber; only when that link is made does CRM push the
 * Opportunity's values to the document's owner, which carries them into empty
 * fields in a Command of its own. The rule that decides the link decides the
 * carry. The document's creation is the administrator's; the carry is the
 * system's (owner ruling 2026-10-19).
 */
const CUSTOM_FIELDS_API = '/api/v1/admin/custom-fields';
const ORIGIN_TYPE = 'crm_opportunity';
const RUN = randomUUID().slice(0, 8);
const fixtureKey = (name: string) => `cfc_${RUN}_${name}`;

const option = (value: string, sortOrder = 0) => ({ value, label: {}, labelDefault: value, isDefault: false, sortOrder });

interface AuditRow {
  actorAdminUserId?: string | null;
  stateAfter?: Record<string, unknown> | null;
}

describe('crm — custom-field values carried from a Sales Opportunity into the documents created from it', () => {
  let h: BackendServerHandle;
  let orderChannelId: string;
  let foreignOrganizationId: string;
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
    const id = (response.json() as { data: { id: string } }).data.id;
    created.push(id);
    return id;
  };

  /** Quote Request and Order fields, and the same-key Opportunity field carrying to both. */
  const fields = async (name: string) => {
    const key = fixtureKey(name);
    const quoteRequestDefinitionId = await define('quote_request', key);
    await define('order', key);
    await define('opportunity', key, { carryTo: ['quote_request', 'order'] });
    return { key, quoteRequestDefinitionId };
  };

  const createQuoteRequest = (origin?: unknown) =>
    whenCrmEventSettled(h, 'rfq.created_by_admin.v1', () => true, async () => {
      const response = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/quote-requests',
        cookies: CRM_ADMIN,
        payload: {
          organizationId: TEST_ORGANIZATION_ID,
          customerAccountId: TEST_CUSTOMER_ID,
          items: [{ productId: SEED_PRODUCT_101_ID, quantity: 4, agreedUnitPrice: 25 }],
          ...(origin === undefined ? {} : { origin }),
        },
      });
      expect(response.statusCode, response.body).toBe(201);
      return (response.json() as { data: { id: string } }).data;
    });

  const announceQuoteRequest = (rfqId: string, origin: unknown, adminUserId: string = TEST_ADMIN_ID) =>
    whenCrmEventSettled(h, 'rfq.created_by_admin.v1', (payload) => payload['rfqId'] === rfqId, async () => {
      h.eventBus.emit('rfq.created_by_admin.v1' as never, {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        rfqId,
        organizationId: TEST_ORGANIZATION_ID,
        adminUserId,
        origin,
      } as never);
    });

  const createOrder = (origin?: unknown) =>
    whenCrmEventSettled(h, 'order.created.v1', () => true, async () => {
      const response = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/orders',
        cookies: CRM_ADMIN,
        payload: {
          customerAccountId: TEST_CUSTOMER_ID,
          salesChannelId: orderChannelId,
          items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
          deliveryMethodId: SEED_DELIVERY_METHOD_ID,
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
          deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
          billingAddressId: SEED_ADDRESS_BILLING_ID,
          ...(origin === undefined ? {} : { origin }),
        },
      });
      expect(response.statusCode, response.body).toBe(201);
      return (response.json() as { data: { id: string } }).data;
    });

  const values = async (table: 'orders' | 'quote_requests', id: string): Promise<Record<string, unknown>> => {
    const rows = (await h
      .em()
      .getConnection()
      .execute(`select custom_field_values from "${table}" where id = ?`, [id])) as Array<{
      custom_field_values: Record<string, unknown> | null;
    }>;
    expect(rows).toHaveLength(1);
    return rows[0]!.custom_field_values ?? {};
  };

  const audit = async (action: string, objectId: string): Promise<AuditRow[]> =>
    (await h.auditLogService.query({ action, objectId })) as unknown as AuditRow[];

  const isLinked = async (documentId: string): Promise<boolean> =>
    ((await h
      .em()
      .getConnection()
      .execute(`select 1 from "crm_opportunity_links" where document_id = ?`, [documentId])) as unknown[]).length > 0;

  beforeAll(async () => {
    h = await setupBackendServer();
    orderChannelId = await systemDefaultSalesChannelId(h.em());
    await restoreDefaultCrmWorkflow(h.em());
    await h.em().execute(`update "stock_levels" set "on_hand" = 10000`);
    foreignOrganizationId = await seedCrmOrganization(h.em(), `cfc-foreign-${RUN}`);
  });

  afterAll(async () => {
    for (const id of [...created].reverse()) {
      await h.app.inject({ method: 'DELETE', url: `${CUSTOM_FIELDS_API}/definitions/${id}`, cookies: CRM_ADMIN });
    }
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('a Quote Request created from an Opportunity holds its value; created by the administrator, carried by the system (US3-1, US3-4)', async () => {
    const { key } = await fields('quote');
    const opportunity = await createCrmOpportunity(h, { customFieldValues: { [key]: 'fair' } });
    const rfq = await createQuoteRequest({ type: ORIGIN_TYPE, id: opportunity.id });
    expect((await values('quote_requests', rfq.id))[key]).toBe('fair');

    const creation = await audit('quote_request.create_on_behalf', rfq.id);
    expect(creation[0]?.actorAdminUserId).toBe(TEST_ADMIN_ID);
    const carry = await audit('quote_request.custom_fields.carry', rfq.id);
    expect(carry).toHaveLength(1);
    expect(carry[0]!.actorAdminUserId ?? null).toBeNull();
  });

  it('an Order created from an Opportunity holds its value; created by the administrator, carried by the system', async () => {
    const { key } = await fields('order');
    const opportunity = await createCrmOpportunity(h, { customFieldValues: { [key]: 'web' } });
    const order = await createOrder({ type: ORIGIN_TYPE, id: opportunity.id });
    expect((await values('orders', order.id))[key]).toBe('web');

    const creation = await audit('order.place_on_behalf', order.id);
    expect(creation[0]?.actorAdminUserId).toBe(TEST_ADMIN_ID);
    const carry = await audit('order.custom_fields.carry', order.id);
    expect(carry).toHaveLength(1);
    expect(carry[0]!.actorAdminUserId ?? null).toBeNull();
  });

  it('an administrator who cannot reach the Opportunity’s Organization: created, not linked, nothing carried (US3-2)', async () => {
    const { key } = await fields('out_of_reach');
    const outsider = await seedCrmSalesRep(h.em(), [foreignOrganizationId], ['rfqs:handle', 'crm:read', 'crm:write']);
    // #305 — the test Organization is another representative's: one nobody is
    // assigned to is in every representative's reach, so without this the case
    // passes only after an earlier file in the same database left an assignment
    // on it (issue #1019).
    const undoBook = await assignToCrmBook(h.em(), [TEST_ORGANIZATION_ID]);
    try {
      const opportunity = await createCrmOpportunity(h, { customFieldValues: { [key]: 'fair' } });
      const rfq = await createQuoteRequest();
      await announceQuoteRequest(rfq.id, { type: ORIGIN_TYPE, id: opportunity.id }, outsider.adminUserId);
      expect(await isLinked(rfq.id)).toBe(false);
      expect(Object.hasOwn(await values('quote_requests', rfq.id), key)).toBe(false);
    } finally {
      await undoBook();
      outsider.undo();
    }
  });

  it('an Opportunity of another Organization: created, not linked, nothing carried (FR-012)', async () => {
    const { key } = await fields('foreign');
    const opportunity = await createCrmOpportunity(h, {
      organizationId: foreignOrganizationId,
      customFieldValues: { [key]: 'fair' },
    });
    const rfq = await createQuoteRequest({ type: ORIGIN_TYPE, id: opportunity.id });
    expect(await isLinked(rfq.id)).toBe(false);
    expect(Object.hasOwn(await values('quote_requests', rfq.id), key)).toBe(false);
  });

  it('the same event delivered twice carries once — only on the link just made', async () => {
    const { key } = await fields('twice');
    const opportunity = await createCrmOpportunity(h, { customFieldValues: { [key]: 'fair' } });
    const origin = { type: ORIGIN_TYPE, id: opportunity.id };
    const rfq = await createQuoteRequest(origin);
    await announceQuoteRequest(rfq.id, origin);
    expect(await audit('quote_request.custom_fields.carry', rfq.id)).toHaveLength(1);
  });

  it('records a value the Quote Request cannot take on the Quote Request’s own history', async () => {
    const { key, quoteRequestDefinitionId } = await fields('drifted');
    const drift = await h.app.inject({
      method: 'PATCH',
      url: `${CUSTOM_FIELDS_API}/definitions/${quoteRequestDefinitionId}`,
      cookies: CRM_ADMIN,
      payload: { audience: 'customer' },
    });
    expect(drift.statusCode, drift.body).toBe(200);
    const opportunity = await createCrmOpportunity(h, { customFieldValues: { [key]: 'fair' } });
    const rfq = await createQuoteRequest({ type: ORIGIN_TYPE, id: opportunity.id });
    expect(Object.hasOwn(await values('quote_requests', rfq.id), key)).toBe(false);

    const history = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/quote-requests/${rfq.id}/history`,
      cookies: CRM_ADMIN,
    });
    expect(history.statusCode, history.body).toBe(200);
    const entries = (history.json() as { data: { entries: Array<{ kind: string; customFieldCarry?: unknown }> } }).data
      .entries;
    expect(entries.filter((entry) => entry.kind === 'custom_field_carry_skipped')).toEqual([
      expect.objectContaining({
        customFieldCarry: {
          source: { entityType: 'opportunity', recordId: opportunity.id, reference: opportunity.number },
          skipped: [{ key, reason: 'audience_mismatch', label: { labelDefault: key, labels: {} } }],
        },
      }),
    ]);
  });
});
