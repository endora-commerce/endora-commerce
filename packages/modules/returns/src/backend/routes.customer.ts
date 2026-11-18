import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getResolvedChannel } from '@endora-commerce/platform/kernel';
import { productAudienceOf } from '@endora-commerce/platform/http';
import {
  returnFormConfigQuerySchema,
  type ReturnFormConfig,
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
import { sendAttachment } from './attachment-response.js';
import { registerReturnsUploadRoutes } from './routes.uploads.js';

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
  /** What the returns form needs for a channel and language (180 §C1). */
  formConfig: (input: {
    salesChannelId: string;
    language: string;
    kind: 'return' | 'complaint';
    orderId: string | undefined;
    customer: ReturnCustomerContext;
  }) => Promise<ReturnFormConfig>;
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

  // 180 §C1 (research R-21) — the channel and the language are the request's.
  app.get('/api/v1/returns/form-config', { preHandler: requireCustomer, schema: { querystring: returnFormConfigQuerySchema } }, async (request) => {
    const query = returnFormConfigQuerySchema.parse(request.query);
    const data = await deps.formConfig({
      salesChannelId: getResolvedChannel(request).id,
      language: await request.responseLanguage(),
      kind: query.kind ?? 'complaint',
      orderId: query.orderId,
      customer: customerContextOf(request, resolveCustomerAccountId),
    });
    return { data };
  });

  app.get('/api/v1/returns', { preHandler: requireCustomer }, async (request) => {
    // The status label is in the request's language, as every customer read here is.
    const data = await caseService.listForCustomer(
      customerContextOf(request, resolveCustomerAccountId),
      await request.responseLanguage(),
    );
    return { data };
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/returns/:id',
    { preHandler: requireCustomer },
    async (request) => {
      const data = await caseService.getForCustomer(
        request.params.id,
        customerContextOf(request, resolveCustomerAccountId),
        await request.responseLanguage(),
      );
      return { data };
    },
  );

  app.post(
    '/api/v1/returns',
    { preHandler: createsReturns, schema: { body: createReturnCaseRequestSchema } },
    async (request, reply) => {
      const body = createReturnCaseRequestSchema.parse(request.body);
      // The channel, the language and the audience are the request's, never the
      // body's (180 Principles XI, XII; customer-api.md §C3).
      const channel = getResolvedChannel(request);
      const filed = await caseService.createCase(body, customerContextOf(request, resolveCustomerAccountId), {
        channel: { id: channel.id, defaultCurrency: channel.defaultCurrency },
        language: await request.responseLanguage(),
        audience: productAudienceOf(request),
      });
      // A repeated submission key answers the case already filed (research R-18).
      reply.status(filed.created ? 201 : 200);
      return { data: filed.detail };
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
      const data = await caseService.cancelByCustomer(request.params.id, customerAccountId, await request.responseLanguage());
      return { data };
    },
  );

  // --- Attachments (`specs/180-off-platform-complaints/` §C2, §C4, §C5) -------
  await registerReturnsUploadRoutes(app, {
    attachmentService,
    requireCustomer,
    createsReturns,
    customerContextOf: (request) => customerContextOf(request, resolveCustomerAccountId),
  });

  app.get<{ Params: { id: string; attachmentId: string } }>(
    '/api/v1/returns/:id/attachments/:attachmentId/file',
    { preHandler: requireCustomer },
    async (request, reply) => {
      const served = await attachmentService.openForCustomer(
        request.params.id,
        request.params.attachmentId,
        customerContextOf(request, resolveCustomerAccountId),
      );
      return sendAttachment(reply, served, { inlineImages: false });
    },
  );
}
