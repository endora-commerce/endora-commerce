import { Organization } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrganizationCartApprovalWritePort } from '@endora-commerce/contracts';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import { TEST_ADMIN_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';

/**
 * Issue #175 — `organizations.requires_cart_approval` is written by its owner,
 * through the Command Bus, and the flip is audited.
 *
 * The policy column belongs to `organizations`; `carts` wrote it directly from
 * `CartApprovalService.setPolicy*` — the last cross-module import in that
 * module's ledger shard. D-78 step 1 says the owner owns the operation, and
 * publishing the write forces the question the direct write had been ducking:
 * **this flip has never had an audit row on the `organizations` side.** Under
 * Constitution XIII it must, so the port runs a Command.
 *
 * `specs/170-organization-roles/` WP-04 (OR-3) removed both HTTP routes that
 * reached this port — the operator's `…/cart-approval-policy` and the
 * Organization administrator's `PATCH /api/v1/organization/policies/cart-approval`
 * — and the cart cascade behind them: approval is a role's
 * `carts.order_without_approval` now, and the cascade is a `carts` subscriber
 * (`backend/test/integration/carts/cart-approval-role-cascade.test.ts`). The
 * Command and its port stay until WP-12 deletes them with the column, so this
 * file drives the port itself until then.
 */
describe('cart-approval policy — owner-side write, audited (issue #175)', () => {
  let h: BackendServerHandle;
  const orgId = TEST_ORGANIZATION_ID;
  const ACTION = 'organization.set_cart_approval_policy';

  const policyAudits = async (): Promise<AuditLogEntry[]> =>
    h.em().find(AuditLogEntry, { action: ACTION, objectId: orgId }, { orderBy: { actedAt: 'asc' } });

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** The Command runs under a platform admin's context, as the removed route did. */
  const runAsAdminActor = <T>(adminUserId: string, fn: () => Promise<T>): Promise<T> =>
    runWithTenantContext(resolveTenantContext({ kind: 'admin', adminUserId }, { allowAll: true }), fn);

  const port = (): OrganizationCartApprovalWritePort =>
    h.container.resolve('organizationCartApprovalWritePort') as OrganizationCartApprovalWritePort;

  it('audits the flip, with the acting admin and before/after state', async () => {
    expect(await policyAudits()).toHaveLength(0);

    const { organization, changed } = await runAsAdminActor(TEST_ADMIN_ID, () =>
      port().setCartApprovalPolicy(orgId, true),
    );
    expect(changed).toBe(true);
    expect(organization.requiresCartApproval).toBe(true);

    const rows = await policyAudits();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.objectType).toBe('organization');
    expect(rows[0]!.actorAdminUserId).toBeTruthy();
    expect((rows[0]!.stateBefore as { requiresCartApproval?: boolean } | null)?.requiresCartApproval)
      .toBe(false);
    expect((rows[0]!.stateAfter as { requiresCartApproval?: boolean } | null)?.requiresCartApproval)
      .toBe(true);

    const org = await h.em().findOne(Organization, { id: orgId });
    expect(org!.requiresCartApproval).toBe(true);
  });

  it('writes no second audit row when the requested value is already set, and switches back', async () => {
    const before = (await policyAudits()).length;
    const again = await runAsAdminActor(TEST_ADMIN_ID, () => port().setCartApprovalPolicy(orgId, true));
    expect(again.changed).toBe(false);
    expect(await policyAudits()).toHaveLength(before);

    // Put the fixture back, so a file that runs after this one sees the
    // organisation it was seeded with.
    const off = await runAsAdminActor(TEST_ADMIN_ID, () => port().setCartApprovalPolicy(orgId, false));
    expect(off.changed).toBe(true);
    expect(await policyAudits()).toHaveLength(before + 1);
  });

  it('is not reachable over HTTP any more (OR-3)', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${orgId}/cart-approval-policy`,
      payload: { requiresCartApproval: true },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(404);
  });
});
