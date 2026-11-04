import { describe, expect, it, vi } from 'vitest';
import type { CartApprovalStatus, OrganizationPermissionSubject } from '@endora-commerce/contracts';
import {
  approvalSubmissionRequired,
  basketAwaitsApproval,
  type CartApprovalPolicyReads,
} from './cart-approval-policy.js';

const ORG = 'org-1';
const MEMBER = 'member-1';
const TRUSTED = 'trusted-1';

/** `TRUSTED` holds `carts.order_without_approval`; nobody else does — an unknown account fails closed. */
function reads(): CartApprovalPolicyReads & { can: ReturnType<typeof vi.fn> } {
  const can = vi.fn(
    async (subject: OrganizationPermissionSubject, code: string) =>
      code === 'carts.order_without_approval' && subject.customerAccountId === TRUSTED && subject.organizationId === ORG,
  );
  return { permissions: { can }, can };
}

const basket = (customerAccountId: string | null, approvalStatus: CartApprovalStatus) => ({
  cart: { customerAccountId, approvalStatus },
  organizationId: ORG,
});

/**
 * Issue #648 — the rule placement asks `carts` before it reserves anything;
 * `specs/170-organization-roles/` (R-4, R-25) — judged by the buyer's
 * `carts.order_without_approval`, not by an Organization flag and a role value.
 */
describe('basketAwaitsApproval', () => {
  it.each<CartApprovalStatus>(['not_required', 'pending', 'rejected_by_org_admin'])(
    'the %s basket of a member without carts.order_without_approval awaits approval',
    async (status) => {
      expect(await basketAwaitsApproval(reads(), basket(MEMBER, status))).toBe(true);
    },
  );

  it("such a member's approved basket does not", async () => {
    const policy = reads();
    expect(await basketAwaitsApproval(policy, basket(MEMBER, 'approved'))).toBe(false);
    expect(policy.can).not.toHaveBeenCalled();
  });

  it('no basket of a holder of carts.order_without_approval does, pending included (R-25)', async () => {
    for (const status of ['not_required', 'pending'] as const) {
      expect(await basketAwaitsApproval(reads(), basket(TRUSTED, status))).toBe(false);
    }
  });

  it('judges the basket owner in the basket’s Organization', async () => {
    const policy = reads();
    await basketAwaitsApproval(policy, basket(MEMBER, 'not_required'));
    expect(policy.can).toHaveBeenCalledWith(
      { customerAccountId: MEMBER, organizationId: ORG },
      'carts.order_without_approval',
    );
  });

  it("hands the port the owner's role when the caller knows it (FR-080)", async () => {
    const policy = reads();
    await basketAwaitsApproval(policy, {
      ...basket(MEMBER, 'not_required'),
      organizationRoleId: 'role-1',
    });
    expect(policy.can.mock.calls.map(([subject]) => subject)).toStrictEqual([
      { customerAccountId: MEMBER, organizationId: ORG, organizationRoleId: 'role-1' },
    ]);
  });

  it('a basket with no owner is not this rule’s to refuse; an owner nobody knows fails closed', async () => {
    expect(await basketAwaitsApproval(reads(), basket(null, 'not_required'))).toBe(false);
    expect(await basketAwaitsApproval(reads(), basket('unknown', 'not_required'))).toBe(true);
  });
});

describe('approvalSubmissionRequired', () => {
  it('is the negation of carts.order_without_approval', async () => {
    expect(await approvalSubmissionRequired(reads(), { customerAccountId: MEMBER, organizationId: ORG })).toBe(true);
    expect(await approvalSubmissionRequired(reads(), { customerAccountId: TRUSTED, organizationId: ORG })).toBe(false);
  });

  // `specs/170-organization-roles/` FR-080 (WP-13, T113): the requester's role,
  // which the actor carries, is handed on so the port judges from its cache.
  it("hands the port the buyer's role when the caller knows it, and none when it does not", async () => {
    const policy = reads();
    await approvalSubmissionRequired(policy, { customerAccountId: MEMBER, organizationId: ORG, organizationRoleId: 'role-1' });
    await approvalSubmissionRequired(policy, { customerAccountId: MEMBER, organizationId: ORG, organizationRoleId: null });
    expect(policy.can.mock.calls.map(([subject]) => subject)).toStrictEqual([
      { customerAccountId: MEMBER, organizationId: ORG, organizationRoleId: 'role-1' },
      { customerAccountId: MEMBER, organizationId: ORG },
    ]);
  });
});
