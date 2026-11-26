import type { Command } from '@endora-commerce/platform/commands';
import type { Organization } from '../entities/organization.entity.js';
import { makeModerationTransitionCommand, type ModerationCommandInput } from './moderation-transition.js';

/**
 * `organization.rejected` — `pending_verification` → `rejected`
 * (`specs/186-aggregate-ports/` T026). The reason is stored on the row and
 * carried by the event; the audit entry records only that there is one. The
 * caller has already refused an empty reason. The event's `notifyCustomer`
 * carries the caller's choice of sending the rejection notice.
 */
export function makeRejectOrganizationCommand(
  input: ModerationCommandInput & {
    readonly reason: string;
    /** Whether the customer's rejection notice is sent; default `true`. */
    readonly notifyCustomer?: boolean;
  },
): Command<Organization> {
  return makeModerationTransitionCommand(
    {
      action: 'organization.rejected',
      requireStatus: 'pending_verification',
      newStatus: 'rejected',
      reason: input.reason,
      notifyCustomer: input.notifyCustomer ?? true,
      mutate: (org) => {
        org.status = 'rejected';
        org.rejectedAt = new Date();
        org.rejectedReason = input.reason;
      },
    },
    input,
  );
}
