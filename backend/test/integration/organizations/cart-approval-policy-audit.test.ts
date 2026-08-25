import { Cart } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import {
  TEST_CUSTOMER_ID,
  TEST_CUSTOMER_RFQ_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';

import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';

import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';


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
 * The cart cascade stays where it is — it is `carts`' own rows, audited in
 * `carts`' own trail — and this file asserts it still happens, so the write's
 * relocation is not mistaken for a licence to change what it does.
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

  it('audits the platform-admin flip, with the acting admin and before/after state', async () => {
    expect(await policyAudits()).toHaveLength(0);

    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${orgId}/cart-approval-policy`,
      payload: { requiresCartApproval: true },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { requiresCartApproval: boolean } }).data.requiresCartApproval).toBe(
      true,
    );

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

  it('writes no second audit row when the requested value is already set', async () => {
    const before = (await policyAudits()).length;

    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${orgId}/cart-approval-policy`,
      payload: { requiresCartApproval: true },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    expect(await policyAudits()).toHaveLength(before);
  });

  it('audits the org-admin flip and still cascades the cart reset', async () => {
    // The acting Org Admin's own cart. `Cart` is `@CustomerScoped`, so under a
    // customer request the cascade only ever reached the caller's own carts —
    // a pre-existing tenant-scope limitation of this cascade, unchanged here
    // and deliberately not papered over by the fixture. The platform-admin
    // path below is the one that reaches another member's cart.
    const em = h.em();
    const pending = em.create(Cart, {
      customerAccountId: TEST_CUSTOMER_ID,
      organizationId: orgId,
      status: 'active',
      approvalStatus: 'pending',
    });
    await em.persistAndFlush(pending);

    const before = (await policyAudits()).length;
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/organization/policies/cart-approval',
      payload: { requiresCartApproval: false },
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(200);

    const rows = await policyAudits();
    expect(rows).toHaveLength(before + 1);
    const latest = rows[rows.length - 1]!;
    // An Org Admin is a customer actor, so the platform audit row carries no
    // acting admin id — the fact recorded is that the policy changed.
    expect(latest.actorAdminUserId ?? null).toBeNull();
    expect((latest.stateBefore as { requiresCartApproval?: boolean } | null)?.requiresCartApproval)
      .toBe(true);
    expect((latest.stateAfter as { requiresCartApproval?: boolean } | null)?.requiresCartApproval)
      .toBe(false);

    // Unchanged by the relocation: turning the policy off returns the pending
    // or approved carts the caller can see to `not_required`.
    const reset = await h.em().findOne(Cart, { id: pending.id });
    expect(reset!.approvalStatus).toBe('not_required');
  });

  it('still cascades another member’s cart when a platform admin switches the policy off', async () => {
    const on = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${orgId}/cart-approval-policy`,
      payload: { requiresCartApproval: true },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(on.statusCode).toBe(200);

    const em = h.em();
    const pending = em.create(Cart, {
      customerAccountId: TEST_CUSTOMER_RFQ_ID,
      organizationId: orgId,
      status: 'active',
      approvalStatus: 'pending',
    });
    await em.persistAndFlush(pending);

    const off = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${orgId}/cart-approval-policy`,
      payload: { requiresCartApproval: false },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(off.statusCode).toBe(200);

    const reset = await h.em().findOne(Cart, { id: pending.id });
    expect(reset!.approvalStatus).toBe('not_required');
  });
});
