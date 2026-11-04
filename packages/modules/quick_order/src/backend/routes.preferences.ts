import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ERROR_CODES,
  quickOrderPreferenceScopeSchema,
  quickOrderPreferenceUpsertSchema,
  type CustomerAccountReadPort,
  type OrganizationPermissionPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { DefaultPreferenceService } from './services/default-preference-service.js';
import { canManagePreference, type PreferenceActor } from './services/default-preference-authz.js';

/**
 * Storefront default-preferences routes (feature 039, US2). The caller manages
 * their own customer scope, and — when they hold their Organization's
 * *Administrator* role — their organization scope and its customers. Checkout
 * reads the resolved defaults via `/resolved`.
 *
 * Managing other members' defaults is a **reserved** capability
 * (`specs/170-organization-roles/` FR-012): asked of
 * `organizationPermissionPort.isAdministrator`, never a permission code, so no
 * custom role can be granted it, and a refusal is the existing `403
 * FORBIDDEN`. It used to be read off the account's legacy role.
 */
export interface QuickOrderPreferenceRoutesDeps {
  service: DefaultPreferenceService;
  /** `customer_accounts`' read model — the target customer's organisation. */
  customerAccounts: CustomerAccountReadPort;
  /** `organizations`' port, resolved per request (`module-composition.md` item 4a). */
  organizationPermissions: () => OrganizationPermissionPort;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
}

async function resolveActor(
  request: FastifyRequest,
  deps: QuickOrderPreferenceRoutesDeps,
): Promise<PreferenceActor> {
  const { customerAccountId, organizationId } = deps.resolveCustomerContext(request);
  const actor = request.actor;
  const administrator =
    organizationId !== '' &&
    (await deps.organizationPermissions().isAdministrator({
      customerAccountId,
      organizationId,
      organizationRoleId: actor.kind === 'customer' ? (actor.organizationRoleId ?? null) : null,
    }));
  return administrator
    ? { kind: 'administrator', organizationId }
    : { kind: 'customer', customerAccountId };
}

export async function registerQuickOrderPreferenceRoutes(
  app: FastifyInstance,
  deps: QuickOrderPreferenceRoutesDeps,
): Promise<void> {
  const { service, customerAccounts, requireCustomer, resolveCustomerContext } = deps;

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
    const actor = await resolveActor(request, deps);

    const targetCustomerOrgId =
      scope === 'customer'
        ? ((await customerAccounts.findById(scopeId))?.organizationId ?? null)
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
      const actor = await resolveActor(request, deps);
      const result = await service.upsert(actor, body, {
        customerAccountId: ctx.customerAccountId,
      });
      return { data: result };
    },
  );
}
