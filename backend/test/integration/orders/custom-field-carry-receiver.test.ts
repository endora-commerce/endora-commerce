import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CustomFieldCarryReceiverPort } from '@endora-commerce/contracts';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { CRM_ADMIN, CRM_CUSTOMER, seedCrmOrder, seedCrmOrganization } from '../../helpers/seed-crm.js';

/**
 * `orderCustomFieldCarryPort` — `orders` receives a Sales Opportunity's values
 * into an Order created from it (`specs/162-custom-fields-value-carry/` US3;
 * contract `carry-api.md` §4.2; research R-8, R-10).
 *
 * One Command of the owner: empty fields filled, a held value kept, a value
 * that cannot be carried named in one internal, author-less, non-notifying
 * system note, and another Organization's Order answered `not-found` exactly
 * as a missing one is.
 */
const API = '/api/v1/admin/custom-fields';
const RUN = randomUUID().slice(0, 8);
const fixtureKey = (name: string) => `cfc_${RUN}_${name}`;

const option = (value: string, sortOrder = 0) => ({ value, label: {}, labelDefault: value, isDefault: false, sortOrder });

interface AuditRow {
  actorAdminUserId?: string | null;
  stateAfter?: Record<string, unknown> | null;
}

describe('orders — custom-field values received from a Sales Opportunity', () => {
  let h: BackendServerHandle;
  let port: CustomFieldCarryReceiverPort;
  const mailer = new InMemoryMailer();
  let otherOrganizationId: string;
  const created: string[] = [];

  const define = async (entityType: string, key: string, extra: Record<string, unknown> = {}) => {
    const response = await h.app.inject({
      method: 'POST',
      url: `${API}/definitions`,
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

  /** An Order field and the same-key Opportunity field carrying to it. */
  const pair = async (name: string) => {
    const key = fixtureKey(name);
    const orderDefinitionId = await define('order', key);
    await define('opportunity', key, { carryTo: ['order'] });
    return { key, orderDefinitionId };
  };

  const receive = (recordId: string, values: Record<string, unknown>, organizationId = TEST_ORGANIZATION_ID) =>
    enterSystemScope('test: crm pushes an opportunity’s values', () =>
      port.receiveCarriedValues({
        recordId,
        organizationId,
        source: { entityType: 'opportunity', recordId: randomUUID(), reference: 'OPP-000042', values },
      }),
    );

  const storedValues = async (id: string): Promise<Record<string, unknown>> => {
    const rows = (await h
      .em()
      .getConnection()
      .execute(`select custom_field_values from "orders" where id = ?`, [id])) as Array<{
      custom_field_values: Record<string, unknown> | null;
    }>;
    expect(rows).toHaveLength(1);
    return rows[0]!.custom_field_values ?? {};
  };

  const adminComments = async (id: string) => {
    const response = await h.app.inject({ method: 'GET', url: `/api/v1/admin/orders/${id}/comments`, cookies: CRM_ADMIN });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as {
      data: Array<{
        id: string;
        authorAdminUserId: string | null;
        authorCustomerAccountId: string | null;
        isCustomerVisible: boolean;
        notifyCustomer: boolean;
        systemNote: { source: Record<string, unknown>; skipped: unknown[] } | null;
      }>;
    }).data;
  };

  const audit = async (id: string): Promise<AuditRow[]> =>
    (await h.auditLogService.query({ action: 'order.custom_fields.carry', objectId: id })) as unknown as AuditRow[];

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    port = (h.container.cradle as unknown as { orderCustomFieldCarryPort: CustomFieldCarryReceiverPort })
      .orderCustomFieldCarryPort;
    otherOrganizationId = await seedCrmOrganization(h.em(), `cfc-other-${RUN}`);
  });

  afterAll(async () => {
    for (const id of [...created].reverse()) {
      await h.app.inject({ method: 'DELETE', url: `${API}/definitions/${id}`, cookies: CRM_ADMIN });
    }
    await teardownBackendServer(h);
  });

  it('fills an empty field in one audited Command attributed to the system (US3-1)', async () => {
    const { key } = await pair('filled');
    const order = await seedCrmOrder(h.em());
    const receipt = await receive(order.id, { [key]: 'fair' });
    expect(receipt).toEqual({ outcome: 'applied', carried: [key], skipped: [] });
    expect((await storedValues(order.id))[key]).toBe('fair');
    const entries = await audit(order.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorAdminUserId ?? null).toBeNull();
    // The entry names the carried key, never its value (D-288, #470).
    expect(entries[0]!.stateAfter).toMatchObject({ changedCustomFields: [key] });
    expect(JSON.stringify(entries[0]!.stateAfter)).not.toContain('fair');
  });

  it('keeps a value the Order already holds, and writes no entry (US3-3)', async () => {
    const { key } = await pair('kept');
    const order = await seedCrmOrder(h.em());
    await h
      .em()
      .getConnection()
      .execute(`update "orders" set custom_field_values = ?::jsonb where id = ?`, [JSON.stringify({ [key]: 'web' }), order.id]);
    const receipt = await receive(order.id, { [key]: 'fair' });
    expect(receipt).toEqual({ outcome: 'applied', carried: [], skipped: [] });
    expect((await storedValues(order.id))[key]).toBe('web');
    expect(await audit(order.id)).toEqual([]);
    expect((await adminComments(order.id)).filter((c) => c.systemNote !== null)).toEqual([]);
  });

  it('names a value it cannot carry in one internal system note, never shown or sent to the buyer (FR-010a)', async () => {
    const { key, orderDefinitionId } = await pair('skipped');
    const drift = await h.app.inject({
      method: 'PATCH',
      url: `${API}/definitions/${orderDefinitionId}`,
      cookies: CRM_ADMIN,
      payload: { audience: 'customer' },
    });
    expect(drift.statusCode, drift.body).toBe(200);
    const order = await seedCrmOrder(h.em());
    const sentBefore = mailer.sent.length;
    const receipt = await receive(order.id, { [key]: 'fair' });
    expect(receipt).toEqual({
      outcome: 'applied',
      carried: [],
      skipped: [{ key, reason: 'audience_mismatch', label: { labelDefault: key, labels: {} } }],
    });
    expect(Object.hasOwn(await storedValues(order.id), key)).toBe(false);

    const notes = (await adminComments(order.id)).filter((c) => c.systemNote !== null);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      authorAdminUserId: null,
      authorCustomerAccountId: null,
      isCustomerVisible: false,
      notifyCustomer: false,
    });
    expect(notes[0]!.systemNote).toMatchObject({
      source: { entityType: 'opportunity', reference: 'OPP-000042' },
      skipped: [{ key, reason: 'audience_mismatch' }],
    });
    expect((await audit(order.id))[0]?.stateAfter).toMatchObject({
      customFieldCarry: { skipped: [{ key, reason: 'audience_mismatch' }] },
    });

    const buyer = await h.app.inject({ method: 'GET', url: `/api/v1/orders/${order.id}/comments`, cookies: CRM_CUSTOMER });
    expect(buyer.statusCode, buyer.body).toBe(200);
    expect((buyer.json() as { data: unknown[] }).data).toEqual([]);
    expect(mailer.sent.slice(sentBefore)).toEqual([]);
  });

  it('waits for a write that holds the row and plans over what it committed — no lost update (review fix S6)', async () => {
    // Another writer holds the Order's row and changes another key of the bag.
    // The carry must not read the bag before that write commits: it takes the
    // row `for update` and plans over what it re-reads. Without the lock it
    // reads the old bag, waits only at its own UPDATE, and overwrites the other
    // writer's value. What tells the two apart is the final bag, not the timing.
    const { key } = await pair('locked');
    const otherKey = fixtureKey('locked_other');
    const order = await seedCrmOrder(h.em());

    const holder = await h.em().getKnex().transaction();
    let carry: Promise<unknown> | null = null;
    try {
      await holder.raw(`select id from "orders" where id = ? for update`, [order.id]);
      await holder.raw(`update "orders" set custom_field_values = ?::jsonb where id = ?`, [
        JSON.stringify({ [otherKey]: 'held by the other writer' }),
        order.id,
      ]);
      carry = receive(order.id, { [key]: 'fair' });
      const pending = Symbol('pending');
      const early = await Promise.race([carry, new Promise((resolve) => setTimeout(() => resolve(pending), 300))]);
      expect(early, 'the carry finished while another writer held the row').toBe(pending);
      await holder.commit();
    } catch (error) {
      await holder.rollback().catch(() => undefined);
      throw error;
    }

    expect(await carry).toEqual({ outcome: 'applied', carried: [key], skipped: [] });
    expect(await storedValues(order.id)).toEqual({ [otherKey]: 'held by the other writer', [key]: 'fair' });
  });

  it('answers not-found for another Organization’s Order exactly as for a missing one, and writes nothing (FR-012)', async () => {
    const { key } = await pair('foreign');
    const order = await seedCrmOrder(h.em());
    const foreign = await receive(order.id, { [key]: 'fair' }, otherOrganizationId);
    const missing = await receive(randomUUID(), { [key]: 'fair' });
    expect(foreign).toEqual({ outcome: 'not-found', carried: [], skipped: [] });
    expect(missing).toEqual(foreign);
    expect(Object.hasOwn(await storedValues(order.id), key)).toBe(false);
    expect(await audit(order.id)).toEqual([]);
  });
});
