import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  adminOrderPaymentStatusTransitionSchema,
  adminOrderStatusTransitionSchema,
  ERROR_CODES,
  placeOrderRequestSchema,
} from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '../../http/error-envelope.js';
import type { OrderService } from './services/order-service.js';
import { Order } from './entities/order.entity.js';
import { OrderItem } from './entities/order-item.entity.js';
import { Invoice } from '../invoices/entities/invoice.entity.js';
import { Asset } from '../assets/entities/asset.entity.js';
import { buildMinimalInvoicePdf } from '../invoices/services/invoice-pdf.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

export interface OrdersDeps {
  orderService: OrderService;
  emFactory: () => EntityManager;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  requireAdmin: RequireAdminFactory;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
    impersonatorAdminUserId?: string | null;
  };
}

export async function registerOrderRoutes(
  app: FastifyInstance,
  deps: OrdersDeps,
): Promise<void> {
  const { orderService, emFactory, requireCustomer, requireAdmin, resolveCustomerContext } = deps;

  // --- Customer surface -------------------------------------------------
  app.post(
    '/api/v1/orders',
    { preHandler: requireCustomer, schema: { body: placeOrderRequestSchema } },
    async (request, reply) => {
      const body = placeOrderRequestSchema.parse(request.body);
      const ctx = resolveCustomerContext(request);
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
    async () => {
      const orders = await orderService.listAll();
      const em = emFactory();
      return {
        data: await Promise.all(orders.map((o) => serializeOrder(em, o))),
        pagination: { cursor: null, hasMore: false, limit: 50 },
      };
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
      const order = await orderService.transitionStatus(request.params.id, body.to);
      return { data: await serializeOrder(emFactory(), order) };
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

async function serializeOrder(em: EntityManager, order: Order): Promise<Record<string, unknown>> {
  const items = await em.find(OrderItem, { orderId: order.id });
  return {
    id: order.id,
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
    nextAction: { kind: 'awaiting_transfer' as const },
  };
}
