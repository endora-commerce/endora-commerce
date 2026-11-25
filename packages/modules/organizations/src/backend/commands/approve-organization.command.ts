import type { Command } from '@endora-commerce/platform/commands';
import type { Organization } from '../entities/organization.entity.js';
import { makeModerationTransitionCommand, type ModerationCommandInput } from './moderation-transition.js';

/**
 * `organization.approved` — `pending_verification` → `active`
 * (`specs/186-aggregate-ports/` T026). Stamps `approvedAt` and the approving
 * administrator: the ambient actor's, `null` for the system auto-approval.
 * The route `POST /api/v1/admin/organizations/:id/approve` and the moderation
 * service's auto mode both run it; see `moderation-transition.ts`.
 */
export function makeApproveOrganizationCommand(input: ModerationCommandInput): Command<Organization> {
  return makeModerationTransitionCommand(
    {
      action: 'organization.approved',
      requireStatus: 'pending_verification',
      newStatus: 'active',
      mutate: (org, actor) => {
        org.status = 'active';
        org.approvedAt = new Date();
        org.approvedByAdminUserId = actor.actorAdminUserId;
      },
    },
    input,
  );
}
