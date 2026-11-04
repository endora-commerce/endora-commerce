import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  addReturnAttachmentRequestSchema,
  createReturnCaseRequestSchema,
  customerAddCommentRequestSchema,
  organizationPermissionPreHandler,
  selectReturnDeliveryMethodRequestSchema,
  type OrganizationPermissionGuardRequest,
  type OrganizationPermissionPort,
} from '@endora-commerce/contracts';
import type { ReturnCustomerContext } from './services/return-case-scope.js';
import type { ReturnCaseService } from './services/return-case-service.js';
import type { ReturnCommentService } from './services/return-comment-service.js';
import type { ReturnDeliveryMethodService } from './services/return-delivery-method-service.js';
import type { ReturnReasonService } from './services/return-reason-service.js';
import type { ReturnAttachmentService } from './services/return-attachment-service.js';

/**
 * The organization permission that opens a return or a complaint
 * (`specs/170-organization-roles/` FR-052, OR-11). Declared in this module's
 * manifest; *Member* holds it by default.
 */
const RETURNS_CREATE = 'returns.create';

/**
 * Returns customer (storefront) routes — feature 046 (US1, US4, US6). All
 * endpoints require an authenticated customer.
 *
 * Since `specs/170-organization-roles/` (OR-11, research R-41) the buyer's
 * reach follows their organization role:
 *
 *   - `POST /api/v1/returns` needs `returns.create`, judged by a pre-handler
 *     before the body reaches the handler — so before any order is read
 *     (FR-052) — and then the order must be one the buyer may read, which is
 *     `orders`' rule (FR-054);
 *   - `GET /api/v1/orders/:orderId/returnable` is a read and needs no code; the
 *     order is judged the same way;
 *   - `GET /api/v1/returns` and `GET /api/v1/returns/:id` answer the buyer's
 *     own cases, or the Organization's with `returns.view_organization`
 *     (FR-053, `ReturnCaseScope`);
 *   - the follow-up actions — comments, attachments, the delivery method,
 *     cancelling — stay the filer's, keyed on `customer_account_id` in their
 *     services, and need no code (FR-052, Q-R2 = A).
 */
export interface ReturnsCustomerRoutesDeps {
  caseService: ReturnCaseService;
  commentService: ReturnCommentService;
  deliveryMethodService: ReturnDeliveryMethodService;
  reasonService: ReturnReasonService;
  attachmentService: ReturnAttachmentService;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerAccountId: (req: FastifyRequest) => string;
  /** `organizations`' permission port, read per request through this thunk. */
  organizationPermissions: () => OrganizationPermissionPort;
}

/**
 * The buyer as the case service judges them: the account the composition
 * resolves, and the Organization and role the request's customer actor
 * carries (`organizationRoleId` saves the port a read, research R-15).
 *
 * `request.actor` is `@endora-commerce/platform/http`'s declaration-merging
 * augmentation, read structurally here as `organizationPermissionPreHandler`
 * reads it.
 */
function customerContextOf(
  request: FastifyRequest,
  resolveCustomerAccountId: (req: FastifyRequest) => string,
): ReturnCustomerContext {
  const customerAccountId = resolveCustomerAccountId(request);
  const actor = (request as unknown as Partial<OrganizationPermissionGuardRequest>).actor;
  if (actor?.kind !== 'customer') return { customerAccountId, organizationId: null, organizationRoleId: null };
  return {
    customerAccountId,
    organizationId: actor.organizationId || null,
    organizationRoleId: actor.organizationRoleId ?? null,
  };
}

export async function registerReturnsCustomerRoutes(
  app: FastifyInstance,
  deps: ReturnsCustomerRoutesDeps,
): Promise<void> {
  const {
    caseService,
    commentService,
    deliveryMethodService,
    reasonService,
    attachmentService,
    requireCustomer,
    resolveCustomerAccountId,
  } = deps;
  const requireReturnsCreate = organizationPermissionPreHandler(deps.organizationPermissions, RETURNS_CREATE);
  const createsReturns = [
    requireCustomer,
    (request: FastifyRequest) => requireReturnsCreate(request as unknown as OrganizationPermissionGuardRequest),
  ];

  app.get<{ Querystring: { kind?: 'return' | 'complaint' } }>(
    '/api/v1/returns/reasons',
    { preHandler: requireCustomer },
    async (request) => {
      const data = await reasonService.listActive(request.query.kind);
      return { data };
    },
  );

  app.get<{ Params: { orderId: string } }>(
    '/api/v1/orders/:orderId/returnable',
    { preHandler: requireCustomer },
    async (request) => {
      const data = await caseService.getReturnable(
        request.params.orderId,
        customerContextOf(request, resolveCustomerAccountId),
      );
      return { data };
    },
  );

  app.get('/api/v1/returns', { preHandler: requireCustomer }, async (request) => {
    const data = await caseService.listForCustomer(customerContextOf(request, resolveCustomerAccountId));
    return { data };
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/returns/:id',
    { preHandler: requireCustomer },
    async (request) => {
      const data = await caseService.getForCustomer(
        request.params.id,
        customerContextOf(request, resolveCustomerAccountId),
      );
      return { data };
    },
  );

  app.post(
    '/api/v1/returns',
    { preHandler: createsReturns, schema: { body: createReturnCaseRequestSchema } },
    async (request, reply) => {
      const body = createReturnCaseRequestSchema.parse(request.body);
      const data = await caseService.createCase(body, customerContextOf(request, resolveCustomerAccountId));
      reply.status(201);
      return { data };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/returns/:id/comments',
    { preHandler: requireCustomer, schema: { body: customerAddCommentRequestSchema } },
    async (request, reply) => {
      const customerAccountId = resolveCustomerAccountId(request);
      const body = customerAddCommentRequestSchema.parse(request.body);
      const data = await commentService.addByCustomer(request.params.id, customerAccountId, body);
      reply.status(201);
      return { data };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/returns/:id/select-delivery-method',
    { preHandler: requireCustomer, schema: { body: selectReturnDeliveryMethodRequestSchema } },
    async (request) => {
      const customerAccountId = resolveCustomerAccountId(request);
      const body = selectReturnDeliveryMethodRequestSchema.parse(request.body);
      const data = await deliveryMethodService.selectForCase(
        request.params.id,
        customerAccountId,
        body.returnDeliveryMethodId,
      );
      return { data };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/returns/:id/cancel',
    { preHandler: requireCustomer },
    async (request) => {
      const customerAccountId = resolveCustomerAccountId(request);
      const data = await caseService.cancelByCustomer(request.params.id, customerAccountId);
      return { data };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/returns/:id/attachments',
    { preHandler: requireCustomer, schema: { body: addReturnAttachmentRequestSchema } },
    async (request, reply) => {
      const customerAccountId = resolveCustomerAccountId(request);
      const body = addReturnAttachmentRequestSchema.parse(request.body);
      const data = await attachmentService.addToCase(request.params.id, customerAccountId, body);
      reply.status(201);
      return { data };
    },
  );
}
