import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpportunityHistoryResponseSchema, type OpportunityHistoryEntry } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { CRM_SETTING_CODES } from '../../../../packages/modules/crm/src/manifest.js';
import {
  assignCrmSalesRep,
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  linkCrmOrder,
  linkCrmQuoteRequest,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrder,
  setCrmSetting,
  submitCrmQuoteRequest,
  whenCrmEventSettled,
} from '../../helpers/seed-crm.js';

/**
 * Order / Quote Request → Sales Opportunity custom-field carry
 * (`specs/162-custom-fields-value-carry/` US2; FR-007 – FR-010, FR-012 – FR-015;
 * research R-9, R-11).
 *
 * Inside CRM's own `crm.opportunity.create` and `crm.opportunity.link_add`
 * Commands, run by the subscriber on the system's behalf: each value the
 * document's definition carries to Opportunities goes into an **empty**
 * Opportunity field, and what was carried or skipped is named in that same
 * audit entry — which is what the Opportunity's history shows. A manual link
 * carries nothing (owner ruling 2026-10-19).
 */
const CUSTOM_FIELDS_API = '/api/v1/admin/custom-fields';
const RUN = randomUUID().slice(0, 8);
const fixtureKey = (name: string) => `cfc_${RUN}_${name}`;
const SETTINGS = [CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, CRM_SETTING_CODES.AUTO_CREATE_FROM_QUOTE_REQUESTS];

const option = (value: string, sortOrder = 0) => ({
  value,
  label: {},
  labelDefault: value,
  isDefault: false,
  sortOrder,
});

interface CarryMember {
  source: { entityType: string; recordId: string };
  carried: string[];
  skipped: Array<{ key: string; reason: string }>;
}

