import type { Command } from '@endora-commerce/platform/commands';
import type { Organization } from '../entities/organization.entity.js';
import { makeModerationTransitionCommand, type ModerationCommandInput } from './moderation-transition.js';

/**
 * `organization.blocked` — `active` → `blocked` (`specs/186-aggregate-ports/`
 * T026). The optional reason is stored on the row and carried by the event;
 * the audit entry records only whether there is one.
 */
export function makeBlockOrganizationCommand(
  input: ModerationCommandInput & { readonly reason?: string | null },
): Command<Organization> {
  const reason = input.reason ?? null;
  return makeModerationTransitionCommand(
    {
      action: 'organization.blocked',
      requireStatus: 'active',
      notifyCustomer: false,
      newStatus: 'blocked',
      reason,
      mutate: (org) => {
        org.status = 'blocked';
        org.blockedAt = new Date();
        org.blockedReason = reason;
      },
    },
    input,
  );
}
