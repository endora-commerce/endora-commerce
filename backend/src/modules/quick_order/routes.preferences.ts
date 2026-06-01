import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  quickOrderPreferenceScopeSchema,
  quickOrderPreferenceUpsertSchema,
} from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import { CustomerAccount } from '../customer_accounts/entities/customer-account.entity.js';
import type { DefaultPreferenceService } from './services/default-preference-service.js';
import { canManagePreference, type PreferenceActor } from './services/default-preference-authz.js';

/**
 * Storefront default-preferences routes (feature 039, US2). The caller manages
 * their own customer scope, and — when they hold the organization-admin role —
 * their organization scope and its customers. Checkout reads the resolved
 * defaults via `/resolved`.
 */
export interface QuickOrderPreferenceRoutesDeps {
  service: DefaultPreferenceService;
  emFactory: () => EntityManager;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
}

async function resolveActor(
  em: EntityManager,
  customerAccountId: string,
): Promise<{ actor: PreferenceActor; organizationId: string | null }> {
  const account = await em.findOne(CustomerAccount, { id: customerAccountId });
  const organizationId = account?.organizationId ?? null;
  if (account?.role === 'organization_admin' && organizationId) {
    return { actor: { kind: 'org_admin', organizationId }, organizationId };
  }
  return { actor: { kind: 'customer', customerAccountId }, organizationId };
}

export async function registerQuickOrderPreferenceRoutes(
  app: FastifyInstance,
  deps: QuickOrderPreferenceRoutesDeps,
): Promise<void> {
  const { service, emFactory, requireCustomer, resolveCustomerContext } = deps;

  app.get(
    '/api/v1/quick-order/preferences/resolved',
    { preHandler: requireCustomer },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      return { data: await service.resolveForCustomer(ctx.customerAccountId) };
    },
  );

  app.get('/api/v1/quick-order/preferences', { preHandler: requireCustomer }, async (request) => {
    const query = request.query as { scope?: string; scopeId?: string };
    const scope = quickOrderPreferenceScopeSchema.parse(query.scope);
    const scopeId = query.scopeId ?? '';
    const ctx = resolveCustomerContext(request);
    const em = emFactory();
    const { actor } = await resolveActor(em, ctx.customerAccountId);

    const targetCustomerOrgId =
      scope === 'customer'
        ? ((await em.findOne(CustomerAccount, { id: scopeId }))?.organizationId ?? null)
        : null;
    if (!canManagePreference(actor, { scope, scopeId }, targetCustomerOrgId)) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Not allowed to read these defaults.');
    }
    return { data: await service.readRaw(scope, scopeId) };
  });

  app.put(
    '/api/v1/quick-order/preferences',
    { preHandler: requireCustomer, schema: { body: quickOrderPreferenceUpsertSchema } },
    async (request) => {
      const body = quickOrderPreferenceUpsertSchema.parse(request.body);
      const ctx = resolveCustomerContext(request);
      const em = emFactory();
      const { actor } = await resolveActor(em, ctx.customerAccountId);
      const result = await service.upsert(actor, body, {
        customerAccountId: ctx.customerAccountId,
      });
      return { data: result };
    },
  );
}
