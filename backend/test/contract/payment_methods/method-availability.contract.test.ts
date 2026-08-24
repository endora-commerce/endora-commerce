import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { PaymentMethod } from '../../helpers/package-entities.js';

/**
 * Feature 076 (D-82) — availability is `payment_methods`' operation.
 *
 * Whether a method is offered to buyers used to be writable from five places
 * under four action names, three of which named a gateway. What this file
 * asserts is the property that buys: **one** audit row, under **one** action
 * that names the payment method, and none at all when nothing changed.
 */
describe('Payment-method availability (feature 076)', () => {
  let h: BackendServerHandle;
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  let methodId: string;
  const code = `avail_${Date.now()}`;

  async function auditRowsFor(id: string): Promise<AuditLogEntry[]> {
    return h.em().find(
      AuditLogEntry,
      { objectType: 'payment_method', objectId: id },
      { orderBy: { actedAt: 'asc' } },
    );
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const created = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/payment-methods/${code}`,
      ...admin,
      payload: { name: { default: 'Availability probe' }, kind: 'bank_transfer', status: 'active' },
    });
    expect(created.statusCode).toBe(200);
    methodId = (created.json() as { data: { id: string } }).data.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('records exactly one audit row, under `payment_method.set_status`', async () => {
    const before = await auditRowsFor(methodId);

    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/payment-methods/${methodId}/status`,
      ...admin,
      payload: { status: 'inactive' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { status: string } }).data.status).toBe('inactive');

    h.em().clear();
    const row = await h.em().findOne(PaymentMethod, { id: methodId });
    expect(row?.status).toBe('inactive');

    const after = await auditRowsFor(methodId);
    expect(after.length).toBe(before.length + 1);
    const entry = after[after.length - 1]!;
    expect(entry.action).toBe('payment_method.set_status');
    // The diff is the one field the operation changed — not the whole record.
    expect(entry.stateBefore).toEqual({ status: 'active' });
    expect(entry.stateAfter).toEqual({ status: 'inactive' });
  });

  it('writes no audit row when the value is already the one asked for', async () => {
    const before = await auditRowsFor(methodId);
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/payment-methods/${methodId}/status`,
      ...admin,
      payload: { status: 'inactive' },
    });
    expect(res.statusCode).toBe(200);
    expect((await auditRowsFor(methodId)).length).toBe(before.length);
  });

  it('404s on a method that does not exist', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/payment-methods/00000000-0000-4000-8000-0000000000ff/status',
      ...admin,
      payload: { status: 'active' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a body that is not one of the two values', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/payment-methods/${methodId}/status`,
      ...admin,
      payload: { status: 'sometimes' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses an admin without the write permission', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/payment-methods/${methodId}/status`,
      cookies: { b2b_session: 'stub-restricted-admin-session' },
      payload: { status: 'active' },
    });
    expect(res.statusCode).toBe(403);
  });
});
