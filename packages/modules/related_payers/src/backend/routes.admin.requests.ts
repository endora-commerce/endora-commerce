import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ERROR_CODES,
  adminAssignRelatedPayerOrganizationBodySchema,
  adminCreateRequestOrganizationBodySchema,
  adminRejectRelatedPayerRequestBodySchema,
  adminRelatedPayerRequestsQuerySchema,
  isUuidShape,
  type OrganizationWritePort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { RelatedPayerRequestService } from './services/request-service.js';
import type { RelatedPayerInvitationDelivery } from './services/invitation-delivery.js';

export interface RelatedPayersRequestAdminRouteDeps {
  readonly requireAdmin: RequireAdminFactory;
  readonly requests: () => RelatedPayerRequestService;
  readonly invitations: () => RelatedPayerInvitationDelivery;
  readonly organizationWrites: Pick<OrganizationWritePort, 'create'>;
  readonly resolveAdminUserId: (request: FastifyRequest) => string;
}

/**
 * `specs/182-related-payers/` T082 (FR-023, `contracts/admin-api.md`) — the operator queue of
 * payer requests: list with the reason each waits, approve, reject with a reason the sender reads;
 * and, for a request whose Organization is not settled (US5, T090), assign one its tax ID matches,
 * create it, or send the contact an invitation to register.
 * Mounted through `ctx.routes`, so the module's presence gates every route.
 */
export async function registerRelatedPayersRequestAdminRoutes(
  app: FastifyInstance,
  deps: RelatedPayersRequestAdminRouteDeps,
): Promise<void> {
  const { requireAdmin } = deps;
  const idOf = (request: FastifyRequest): string => {
    const id = (request.params as { id: string }).id;
    if (!isUuidShape(id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Request not found.');
    return id;
  };

  app.get(
    '/api/v1/admin/related-payers/requests',
    { preHandler: requireAdmin('related_payers:read'), schema: { querystring: adminRelatedPayerRequestsQuerySchema } },
    async (request) => {
      const query = adminRelatedPayerRequestsQuerySchema.parse(request.query ?? {});
      return { data: await deps.requests().listQueue(query) };
    },
  );

  app.post(
    '/api/v1/admin/related-payers/requests/:id/approve',
    { preHandler: requireAdmin('related_payers:manage') },
    async (request) => {
      const id = idOf(request);
      await deps.requests().operatorApprove(deps.resolveAdminUserId(request), id);
      return { data: { id, state: 'active' } };
    },
  );

  app.post(
    '/api/v1/admin/related-payers/requests/:id/reject',
    { preHandler: requireAdmin('related_payers:manage'), schema: { body: adminRejectRelatedPayerRequestBodySchema } },
    async (request) => {
      const id = idOf(request);
      const body = adminRejectRelatedPayerRequestBodySchema.parse(request.body ?? {});
      await deps.requests().operatorReject(deps.resolveAdminUserId(request), id, body.reason);
      return { data: { id, state: 'rejected' } };
    },
  );

  // FR-023, T087 — the operator names the Organization an unresolved request means.
  app.post(
    '/api/v1/admin/related-payers/requests/:id/assign-organization',
    { preHandler: requireAdmin('related_payers:manage'), schema: { body: adminAssignRelatedPayerOrganizationBodySchema } },
    async (request) => {
      const id = idOf(request);
      const body = adminAssignRelatedPayerOrganizationBodySchema.parse(request.body);
      await deps.requests().operatorAssign(id, body.organizationId);
      return { data: { id, state: 'pending' } };
    },
  );

  // FR-023, US5-2 — the counterparty has no account: create it, approved, and link it.
  app.post(
    '/api/v1/admin/related-payers/requests/:id/create-organization',
    {
      // Creating the Organization is the organization create, whose own gate is
      // `customers:manage` (`POST /api/v1/admin/organizations`); both are required.
      preHandler: [requireAdmin('related_payers:manage'), requireAdmin('customers:manage')],
      schema: { body: adminCreateRequestOrganizationBodySchema },
    },
    async (request, reply) => {
      const id = idOf(request);
      const { organization } = adminCreateRequestOrganizationBodySchema.parse(request.body);
      const [first, ...rest] = organization.salesChannelIds;
      const created = await deps.requests().operatorCreateOrganization(deps.resolveAdminUserId(request), id, organization.taxId, () =>
        deps.organizationWrites.create({
          name: organization.name,
          taxId: organization.taxId,
          registeredAddress: organization.registeredAddress,
          salesChannelIds: [first!, ...rest],
          status: 'active',
          ...(organization.vatStatus ? { vatStatus: organization.vatStatus } : {}),
        }),
      );
      reply.status(201);
      return { data: { id, state: 'active', ...created } };
    },
  );

  // FR-044, US5-2 — invite the contact e-mail to register, the tax ID pre-filled.
  app.post(
    '/api/v1/admin/related-payers/requests/:id/send-invitation',
    { preHandler: requireAdmin('related_payers:manage') },
    async (request) => {
      const id = idOf(request);
      // Only a pending entry of the queue with no Organization: anything else is not found here.
      await deps.requests().assertUnresolved(id);
      await deps.invitations().send(id, 'operator');
      return { data: { id, state: 'pending' } };
    },
  );
}
