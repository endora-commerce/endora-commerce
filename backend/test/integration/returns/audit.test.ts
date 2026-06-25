import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '../../../src/modules/audit_logs/entities/audit-log-entry.entity.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';

/**
 * Feature 046 (FR-041 / SC-006) — status changes and settlement are audited.
 */
describe('returns — audit trail', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('records a status-change audit entry on authorization', async () => {
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const reasonId = await anyReasonId(h.em());
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'return', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId }] },
    });
    const caseId = (created.json() as { data: { id: string } }).data.id;

    await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${caseId}/authorize`, cookies: ADMIN_COOKIE });

    const entries = await h.em().find(AuditLogEntry, { objectType: 'return_case', objectId: caseId });
    const actions = entries.map((e) => e.action);
    expect(actions).toContain('return.status_changed');
    const authEntry = entries.find(
      (e) => e.action === 'return.status_changed' && (e.stateAfter as { statusCode?: string })?.statusCode === 'authorized',
    );
    expect(authEntry).toBeTruthy();
  });
});
