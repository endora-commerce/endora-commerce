import { ERROR_CODES } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { Organization } from '../entities/organization.entity.js';

/**
 * `organization.set_credit_mode` (feature 056 US3, Principle XIII).
 *
 * Platform-admin-only change of a per-organization credit-inheritance mode
 * override (`shared_pool` | `independent_default` | `null` ⇒ Settings global
 * default). This is a money-behavior switch, so the route rejects any scoped /
 * roll-up actor (403) before running the Command; the Command owns the audit.
 */
export type CreditInheritanceModeValue = 'shared_pool' | 'independent_default' | null;

export function makeSetCreditModeCommand(input: {
  organizationId: string;
  mode: CreditInheritanceModeValue;
}): Command<Organization> {
  return {
    action: 'organization.set_credit_mode',
    objectType: 'organization',
    objectId: input.organizationId,
    run: async ({ em }) => {
      const org = await em.findOne(Organization, { id: input.organizationId, deletedAt: null });
      if (!org) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
      }
      const before = { creditInheritanceMode: org.creditInheritanceMode ?? null };
      org.creditInheritanceMode = input.mode;
      await em.flush();
      return {
        result: org,
        before,
        after: { creditInheritanceMode: input.mode },
      };
    },
  };
}
