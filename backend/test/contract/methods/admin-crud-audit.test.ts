import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';

/**
 * Issue #122 — the admin method surfaces leave an audit trail.
 *
 * `check-command-coverage` never opened a `routes*.ts` file, so these handlers
 * wrote payment- and delivery-method configuration straight through the
 * EntityManager and recorded nothing, for as long as they have existed. The
 * static check now sees them; this is the behavioural half, because a check that
 * a `record(...)` call exists is not a check that a row lands.
 */
describe('admin method configuration is audited (issue #122)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('records create, update and delete for a payment method', async () => {
    const create = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/payment-methods/audit_probe_card',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'audit_probe_card',
        name: { 'en-US': 'Audit probe' },
        kind: 'bank_transfer',
      },
    });
    expect(create.statusCode).toBe(200);
    const row = (create.json() as { data: { id: string } }).data;

    await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/payment-methods/audit_probe_card',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'audit_probe_card',
        name: { 'en-US': 'Audit probe (renamed)' },
        kind: 'bank_transfer',
        status: 'inactive',
      },
    });

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/payment-methods/${row.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(del.statusCode).toBe(204);

    const entries = await h
      .em()
      .find(AuditLogEntry, { objectType: 'payment_method', objectId: row.id });
    expect(entries.map((e) => e.action).sort()).toEqual([
      'payment_method.create',
      'payment_method.delete',
      'payment_method.update',
    ]);

    const update = entries.find((e) => e.action === 'payment_method.update')!;
    // The point of the before/after pair: the row says what the operator
    // changed, not only what the record ended up as.
    expect((update.stateBefore as { status?: string } | null)?.status).toBe('active');
    expect((update.stateAfter as { status?: string } | null)?.status).toBe('inactive');

    // `stateBefore`/`stateAfter` are optional columns, so an absent snapshot
    // reads back as `undefined` rather than `null`.
    const created = entries.find((e) => e.action === 'payment_method.create')!;
    expect(created.stateBefore ?? null).toBeNull();
    expect((created.stateAfter as { code?: string } | null)?.code).toBe('audit_probe_card');

    const removed = entries.find((e) => e.action === 'payment_method.delete')!;
    expect(removed.stateAfter ?? null).toBeNull();
    expect((removed.stateBefore as { code?: string } | null)?.code).toBe('audit_probe_card');
  });

  it('records create and delete for a delivery method', async () => {
    const create = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/delivery-methods/audit_probe_courier',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'audit_probe_courier',
        name: { 'en-US': 'Audit probe courier' },
        cost: 9.99,
        currency: 'PLN',
      },
    });
    expect(create.statusCode).toBe(200);
    const row = (create.json() as { data: { id: string } }).data;

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/delivery-methods/${row.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(del.statusCode).toBe(204);

    const entries = await h
      .em()
      .find(AuditLogEntry, { objectType: 'delivery_method', objectId: row.id });
    expect(entries.map((e) => e.action).sort()).toEqual([
      'delivery_method.create',
      'delivery_method.delete',
    ]);
  });
});
