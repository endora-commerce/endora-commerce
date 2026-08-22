import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ERROR_CODES,
  quickOrderPreferenceScopeSchema,
  quickOrderPreferenceUpsertSchema,
  type CustomerAccountReadPort,
  type SalesRepAssignmentPort,
} from '@endora-commerce/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { DefaultPreferenceService } from './services/default-preference-service.js';
import { canManagePreference, type PreferenceActor } from './services/default-preference-authz.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Admin default-preferences routes (feature 039, FR-018). A platform admin
 * (no sales-rep assignments) manages any scope; a salesperson manages only
 * their assigned organizations and the customers within them. Guarded by
 * `orders:write`.
 */
export interface QuickOrderPreferenceAdminRoutesDeps {
  service: DefaultPreferenceService;
  /** `customer_accounts`' read model — the target customer's organisation. */
  customerAccounts: CustomerAccountReadPort;
  /** `organizations`' sales-rep scope — which orgs this admin may act on. */
  salesRepScope: SalesRepAssignmentPort;
  requireAdmin: RequireAdminFactory;
  resolveAdminContext: (req: FastifyRequest) => { adminUserId: string };
}

/**
 * "No assignments" is what makes an admin a platform admin here, and the port
 * answers exactly that question — `listAssignedOrganizationIds` replaces an
 * `em.find(OrganizationSalesRepAssignment, …)` against a table `organizations`
 * owns (feature 075, Phase C).
 */
async function adminActor(
  salesRepScope: SalesRepAssignmentPort,
  adminUserId: string,
): Promise<PreferenceActor> {
  const assignedOrganizationIds = await salesRepScope.listAssignedOrganizationIds(adminUserId);
  if (assignedOrganizationIds.length > 0) {
    return { kind: 'salesperson', assignedOrganizationIds };
  }
  return { kind: 'platform_admin' };
}

export async function registerQuickOrderPreferenceAdminRoutes(
  app: FastifyInstance,
  deps: QuickOrderPreferenceAdminRoutesDeps,
): Promise<void> {
  const { service, customerAccounts, salesRepScope, requireAdmin, resolveAdminContext } = deps;

  app.get(
    '/api/v1/admin/quick-order/preferences',
    { preHandler: requireAdmin('orders:write') },
    async (request) => {
      const query = request.query as { scope?: string; scopeId?: string };
      const scope = quickOrderPreferenceScopeSchema.parse(query.scope);
      const scopeId = query.scopeId ?? '';
      const actor = await adminActor(salesRepScope, resolveAdminContext(request).adminUserId);
      const targetCustomerOrgId =
        scope === 'customer'
          ? ((await customerAccounts.findById(scopeId))?.organizationId ?? null)
          : null;
      if (!canManagePreference(actor, { scope, scopeId }, targetCustomerOrgId)) {
        throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Not allowed to read these defaults.');
      }
      return { data: await service.readRaw(scope, scopeId) };
    },
  );

  app.put(
    '/api/v1/admin/quick-order/preferences',
    { preHandler: requireAdmin('orders:write'), schema: { body: quickOrderPreferenceUpsertSchema } },
    async (request) => {
      const body = quickOrderPreferenceUpsertSchema.parse(request.body);
      const ctx = resolveAdminContext(request);
      const actor = await adminActor(salesRepScope, ctx.adminUserId);
      const result = await service.upsert(actor, body, { actorAdminUserId: ctx.adminUserId });
      return { data: result };
    },
  );
}
