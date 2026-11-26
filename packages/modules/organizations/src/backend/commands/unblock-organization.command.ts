import type { Command } from '@endora-commerce/platform/commands';
import type { Organization } from '../entities/organization.entity.js';
import { makeModerationTransitionCommand, type ModerationCommandInput } from './moderation-transition.js';

/**
 * `organization.unblocked` — `blocked` → `active` (`specs/186-aggregate-ports/`
 * T026). Clears the block's date and reason.
 */
export function makeUnblockOrganizationCommand(input: ModerationCommandInput): Command<Organization> {
  return makeModerationTransitionCommand(
    {
      action: 'organization.unblocked',
      requireStatus: 'blocked',
      notifyCustomer: false,
      newStatus: 'active',
      mutate: (org) => {
        org.status = 'active';
        org.blockedAt = null;
        org.blockedReason = null;
      },
    },
    input,
  );
}
