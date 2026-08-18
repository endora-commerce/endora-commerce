import { ERROR_CODES, type CartApprovalPolicyWriteResult } from '@b2b/contracts';
import type { Command } from '../../../commands/command.js';
import { HttpError } from '../../../http/error-envelope.js';
import { Organization } from '../entities/organization.entity.js';
import { toOrganizationRecord } from '../services/organization-details-port.js';

/**
 * `organization.set_cart_approval_policy` (issue #175, Principle XIII).
 *
 * Flips `organizations.requires_cart_approval` — the per-organisation "an Org
 * Admin must approve a cart before checkout" policy of feature 027 US4.
 *
 * The write used to live in `carts` (`CartApprovalService.setPolicy*`), which
 * held this module's entity to do it. Moving it here is what D-78 step 1 asks
 * for, and it settles the question the direct write had been ducking: the flip
 * has never carried an audit row on the `organizations` side, and under
 * Constitution XIII it must. Hence a Command rather than a plain service
 * method — the actor is derived from the caller's ambient context by the bus,
 * never passed in, so the same Command serves the platform-admin route and the
 * Org-Admin self-service one and records which of them it was.
 *
 * Idempotent: a write of the value the row already carries mutates nothing and
 * records nothing (`skipAudit`), because an audit row saying a change happened
 * when none did is worse than no row. That is also the behaviour `carts` had,
 * and its cascade keys off `changed`.
 *
 * The lookup is `{ id }` with no `deletedAt` filter, deliberately: it is the
 * predicate the two `setPolicy*` methods used, and narrowing it here would be a
 * behaviour change riding along with a relocation.
 */
export function makeSetCartApprovalPolicyCommand(input: {
  organizationId: string;
  requiresCartApproval: boolean;
}): Command<CartApprovalPolicyWriteResult> {
  return {
    action: 'organization.set_cart_approval_policy',
    objectType: 'organization',
    objectId: input.organizationId,
    run: async ({ em }) => {
      const org = await em.findOne(Organization, { id: input.organizationId });
      if (!org) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'organization_not_found');
      }
      if (org.requiresCartApproval === input.requiresCartApproval) {
        return {
          result: { organization: toOrganizationRecord(org), changed: false },
          skipAudit: true,
        };
      }
      const before = { requiresCartApproval: org.requiresCartApproval };
      org.requiresCartApproval = input.requiresCartApproval;
      await em.flush();
      return {
        result: { organization: toOrganizationRecord(org), changed: true },
        before,
        after: { requiresCartApproval: input.requiresCartApproval },
      };
    },
  };
}
