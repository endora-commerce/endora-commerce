import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ERROR_CODES,
  quickOrderPreferenceScopeSchema,
  quickOrderPreferenceUpsertSchema,
  type CustomerAccountReadPort,
  type OrganizationDetailsPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { orgConstraintFor, orgInScope } from '@endora-commerce/platform/tenancy';
import type { DefaultPreferenceService } from './services/default-preference-service.js';
import { canManagePreference, type PreferenceActor } from './services/default-preference-authz.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

/**
 * Admin default-preferences routes (feature 039, FR-018). A platform admin
 * manages any scope; a salesperson manages only the organizations in their
 * reach (issue #305) and the customers within them. Guarded by
 * `orders:write`.
 */
export interface QuickOrderPreferenceAdminRoutesDeps {
  service: DefaultPreferenceService;
  /** `customer_accounts`' read model — the target customer's organisation. */
  customerAccounts: CustomerAccountReadPort;
  /**
   * `organizations`' read model. Issue #305 (ruling Q4 on PR #954): a sales
   * representative's reach is a complement, so an id naming no organization
   * is "in reach"; the write refuses it as not found instead.
   */
  organizations: Pick<OrganizationDetailsPort, 'findById'>;
  requireAdmin: RequireAdminFactory;
  resolveAdminContext: (req: FastifyRequest) => { adminUserId: string };
}

/**
 * Which kind of admin this is, read off the role-derived tenant context
 * (issue #305) rather than off the assignment table: an admin whose context
 * reaches every organisation is a platform admin, and anybody else — a sales
 * representative — manages the organisations in their reach, which is every
 * organisation nobody else governs. "Has no assignments" used to mean
 * "platform admin" here, which gave an unassigned representative everything.
 */
function adminActor(): PreferenceActor {
  const constraint = orgConstraintFor();
  if (constraint.kind === 'all') return { kind: 'platform_admin' };
  return { kind: 'salesperson', reaches: (organizationId) => orgInScope(organizationId, constraint) };
}

export async function registerQuickOrderPreferenceAdminRoutes(
  app: FastifyInstance,
  deps: QuickOrderPreferenceAdminRoutesDeps,
): Promise<void> {
  const { service, customerAccounts, organizations, requireAdmin, resolveAdminContext } = deps;

  app.get(
    '/api/v1/admin/quick-order/preferences',
    { preHandler: requireAdmin('orders:write') },
    async (request) => {
      const query = request.query as { scope?: string; scopeId?: string };
      const scope = quickOrderPreferenceScopeSchema.parse(query.scope);
      const scopeId = query.scopeId ?? '';
      const actor = adminActor();
      const targetCustomerOrgId =
        scope === 'customer'
          ? ((await customerAccounts.findById(scopeId))?.organizationId ?? null)
          : null;
      if (!(await canManagePreference(actor, { scope, scopeId }, targetCustomerOrgId))) {
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
      const actor = adminActor();
      if (actor.kind === 'salesperson' && body.scope === 'organization' && !(await organizations.findById(body.scopeId))) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
      }
      const result = await service.upsert(actor, body, { actorAdminUserId: ctx.adminUserId });
      return { data: result };
    },
  );
}