describe('crm — custom-field values carried into Sales Opportunities', () => {
  let h: BackendServerHandle;
  let rep: { adminUserId: string; undo: () => void };
  const stored = new Map<string, unknown>();
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

  /** An Opportunity field and the same-key field of `sourceType` carrying to it. */
  const carryPair = async (sourceType: 'order' | 'quote_request', name: string) => {
    const key = fixtureKey(name);
    const opportunityDefinitionId = await define('opportunity', key);
    await define(sourceType, key, { carryTo: ['opportunity'] });
    return { key, opportunityDefinitionId };
  };

  const removeDefinition = async (id: string) => {
    const response = await h.app.inject({ method: 'DELETE', url: `${CUSTOM_FIELDS_API}/definitions/${id}`, cookies: CRM_ADMIN });
    expect(response.statusCode, response.body).toBe(204);
    created.splice(created.indexOf(id), 1);
  };

  const setValues = async (table: 'orders' | 'quote_requests', id: string, values: Record<string, unknown>) => {
    await h
      .em()
      .getConnection()
      .execute(`update "${table}" set custom_field_values = ?::jsonb where id = ?`, [JSON.stringify(values), id]);
  };

  const opportunityValues = async (id: string): Promise<Record<string, unknown>> => {
    const rows = (await h
      .em()
      .getConnection()
      .execute(`select custom_field_values from "crm_opportunities" where id = ?`, [id])) as Array<{
      custom_field_values: Record<string, unknown> | null;
    }>;
    return rows[0]?.custom_field_values ?? {};
  };

  const opportunityOf = async (documentId: string): Promise<string | null> => {
    const rows = (await h
      .em()
      .getConnection()
      .execute(`select opportunity_id from "crm_opportunity_links" where document_id = ?`, [documentId])) as Array<{
      opportunity_id: string;
    }>;
    return rows[0]?.opportunity_id ?? null;
  };

  const history = async (id: string): Promise<OpportunityHistoryEntry[]> => {
    const response = await h.app.inject({ method: 'GET', url: `${CRM_API}/opportunities/${id}/history`, cookies: CRM_ADMIN });
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityHistoryResponseSchema.parse(response.json()).data;
  };

  const carryOf = (entry: OpportunityHistoryEntry | undefined): CarryMember | undefined =>
    (entry?.after as { customFieldCarry?: CarryMember } | null | undefined)?.customFieldCarry;

  const linkEntryFor = (entries: OpportunityHistoryEntry[], documentId: string) =>
    entries.find(
      (entry) =>
        entry.action === 'crm.opportunity.link_add' &&
        (entry.after as { documentId?: string } | null)?.documentId === documentId,
    );

  const announceOrder = (orderId: string) =>
    whenCrmEventSettled(h, 'order.created.v1', (payload) => payload['orderId'] === orderId, async () => {
      h.eventBus.emit('order.created.v1' as never, {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        orderId,
        organizationId: TEST_ORGANIZATION_ID,
      } as never);
    });

  const announceQuoteRequest = (rfqId: string) =>
    whenCrmEventSettled(h, 'rfq.created.v1', (payload) => payload['rfqId'] === rfqId, async () => {
      h.eventBus.emit('rfq.created.v1' as never, {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        rfqId,
        organizationId: TEST_ORGANIZATION_ID,
      } as never);
    });

  /** An Order of the test Organization holding `values`, announced as placed. */
  const placedOrder = async (values: Record<string, unknown>, overrides: { sourceQuoteRequestId?: string } = {}) => {
    const order = await seedCrmOrder(h.em(), overrides);
    await setValues('orders', order.id, values);
    await announceOrder(order.id);
    return order.id;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    for (const code of SETTINGS) {
      // The value in force, read and kept to write back (standing rule 7); a
      // setting the module did not register is a broken fixture, not `false`.
      const rows = (await h
        .em()
        .getConnection()
        .execute(`select coalesce(global_value, default_value) as value from "settings" where code = ?`, [
          code,
        ])) as Array<{ value: unknown }>;
      const row = rows[0];
      if (!row) throw new Error(`The setting ${code} is not registered.`);
      stored.set(code, row.value);
    }
    await restoreDefaultCrmWorkflow(h.em());
    rep = await seedCrmAdmin(h.em(), `cfc-rep-${RUN}`, ['crm:read', 'crm:write', 'orders:read']);
    await assignCrmSalesRep(h.em(), TEST_ORGANIZATION_ID, rep.adminUserId);
    // Quote Requests are submitted with the setting off; the cases announce them.
    await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_QUOTE_REQUESTS, false);
    await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, true);
  });

  afterAll(async () => {
    for (const code of SETTINGS) await setCrmSetting(h, code, stored.get(code));
    for (const id of [...created].reverse()) {
      await h.app.inject({ method: 'DELETE', url: `${CUSTOM_FIELDS_API}/definitions/${id}`, cookies: CRM_ADMIN });
    }
    rep.undo();
    await teardownBackendServer(h);
  });

  it('an Opportunity created for an Order holds the Order’s value, shown in its creation entry (US2-1)', async () => {
    const { key } = await carryPair('order', 'from_order');
    const orderId = await placedOrder({ [key]: 'fair' });
    const opportunityId = await opportunityOf(orderId);
    expect(opportunityId).not.toBeNull();
    expect((await opportunityValues(opportunityId!))[key]).toBe('fair');

    const creation = (await history(opportunityId!)).find((entry) => entry.action === 'crm.opportunity.create');
    expect((creation?.after as { customFieldValues?: Record<string, unknown> }).customFieldValues?.[key]).toBe('fair');
    expect(creation?.actor.kind).not.toBe('admin');
    expect(carryOf(creation)).toEqual({
      source: { entityType: 'order', recordId: orderId },
      carried: [key],
      skipped: [],
    });
  });

  it('an Opportunity created for a Quote Request holds the request’s value', async () => {
    const { key } = await carryPair('quote_request', 'from_quote');
    const rfq = await submitCrmQuoteRequest(h);
    await setValues('quote_requests', rfq.id, { [key]: 'web' });
    await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_QUOTE_REQUESTS, true);
    try {
      await announceQuoteRequest(rfq.id);
    } finally {
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_QUOTE_REQUESTS, false);
    }
    const opportunityId = await opportunityOf(rfq.id);
    expect(opportunityId).not.toBeNull();
    expect((await opportunityValues(opportunityId!))[key]).toBe('web');
  });

  it('an Order joining from a linked Quote Request keeps a value the Opportunity holds (US2-2)', async () => {
    const { key } = await carryPair('order', 'join_kept');
    const holder = await createCrmOpportunity(h, { customFieldValues: { [key]: 'web' } });
    const rfq = await submitCrmQuoteRequest(h);
    expect((await linkCrmQuoteRequest(h, holder.id, rfq.id)).statusCode).toBe(201);
    const orderId = await placedOrder({ [key]: 'fair' }, { sourceQuoteRequestId: rfq.id });

    expect(await opportunityOf(orderId)).toBe(holder.id);
    expect((await opportunityValues(holder.id))[key]).toBe('web');
    const link = linkEntryFor(await history(holder.id), orderId);
    expect(link).toBeDefined();
    expect(carryOf(link)).toBeUndefined();
  });

  it('an Order joining from a linked Quote Request fills an empty field, named in the link entry (US2-3)', async () => {
    const { key } = await carryPair('order', 'join_filled');
    const holder = await createCrmOpportunity(h);
    const rfq = await submitCrmQuoteRequest(h);
    expect((await linkCrmQuoteRequest(h, holder.id, rfq.id)).statusCode).toBe(201);
    const orderId = await placedOrder({ [key]: 'fair' }, { sourceQuoteRequestId: rfq.id });

    expect((await opportunityValues(holder.id))[key]).toBe('fair');
    expect(carryOf(linkEntryFor(await history(holder.id), orderId))).toEqual({
      source: { entityType: 'order', recordId: orderId },
      carried: [key],
      skipped: [],
    });
  });

  it('creates the Opportunity and names a key whose field was deleted (US2-5)', async () => {
    const { key, opportunityDefinitionId } = await carryPair('order', 'deleted_target');
    await removeDefinition(opportunityDefinitionId);
    const orderId = await placedOrder({ [key]: 'fair' });
    const opportunityId = await opportunityOf(orderId);
    expect(opportunityId).not.toBeNull();
    expect(Object.hasOwn(await opportunityValues(opportunityId!), key)).toBe(false);
    const creation = (await history(opportunityId!)).find((entry) => entry.action === 'crm.opportunity.create');
    expect(carryOf(creation)?.skipped).toEqual([{ key, reason: 'target_missing', label: { labelDefault: key, labels: {} } }]);
  });

  it('records a skip from a Quote Request on the Opportunity, and not on the request (US2-6)', async () => {
    const { key, opportunityDefinitionId } = await carryPair('quote_request', 'drifted');
    const drift = await h.app.inject({
      method: 'PATCH',
      url: `${CUSTOM_FIELDS_API}/definitions/${opportunityDefinitionId}`,
      cookies: CRM_ADMIN,
      payload: { audience: 'customer' },
    });
    expect(drift.statusCode, drift.body).toBe(200);
    const rfq = await submitCrmQuoteRequest(h);
    await setValues('quote_requests', rfq.id, { [key]: 'fair' });
    await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_QUOTE_REQUESTS, true);
    try {
      await announceQuoteRequest(rfq.id);
    } finally {
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_QUOTE_REQUESTS, false);
    }
    const opportunityId = await opportunityOf(rfq.id);
    expect(opportunityId).not.toBeNull();
    const creation = (await history(opportunityId!)).find((entry) => entry.action === 'crm.opportunity.create');
    expect(carryOf(creation)?.skipped).toEqual([{ key, reason: 'audience_mismatch', label: { labelDefault: key, labels: {} } }]);

    const quoteHistory = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/quote-requests/${rfq.id}/history`,
      cookies: CRM_ADMIN,
    });
    expect(quoteHistory.statusCode, quoteHistory.body).toBe(200);
    expect(quoteHistory.body).not.toContain('custom_field_carry_skipped');
  });

  it('the same order.created.v1 handled twice carries once, with one entry (FR-008)', async () => {
    const { key } = await carryPair('order', 'twice');
    const orderId = await placedOrder({ [key]: 'fair' });
    await announceOrder(orderId);
    const opportunityId = await opportunityOf(orderId);
    const entries = (await history(opportunityId!)).filter((entry) => carryOf(entry) !== undefined);
    expect(entries).toHaveLength(1);
  });

  it('two Orders joining one Opportunity with different values: the first value stays', async () => {
    const { key } = await carryPair('order', 'several');
    const holder = await createCrmOpportunity(h);
    const first = await submitCrmQuoteRequest(h);
    const second = await submitCrmQuoteRequest(h);
    expect((await linkCrmQuoteRequest(h, holder.id, first.id)).statusCode).toBe(201);
    expect((await linkCrmQuoteRequest(h, holder.id, second.id)).statusCode).toBe(201);
    await placedOrder({ [key]: 'fair' }, { sourceQuoteRequestId: first.id });
    await placedOrder({ [key]: 'web' }, { sourceQuoteRequestId: second.id });
    expect((await opportunityValues(holder.id))[key]).toBe('fair');
  });

  it('a join waits for a write that holds the Opportunity and plans over what it committed — no lost update (#404)', async () => {
    // An administrator's edit holds the Opportunity's row and sets another key
    // of the bag. The join must not plan over the bag it read before that edit
    // committed: it takes the row `for update` and plans over what it re-reads.
    // Without the lock it plans over the old bag, waits only at its own write
    // and overwrites the edit. What tells the two apart is the final bag and
    // the version, not the timing.
    const { key } = await carryPair('order', 'join_locked');
    const otherKey = fixtureKey('join_locked_other');
    const opportunity = await createCrmOpportunity(h);
    const rfq = await submitCrmQuoteRequest(h);
    expect((await linkCrmQuoteRequest(h, opportunity.id, rfq.id)).statusCode).toBe(201);
    const order = await seedCrmOrder(h.em(), { sourceQuoteRequestId: rfq.id });
    await setValues('orders', order.id, { [key]: 'fair' });

    const editor = await h.em().getKnex().transaction();
    let join: Promise<unknown> | null = null;
    let editedVersion: number;
    try {
      const locked = (await editor.raw(`select version from "crm_opportunities" where id = ? for update`, [
        opportunity.id,
      ])) as { rows: Array<{ version: number }> };
      editedVersion = locked.rows[0]!.version + 1;
      await editor.raw(`update "crm_opportunities" set custom_field_values = ?::jsonb, version = ? where id = ?`, [
        JSON.stringify({ [otherKey]: 'set by the administrator' }),
        editedVersion,
        opportunity.id,
      ]);
      join = announceOrder(order.id);
      const pending = Symbol('pending');
      const early = await Promise.race([join, new Promise((resolve) => setTimeout(() => resolve(pending), 300))]);
      expect(early, 'the join finished while an edit held the Opportunity').toBe(pending);
      await editor.commit();
    } catch (error) {
      await editor.rollback().catch(() => undefined);
      throw error;
    }
    await join;

    expect(await opportunityOf(order.id)).toBe(opportunity.id);
    expect(await opportunityValues(opportunity.id)).toEqual({ [otherKey]: 'set by the administrator', [key]: 'fair' });
    // The carry is a write to the Opportunity, so a client holding the edited
    // version learns that it is stale.
    const versions = (await h
      .em()
      .getConnection()
      .execute(`select version from "crm_opportunities" where id = ?`, [opportunity.id])) as Array<{ version: number }>;
    expect(versions[0]?.version).toBe(editedVersion + 1);
  });

  it('an operator’s manual link of an Order and a Quote Request carries nothing (US3-5, FR-008)', async () => {
    const orderKey = (await carryPair('order', 'manual_order')).key;
    const quoteKey = (await carryPair('quote_request', 'manual_quote')).key;
    await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, false);
    let orderId: string;
    try {
      orderId = await placedOrder({ [orderKey]: 'fair' });
    } finally {
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, true);
    }
    const rfq = await submitCrmQuoteRequest(h);
    await setValues('quote_requests', rfq.id, { [quoteKey]: 'web' });
    const holder = await createCrmOpportunity(h);
    expect((await linkCrmOrder(h, holder.id, orderId)).statusCode).toBe(201);
    expect((await linkCrmQuoteRequest(h, holder.id, rfq.id)).statusCode).toBe(201);

    const values = await opportunityValues(holder.id);
    expect(Object.hasOwn(values, orderKey)).toBe(false);
    expect(Object.hasOwn(values, quoteKey)).toBe(false);
    const entries = await history(holder.id);
    expect(carryOf(linkEntryFor(entries, orderId))).toBeUndefined();
    expect(carryOf(linkEntryFor(entries, rfq.id))).toBeUndefined();
  });
});
