import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  quickOrderPreferenceScopeSchema,
  quickOrderPreferenceUpsertSchema,
} from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import { CustomerAccount } from '../customer_accounts/entities/customer-account.entity.js';
import { OrganizationSalesRepAssignment } from '../organizations/entities/organization-sales-rep-assignment.entity.js';
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
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  resolveAdminContext: (req: FastifyRequest) => { adminUserId: string };
}

async function adminActor(em: EntityManager, adminUserId: string): Promise<PreferenceActor> {
  const assignments = await em.find(OrganizationSalesRepAssignment, { adminUserId });
  if (assignments.length > 0) {
    return {
      kind: 'salesperson',
      assignedOrganizationIds: assignments.map((a) => a.organizationId),
    };
  }
  return { kind: 'platform_admin' };
}

export async function registerQuickOrderPreferenceAdminRoutes(
  app: FastifyInstance,
  deps: QuickOrderPreferenceAdminRoutesDeps,
): Promise<void> {
  const { service, emFactory, requireAdmin, resolveAdminContext } = deps;

  app.get(
    '/api/v1/admin/quick-order/preferences',
    { preHandler: requireAdmin('orders:write') },
    async (request) => {
      const query = request.query as { scope?: string; scopeId?: string };
      const scope = quickOrderPreferenceScopeSchema.parse(query.scope);
      const scopeId = query.scopeId ?? '';
      const em = emFactory();
      const actor = await adminActor(em, resolveAdminContext(request).adminUserId);
      const targetCustomerOrgId =
        scope === 'customer'
          ? ((await em.findOne(CustomerAccount, { id: scopeId }))?.organizationId ?? null)
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
      const em = emFactory();
      const ctx = resolveAdminContext(request);
      const actor = await adminActor(em, ctx.adminUserId);
      const result = await service.upsert(actor, body, { actorAdminUserId: ctx.adminUserId });
      return { data: result };
    },
  );
}
