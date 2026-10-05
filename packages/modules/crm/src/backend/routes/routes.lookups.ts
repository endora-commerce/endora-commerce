import type { FastifyInstance } from 'fastify';
import {
  OpportunityAssigneeLookupQuerySchema,
  OpportunityContactLookupQuerySchema,
  OpportunityOrganizationLookupQuerySchema,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { CrmLookupService } from '../services/crm-lookup-service.js';

export interface LookupRoutesDeps {
  lookupService: CrmLookupService;
  requireAdmin: RequireAdminFactory;
}

/**
 * What the CRM screens' pickers choose from
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §10a).
 *
 * Three are `crm:read` — the list and the board filter by Organization, Sales
 * Channel and assignee, so whoever may read those screens may fill their
 * filters. The contact persons of an Organization are offered only where one is
 * chosen, on the create and edit forms, and so are `crm:write`.
 */
export async function registerCrmLookupRoutes(
  app: FastifyInstance,
  deps: LookupRoutesDeps,
): Promise<void> {
  const { requireAdmin, lookupService: lookups } = deps;

  app.get(
    '/api/v1/admin/crm/lookups/organizations',
    { preHandler: requireAdmin('crm:read') },
    async (request) => ({
      data: await lookups.organizations(
        OpportunityOrganizationLookupQuerySchema.parse(request.query ?? {}),
      ),
    }),
  );

  app.get(
    '/api/v1/admin/crm/lookups/sales-channels',
    { preHandler: requireAdmin('crm:read') },
    async () => ({ data: await lookups.salesChannels() }),
  );

  app.get(
    '/api/v1/admin/crm/lookups/assignees',
    { preHandler: requireAdmin('crm:read') },
    async (request) => ({
      data: await lookups.assignees(OpportunityAssigneeLookupQuerySchema.parse(request.query ?? {})),
    }),
  );

  app.get(
    '/api/v1/admin/crm/lookups/contacts',
    { preHandler: requireAdmin('crm:write') },
    async (request) => ({
      data: await lookups.contacts(OpportunityContactLookupQuerySchema.parse(request.query ?? {})),
    }),
  );
}
