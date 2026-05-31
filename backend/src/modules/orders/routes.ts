import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  adminOrderPaymentStatusTransitionSchema,
  adminOrderStatusTransitionSchema,
  createOrderStatusRequestSchema,
  ERROR_CODES,
  placeOrderRequestSchema,
  setOrderTransitionsRequestSchema,
  updateOrderStatusRequestSchema,
} from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '../../http/error-envelope.js';
import type { OrderService } from './services/order-service.js';
import type { OrderStatusGraphService } from './services/order-status-graph-service.js';
import type { OrderTransitionService } from './services/order-transition-service.js';
import { Order } from './entities/order.entity.js';
import { OrderItem } from './entities/order-item.entity.js';
import { Invoice } from '../invoices/entities/invoice.entity.js';
import { Asset } from '../assets_library/entities/asset.entity.js';
import { buildMinimalInvoicePdf } from '../invoices/services/invoice-pdf.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import { OrganizationCannotTransactError } from '../organizations/services/organization-context-service.js';

export interface OrdersDeps {
  orderService: OrderService;
  /** Feature 038 — configurable lifecycle: status-graph CRUD + transition engine. */
  orderStatusGraphService: OrderStatusGraphService;
  orderTransitionService: OrderTransitionService;
  emFactory: () => EntityManager;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  requireAdmin: RequireAdminFactory;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
    impersonatorAdminUserId?: string | null;
  };
  /**
   * Optional gate — when provided, refuses to place an order when the
   * Customer's Organization is not `active`. Feature 026 US1 / US3.
   */
  assertOrganizationCanTransact?: (organizationId: string) => Promise<void>;
  /**
   * Feature 026 US6 — resolves admin visibility scope for the orders list.
   * `{ allowAll: true }` ⇒ platform admin (no filter); otherwise the list
   * is intersected with `allowedOrganizationIds` (sales-rep ownership).
   */
  resolveAdminOrdersScope?: (req: FastifyRequest) => Promise<
    | { allowAll: true }
    | { allowAll: false; allowedOrganizationIds: string[] }
  >;
}

