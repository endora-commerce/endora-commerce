import { describe, expect, it } from 'vitest';
import type {
  CartApprovalStatus,
  CustomerAccountRecord,
  OrganizationRecord,
} from '@endora-commerce/contracts';
import { basketAwaitsApproval, type CartApprovalPolicyReads } from './cart-approval-policy.js';

const ORG = 'org-1';
const MEMBER = 'member-1';
const ADMIN = 'admin-1';

function reads(requiresCartApproval: boolean): CartApprovalPolicyReads {
  return {
    organizations: {
      findById: async (id: string) =>
        id === ORG ? ({ id, requiresCartApproval } as unknown as OrganizationRecord) : null,
    },
    customerAccounts: {
      findById: async (id: string) =>
        id === MEMBER || id === ADMIN
          ? ({ id, role: id === ADMIN ? 'organization_admin' : 'regular_user' } as unknown as CustomerAccountRecord)
          : null,
    },
  };
}

const basket = (customerAccountId: string | null, approvalStatus: CartApprovalStatus) => ({
  cart: { customerAccountId, approvalStatus },
  organizationId: ORG,
});

/** Issue #648 — the rule placement asks `carts` before it reserves anything. */
describe('basketAwaitsApproval', () => {
  it.each<CartApprovalStatus>(['not_required', 'pending', 'rejected_by_org_admin'])(
    "a member's %s basket awaits approval when the Organization requires it",
    async (status) => {
      expect(await basketAwaitsApproval(reads(true), basket(MEMBER, status))).toBe(true);
    },
  );

  it("a member's approved basket does not", async () => {
    expect(await basketAwaitsApproval(reads(true), basket(MEMBER, 'approved'))).toBe(false);
  });

  it("the Organization administrator's own basket does not (self-approval exemption)", async () => {
    expect(await basketAwaitsApproval(reads(true), basket(ADMIN, 'not_required'))).toBe(false);
  });

  it('no basket does in an Organization without the policy', async () => {
    for (const status of ['not_required', 'pending'] as const) {
      expect(await basketAwaitsApproval(reads(false), basket(MEMBER, status))).toBe(false);
    }
  });

  it('a basket with no owner, or an owner nobody knows, is not this rule’s to refuse', async () => {
    expect(await basketAwaitsApproval(reads(true), basket(null, 'not_required'))).toBe(false);
    expect(await basketAwaitsApproval(reads(true), basket('unknown', 'not_required'))).toBe(false);
  });
});
