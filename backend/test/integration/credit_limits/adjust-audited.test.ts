import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCreditLimitWithActiveReservation } from '../../helpers/seed-credit-limit.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';

/**
 * Feature 054 (US1 / T018) — credit_limit.adjust runs through the Command Bus.
 *
 * Previously an UNAUDITED write; the conversion adds a co-transactional audit
 * entry via the real admin route + composition (commandBus wired in). Verifies:
 *  - a successful adjust writes exactly one `credit_limit.adjust` audit row with
 *    the acting admin + before/after state;
 *  - the no-op path (ADJUSTMENT_BELOW_ACTIVE, 409) writes NO audit row.
 */
describe('PATCH /admin/organizations/:id/credit-limit — audited via Command Bus [real DB]', () => {
  let h: BackendServerHandle;
  const orgId = TEST_ORGANIZATION_ID;

  const countAdjustAudits = async (): Promise<number> =>
    h.em().count(AuditLogEntry, { action: 'credit_limit.adjust', objectId: orgId });

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCreditLimitWithActiveReservation(h.em()); // grants 10000, reserves 5000
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('writes one audit row with actor + before/after on a successful adjust', async () => {
    expect(await countAdjustAudits()).toBe(0);

    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${orgId}/credit-limit`,
      payload: { grantedAmount: 8000, reason: 'raise cap' },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);

    const rows = await h.em().find(AuditLogEntry, {
      action: 'credit_limit.adjust',
      objectId: orgId,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.objectType).toBe('credit_limit');
    expect(rows[0]?.actorAdminUserId).toBeTruthy(); // an admin performed it (server-derived)
    expect((rows[0]?.stateAfter as { grantedAmount?: string } | null)?.grantedAmount).toBe(
      '8000.00',
    );
    expect((rows[0]?.stateBefore as { grantedAmount?: string } | null)?.grantedAmount).toBe(
      '10000.00',
    );
  });

  it('writes NO audit row for a refused (no-op) adjust', async () => {
    const before = await countAdjustAudits();
    // Reserved sum is 5000; lowering to 1000 without override → 409, no mutation.
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${orgId}/credit-limit`,
      payload: { grantedAmount: 1000 },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(409);
    expect(await countAdjustAudits()).toBe(before); // unchanged — skipAudit honored
  });
});