export async function registerOrderRoutes(
  app: FastifyInstance,
  deps: OrdersDeps,
): Promise<void> {
  const { orderService, emFactory, requireCustomer, requireAdmin, resolveCustomerContext } = deps;
  const { assertOrganizationCanTransact } = deps;

  // --- Customer surface -------------------------------------------------
  app.post(
    '/api/v1/orders',
    { preHandler: requireCustomer, schema: { body: placeOrderRequestSchema } },
    async (request, reply) => {
      const body = placeOrderRequestSchema.parse(request.body);
      const ctx = resolveCustomerContext(request);
      if (assertOrganizationCanTransact) {
        try {
          await assertOrganizationCanTransact(ctx.organizationId);
        } catch (err) {
          if (err instanceof OrganizationCannotTransactError) {
            throw new HttpError(
              423,
              ERROR_CODES.FORBIDDEN,
              'Your Organization cannot transact in its current status.',
              { code: 'organization_cannot_transact', status: err.status },
            );
          }
          throw err;
        }
      }
      const order = await orderService.placeOrder(ctx, body);
      reply.status(201);
      return { data: await serializeOrder(emFactory(), order) };
    },
  );

  app.get('/api/v1/orders', { preHandler: requireCustomer }, async (request) => {
    const ctx = resolveCustomerContext(request);
    const orders = await orderService.listForCustomer(ctx);
    const em = emFactory();
    return {
      data: await Promise.all(orders.map((o) => serializeOrder(em, o))),
      pagination: { cursor: null, hasMore: false, limit: 50 },
    };
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/orders/:id',
    { preHandler: requireCustomer },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      const order = await orderService.getById(request.params.id, ctx);
      return { data: await serializeOrder(emFactory(), order) };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/orders/:id/invoice',
    { preHandler: requireCustomer },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      const order = await orderService.getById(request.params.id, ctx);
      const em = emFactory();
      const invoice = await em.findOne(Invoice, { orderId: order.id }, { orderBy: { createdAt: 'desc' } });
      if (!invoice || invoice.status !== 'ready') {
        throw new HttpError(
          404,
          ERROR_CODES.INVOICE_NOT_READY,
          'Invoice is not ready yet.',
        );
      }
      let pdfBytes: Buffer | null = null;
      if (invoice.pdfAssetId) {
        const asset = await em.findOne(Asset, { id: invoice.pdfAssetId });
        if (asset?.storageUrl.startsWith('data:application/pdf;base64,')) {
          pdfBytes = Buffer.from(
            asset.storageUrl.slice('data:application/pdf;base64,'.length),
            'base64',
          );
        }
      }
      if (!pdfBytes) {
        pdfBytes = buildMinimalInvoicePdf({
          invoiceNumber: invoice.number,
          total: invoice.total,
          currency: invoice.currency,
        });
      }
      reply.header('content-type', 'application/pdf');
      reply.header(
        'content-disposition',
        `attachment; filename="${invoice.number.replace(/[/\\]/g, '-')}.pdf"`,
      );
      return reply.send(pdfBytes);
    },
  );

  // --- Admin surface ----------------------------------------------------
  app.get(
    '/api/v1/admin/orders',
    { preHandler: requireAdmin('orders:read') },
    async (request) => {
      let orders = await orderService.listAll();
      // Feature 026 US6 — sales-rep scope: filter to orgs the rep owns.
      if (deps.resolveAdminOrdersScope) {
        const scope = await deps.resolveAdminOrdersScope(request);
        if (!scope.allowAll) {
          const allowed = new Set(scope.allowedOrganizationIds);
          orders = orders.filter((o) => allowed.has(o.organizationId));
        }
      }
      const em = emFactory();
      return {
        data: await Promise.all(orders.map((o) => serializeOrder(em, o))),
        pagination: { cursor: null, hasMore: false, limit: 50 },
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/orders/:id',
    { preHandler: requireAdmin('orders:read') },
    async (request) => {
      const em = emFactory();
      const order = await em.findOne(Order, { id: request.params.id });
      if (!order) {
        throw new HttpError(404, ERROR_CODES.ORDER_NOT_FOUND, 'Order not found.');
      }
      return { data: await serializeOrder(em, order) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/orders/:id/status',
    {
      preHandler: requireAdmin('orders:write'),
      schema: { body: adminOrderStatusTransitionSchema },
    },
    async (request) => {
      const body = adminOrderStatusTransitionSchema.parse(request.body);
      const adminUserId = resolveAdminUserId(request);
      const order = await deps.orderTransitionService.apply(
        request.params.id,
        body.to,
        adminUserId ? { kind: 'admin', adminUserId } : { kind: 'system', source: 'checkout' },
        body.reason ?? null,
      );
      return { data: await serializeOrder(emFactory(), order) };
    },
  );

  // --- Configurable lifecycle: status graph CRUD (feature 038 US1) -------
  app.get(
    '/api/v1/admin/orders/statuses',
    { preHandler: requireAdmin('orders:read') },
    async () => {
      const graph = await deps.orderStatusGraphService.listGraph();
      return {
        data: {
          statuses: graph.statuses.map((s) => ({
            code: s.code,
            name: s.name,
            isInitial: s.isInitial,
            isTerminal: s.isTerminal,
            isSystem: s.isSystem,
            weight: s.weight,
            inUseCount: s.inUseCount,
          })),
          transitions: graph.transitions.map((t) => ({
            fromStatusCode: t.fromStatusCode,
            toStatusCode: t.toStatusCode,
            isSystem: t.isSystem,
          })),
        },
      };
    },
  );

  app.post(
    '/api/v1/admin/orders/statuses',
    { preHandler: requireAdmin('orders:write'), schema: { body: createOrderStatusRequestSchema } },
    async (request, reply) => {
      const body = createOrderStatusRequestSchema.parse(request.body);
      await deps.orderStatusGraphService.createStatus(body);
      reply.code(201);
      return { data: { code: body.code } };
    },
  );

  app.patch<{ Params: { code: string } }>(
    '/api/v1/admin/orders/statuses/:code',
    { preHandler: requireAdmin('orders:write'), schema: { body: updateOrderStatusRequestSchema } },
    async (request) => {
      const body = updateOrderStatusRequestSchema.parse(request.body);
      await deps.orderStatusGraphService.updateStatus(request.params.code, body);
      return { data: { code: request.params.code } };
    },
  );

  app.delete<{ Params: { code: string } }>(
    '/api/v1/admin/orders/statuses/:code',
    { preHandler: requireAdmin('orders:write') },
    async (request) => {
      await deps.orderStatusGraphService.deleteStatus(request.params.code);
      return { data: { deleted: request.params.code } };
    },
  );

  app.put(
    '/api/v1/admin/orders/transitions',
    { preHandler: requireAdmin('orders:write'), schema: { body: setOrderTransitionsRequestSchema } },
    async (request) => {
      const body = setOrderTransitionsRequestSchema.parse(request.body);
      await deps.orderStatusGraphService.setTransitions(body);
      const graph = await deps.orderStatusGraphService.listGraph();
      return { data: { transitions: graph.transitions } };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/orders/:id/payment-status',
    {
      preHandler: requireAdmin('orders:write'),
      schema: { body: adminOrderPaymentStatusTransitionSchema },
    },
    async (request) => {
      const body = adminOrderPaymentStatusTransitionSchema.parse(request.body);
      const order = await orderService.transitionPaymentStatus(request.params.id, body.to);
      return { data: await serializeOrder(emFactory(), order) };
    },
  );
}

/** Resolve the acting admin user id from the production or test actor. */
function resolveAdminUserId(req: FastifyRequest): string | null {
  const prodActor = (req as { actor?: { kind?: string; adminUserId?: string } }).actor;
  if (prodActor?.kind === 'admin' && prodActor.adminUserId) return prodActor.adminUserId;
  const testActor = (req as { testActor?: { kind?: string; adminUserId?: string } }).testActor;
  if (testActor?.kind === 'admin' && testActor.adminUserId) return testActor.adminUserId;
  return null;
}

async function serializeOrder(em: EntityManager, order: Order): Promise<Record<string, unknown>> {
  const items = await em.find(OrderItem, { orderId: order.id });
  return {
    id: order.id,
    businessId: order.businessId,
    organizationId: order.organizationId,
    placedByCustomerAccountId: order.placedByCustomerAccountId,
    placedOnBehalfByAdminUserId: order.placedOnBehalfByAdminUserId ?? null,
    salesChannelId: order.salesChannelId,
    status: order.status,
    paymentStatus: order.paymentStatus,
    deliveryAddress: order.deliveryAddress,
    billingAddress: order.billingAddress,
    deliveryMethod: {
      id: order.deliveryMethodId,
      code: order.deliveryMethodSnapshot.code,
      name: order.deliveryMethodSnapshot.name,
      cost: order.deliveryMethodSnapshot.cost,
    },
    paymentMethod: {
      id: order.paymentMethodId,
      code: order.paymentMethodSnapshot.code,
      name: order.paymentMethodSnapshot.name,
      kind: order.paymentMethodSnapshot.kind,
    },
    sourceQuoteRequestId: order.sourceQuoteRequestId ?? null,
    items: items.map((it) => ({
      id: it.id,
      productId: it.productId,
      productSnapshot: it.productSnapshot,
      variantId: it.variantId ?? null,
      variantSnapshot: it.variantSnapshot ?? null,
      quantity: it.quantity,
      unitPrice: Number(it.unitPrice),
      taxRate: Number(it.taxRate),
      lineTotal: Number(it.lineTotal),
    })),
    subtotal: Number(order.subtotal),
    taxTotal: Number(order.taxTotal),
    discountTotal: Number(order.discountTotal),
    deliveryTotal: Number(order.deliveryTotal),
    total: Number(order.total),
    currency: order.currency,
    customerNote: order.customerNote ?? null,
    placedAt: order.placedAt.toISOString(),
    // Feature 036 — real payment next-action captured at placement (transfer
    // details / gateway redirect / none). Order reads (GET/list) load it as
    // undefined → null.
    nextAction: order.nextAction ?? null,
  };
}
