import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminOrderDetailSchema,
  ERROR_CODES,
  ORDER_EXTERNAL_REFERENCE_PORT,
  type OrderExternalReferencePort,
} from '@endora-commerce/contracts';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { OTHER_TEST_ORGANIZATION_ID, TEST_ADMIN_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { CRM_ADMIN, seedCrmOrder } from '../../helpers/seed-crm.js';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';

/**
 * Issue #1030 — `orderExternalReferencePort`, resolved from the composed
 * container the way a connector module resolves it: an external system's
 * number for an order, the hand-over's state and the other system's words,
 * recorded on the order with no admin HTTP call, audited per actual change
 * with the calling actor, and refused for an order the caller cannot see.
 *
 * `orders` declares `activation.nonDeactivatable`, so the port has no off
 * state to fail closed into; the gate `providePort` puts on it is the one
 * every port of this module carries, and is not re-proved here.
 */
const ACTION = 'order.external_reference.set';
const SYSTEM = `erp_${randomUUID().slice(0, 8)}`;

interface AuditRow {
  actorAdminUserId?: string | null;
  stateBefore?: Record<string, unknown> | null;
  stateAfter?: Record<string, unknown> | null;
}

describe('orders — orderExternalReferencePort (issue #1030)', () => {
  let h: BackendServerHandle;
  let orderId: string;
  let foreignOrderId: string;
  const port = () => h.container.resolve<OrderExternalReferencePort>(ORDER_EXTERNAL_REFERENCE_PORT);
  const asAdmin = <T>(fn: () => Promise<T>) =>
    runWithTenantContext({ mode: 'all', actor: { kind: 'admin', id: TEST_ADMIN_ID } }, fn);
  const asSystem = <T>(fn: () => Promise<T>) => enterSystemScope('test: a connector records its reference', fn);
  const asOrganization = <T>(organizationId: string, fn: () => Promise<T>) =>
    runWithTenantContext({ mode: 'single-org', organizationId, actor: { kind: 'customer', id: randomUUID() } }, fn);
  const audit = async (objectId: string): Promise<AuditRow[]> =>
    (await h.auditLogService.query({ action: ACTION, objectId })) as unknown as AuditRow[];

  async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
    try {
      await promise;
    } catch (error) {
      return error as { statusCode: number; code: string };
    }
    throw new Error('expected a refusal');
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    orderId = (await seedCrmOrder(h.em())).id;
    foreignOrderId = (await seedCrmOrder(h.em(), { organizationId: OTHER_TEST_ORGANIZATION_ID })).id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('records a reference and its state, audited with the calling admin', async () => {
    const written = await asAdmin(() => port().set(orderId, SYSTEM, { state: 'synced', reference: 'ZS/2026/1042' }));
    expect(written).toMatchObject({ orderId, system: SYSTEM, reference: 'ZS/2026/1042', state: 'synced', message: null });

    const rows = await audit(orderId);
    expect(rows).toHaveLength(1);
    // The ORM hydrates a null column as `undefined`.
    expect(rows[0]!.stateBefore ?? null).toBeNull();
    expect(rows[0]).toMatchObject({
      actorAdminUserId: TEST_ADMIN_ID,
      stateAfter: { system: SYSTEM, reference: 'ZS/2026/1042', state: 'synced', message: null },
    });
  });

  it('records nothing for a resend that changes nothing, and keeps `updatedAt`', async () => {
    const before = await asSystem(() => port().get(orderId, SYSTEM));
    const again = await asSystem(() => port().set(orderId, SYSTEM, { state: 'synced', reference: 'ZS/2026/1042' }));
    expect(again.updatedAt.getTime()).toBe(before!.updatedAt.getTime());
    expect(await audit(orderId)).toHaveLength(1);
  });

  it('records a refusal as a second change, from a system actor', async () => {
    await asSystem(() =>
      port().set(orderId, SYSTEM, { state: 'error', message: 'Item 1042 is blocked for sale' }),
    );
    const rows = await audit(orderId);
    expect(rows).toHaveLength(2);
    const latest = rows.find((row) => row.stateAfter?.['state'] === 'error');
    expect(latest?.actorAdminUserId ?? null).toBeNull();
    expect(latest).toMatchObject({
      stateBefore: { state: 'synced' },
      stateAfter: { reference: 'ZS/2026/1042', state: 'error', message: 'Item 1042 is blocked for sale' },
    });
  });

  it('reads the entry back, lists it, and finds the order by its reference', async () => {
    await asSystem(() => port().set(orderId, `${SYSTEM}_wms`, { state: 'pending' }));
    const listed = await asSystem(() => port().listForOrder(orderId));
    expect(listed.map((row) => row.system)).toEqual([SYSTEM, `${SYSTEM}_wms`]);
    expect(await asSystem(() => port().findOrderIds(SYSTEM, 'ZS/2026/1042'))).toEqual([orderId]);
    expect(await asSystem(() => port().findOrderIds(`${SYSTEM}_wms`, 'ZS/2026/1042'))).toEqual([]);
  });

  it('shows the entries on the admin order detail', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/orders/${orderId}`, cookies: CRM_ADMIN });
    expect(res.statusCode, res.body).toBe(200);
    const detail = adminOrderDetailSchema.parse((res.json() as { data: unknown }).data);
    expect(detail.externalReferences).toEqual([
      expect.objectContaining({ system: SYSTEM, reference: 'ZS/2026/1042', state: 'error', message: 'Item 1042 is blocked for sale' }),
      expect.objectContaining({ system: `${SYSTEM}_wms`, reference: null, state: 'pending', message: null }),
    ]);
  });

  it('refuses an unknown order with ORDER_NOT_FOUND and writes nothing', async () => {
    const unknown = randomUUID();
    expect(await refusal(asSystem(() => port().set(unknown, SYSTEM, { state: 'pending' })))).toMatchObject({
      statusCode: 404,
      code: ERROR_CODES.ORDER_NOT_FOUND,
    });
    expect(await audit(unknown)).toHaveLength(0);
  });

  it('refuses a malformed system key or message with VALIDATION_FAILED', async () => {
    for (const call of [
      () => port().set(orderId, 'ERP System', { state: 'pending' }),
      () => port().set(orderId, SYSTEM, { state: 'error', message: 'x'.repeat(1001) }),
    ]) {
      expect(await refusal(asSystem(call))).toMatchObject({ statusCode: 400, code: ERROR_CODES.VALIDATION_FAILED });
    }
  });

  it('confines reads and writes to the orders the caller can see', async () => {
    await asSystem(() => port().set(foreignOrderId, SYSTEM, { state: 'synced', reference: 'ZS/2026/9999' }));

    await asOrganization(TEST_ORGANIZATION_ID, async () => {
      expect(await refusal(port().set(foreignOrderId, SYSTEM, { state: 'pending' }))).toMatchObject({
        statusCode: 404,
        code: ERROR_CODES.ORDER_NOT_FOUND,
      });
      expect(await port().get(foreignOrderId, SYSTEM)).toBeNull();
      expect(await port().listForOrder(foreignOrderId)).toEqual([]);
      expect(await port().findOrderIds(SYSTEM, 'ZS/2026/9999')).toEqual([]);
    });
    expect(await asSystem(() => port().get(foreignOrderId, SYSTEM))).toMatchObject({ state: 'synced' });
  });
});
