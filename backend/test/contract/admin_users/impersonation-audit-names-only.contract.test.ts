import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Issue #470 (D-288, `specs/conventions/audit-state.md` §2) — the platform-wide
 * audit screen, `GET /api/v1/admin/audit-log`, is read under `audit_log:read`
 * without Organization reach. So an `impersonation.start` entry carries
 * whether a reason was given and whether the start named an Organization,
 * never the reason or the Organization. The row read is the one this test's own
 * start produced, found by its object id and its reason store row's id.
 */
describe('impersonation entries in the platform audit log (#470)', () => {
  let h: BackendServerHandle;
  const reason = `S470-DESC s470@example.test ${randomUUID().slice(0, 8)}`;
  let reasonId: string | undefined;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    if (h && reasonId) {
      await withSystemScope('#470 contract test: clean up its reason row', () =>
        h.em().getConnection().execute(`delete from "admin_impersonation_reasons" where "id" = ?`, [reasonId]),
      );
    }
    await teardownBackendServer(h);
  });

  it('a start with a reason leaves neither the reason nor the Organization in GET /admin/audit-log', async () => {
    const start = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/impersonate`,
      payload: { customerAccountId: TEST_CUSTOMER_ID, reason },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(start.statusCode, start.body).toBe(200);
    const [row] = await withSystemScope('#470 contract test: find its reason row', () =>
      h
        .em()
        .getConnection()
        .execute<Array<{ id: string }>>(`select "id" from "admin_impersonation_reasons" where "reason" = ?`, [reason]),
    );
    reasonId = row?.id;
    expect(reasonId).toBeDefined();

    const read = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-log?filter[action]=impersonation.start',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(read.statusCode, read.body).toBe(200);
    const rows = (read.json() as { data: Array<{ objectId: string; stateBefore: unknown; stateAfter: unknown }> }).data;
    const own = rows.filter(
      (entry) => (entry.stateAfter as { valueChangeId?: string } | null)?.valueChangeId === reasonId,
    );
    expect(own).toHaveLength(1);
    expect(own[0]!.objectId).toBe(TEST_CUSTOMER_ID);
    const recorded = JSON.stringify([own[0]!.stateBefore, own[0]!.stateAfter]).toLowerCase();
    for (const sentinel of ['s470-desc', 's470@example.test', TEST_ORGANIZATION_ID]) expect(recorded, sentinel).not.toContain(sentinel);
    expect(own[0]!.stateAfter).toEqual({
      hasReason: true,
      reasonLength: reason.length,
      organizationScoped: true,
      valueChangeId: reasonId,
    });
  });
});
