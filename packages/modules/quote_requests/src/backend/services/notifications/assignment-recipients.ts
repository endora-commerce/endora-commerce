import type { AdminUserReadPort, SalesRepAssignmentPort } from '@endora-commerce/contracts';
import type { NotificationRecipientResolver } from '../rfq-notification-service.js';

/**
 * The recipient rule the module applied before
 * `specs/179-rfq-and-customer-notifications/`, unchanged and in one place:
 * the customer side is the requester; the operator side is the Organization's
 * assigned sales representatives, or every administrator when it has none.
 *
 * It is what the recording step resolves until WP-03 replaces it with the
 * feature's rule (research R-3: the members who may open the request; R-5:
 * the assignee and representatives holding `rfqs:handle`, else every holder).
 * Moving the rule here first means WP-03 changes recipients and nothing else.
 */
export function createAssignmentRecipientResolver(deps: {
  salesRepAssignment: SalesRepAssignmentPort;
  adminUsers: AdminUserReadPort;
}): NotificationRecipientResolver {
  return {
    async customerSide(rfq) {
      return [rfq.customerAccountId];
    },
    async operatorSide(rfq) {
      const assignments = await deps.salesRepAssignment.listForOrganization(rfq.organizationId);
      if (assignments.length > 0) return assignments.map((assignment) => assignment.adminUserId);
      return (await deps.adminUsers.listAll()).map((admin) => admin.id);
    },
  };
}
