import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { OrganizationContextService } from './services/organization-context-service.js';
import type {
  OrganizationRestrictionService,
} from './services/organization-restriction-service.js';

export interface OrganizationsStorefrontDeps {
  contextService: OrganizationContextService;
  restrictionService: OrganizationRestrictionService;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    /** Null for no-org Customer accounts (feature 026 US2). */
    organizationId: string | null;
  };
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
}

/**
 * Storefront-side organization endpoints introduced by feature 026 US4.
 *
 *   POST /api/v1/storefront/checkout/preflight
 *     Called by the checkout SSR route. Returns 200 with the resolved
 *     payment + delivery method allow-list IDs and assigned warehouse IDs
 *     when the Customer's Organization is active; 423 with status +
 *     localized reason when it cannot transact; 200 with empty allow-lists
 *     for no-org Customer accounts (they get the platform defaults).
 */
export async function registerOrganizationsStorefrontRoutes(
  app: FastifyInstance,
  deps: OrganizationsStorefrontDeps,
): Promise<void> {
  app.post(
    '/api/v1/storefront/checkout/preflight',
    { preHandler: deps.requireCustomer },
    async (request, reply) => {
      const ctx = deps.resolveCustomerContext(request);

      if (!ctx.organizationId) {
        // No-org Customer — platform defaults apply (feature 026 US2).
        reply.status(200);
        return {
          canTransact: true,
          allowedPaymentMethodIds: [],
          allowedDeliveryMethodIds: [],
          assignedWarehouseIds: [],
        };
      }

      const org = await deps.contextService.loadEffectiveOrganization(ctx.organizationId);
      if (!org) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
      }

      if (org.status !== 'active') {
        reply.status(423);
        return {
          canTransact: false,
          status: org.status,
          reason: describeStatus(org.status),
        };
      }

      const allowLists = await deps.restrictionService.readAllowLists(org.id);
      reply.status(200);
      return {
        canTransact: true,
        allowedPaymentMethodIds: allowLists.paymentMethodIds,
        allowedDeliveryMethodIds: allowLists.deliveryMethodIds,
        assignedWarehouseIds: allowLists.warehouseIds,
      };
    },
  );
}

/**
 * Customer-safe localization of the moderation status. The storefront
 * displays this string verbatim; admin-only details (block-reason text)
 * are intentionally NOT exposed here.
 */
function describeStatus(
  status: 'pending_verification' | 'blocked' | 'rejected' | string,
): string {
  switch (status) {
    case 'pending_verification':
      return 'Twoja Organizacja oczekuje na weryfikację. Zamówienia będą dostępne po jej zakończeniu.';
    case 'blocked':
      return 'Składanie Zamówień jest obecnie wstrzymane. Prosimy o kontakt z opiekunem konta.';
    case 'rejected':
      return 'Rejestracja Twojej Organizacji została odrzucona. Prosimy o kontakt z administracją platformy.';
    default:
      return 'Składanie Zamówień obecnie niedostępne.';
  }
}
