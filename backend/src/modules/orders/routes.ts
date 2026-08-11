import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  adminAddOrderCommentRequestSchema,
  adminCreateOrderRequestSchema,
  adminOrderPaymentStatusTransitionSchema,
  adminOrderPreviewRequestSchema,
  adminOrdersListQuerySchema,
  adminOrderStatusTransitionSchema,
  bulkOrderStatusRequestSchema,
  bulkPrintInvoicesRequestSchema,
  createOrderSavedViewRequestSchema,
  createOrderStatusRequestSchema,
  customFieldValuesSchema,
  customerAddOrderCommentRequestSchema,
  ERROR_CODES,
  orderPreviewTotalRequestSchema,
  placeOrderRequestSchema,
  setOrderTransitionsRequestSchema,
  updateOrderSavedViewRequestSchema,
  updateOrderStatusRequestSchema,
} from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '../../http/error-envelope.js';
import type { Command, CommandBus } from '../../commands/index.js';
import {
  CustomFieldValidationError,
  type CustomFieldValueService,
} from '../custom_fields/services/custom-field-value.service.js';
import type { OrderService } from './services/order-service.js';
import type { OrderStatusGraphService } from './services/order-status-graph-service.js';
import { OrderStatus } from './entities/order-status.entity.js';
import type { OrderTransitionService } from './services/order-transition-service.js';
import type { OrderListService, OrderListScope } from './services/order-list-service.js';
import type { OrderListViewService } from './services/order-list-view-service.js';
import type { OrderExportService } from './services/order-export-service.js';
import type { OrderCommentService } from './services/order-comment-service.js';
import type { OrderComment } from './entities/order-comment.entity.js';
import type { OrderReorderService } from './services/order-reorder-service.js';
import type { OrderCloneToQuoteService } from './services/order-clone-to-quote-service.js';
import type { OrderCreationAdminService } from './services/order-creation-admin-service.js';
import { Order } from './entities/order.entity.js';
import { OrderItem } from './entities/order-item.entity.js';
import { OrderAppliedPromotion } from './entities/order-applied-promotion.entity.js';
import { Invoice } from '../invoices/entities/invoice.entity.js';
import { Asset } from '../assets_library/entities/asset.entity.js';
import { buildBulkInvoicesPdf, buildMinimalInvoicePdf } from '../invoices/services/invoice-pdf.js';
import { OrganizationCannotTransactError } from '../organizations/services/organization-context-service.js';
import type { PricingService } from '../price_lists/services/pricing-service.js';
import { Product } from '../catalog/entities/product.entity.js';
import { Organization } from '../organizations/entities/organization.entity.js';
import { SalesChannel } from '../../kernel/sales-channels/sales-channel.entity.js';
import { DeliveryMethod } from '../delivery_methods/entities/delivery-method.entity.js';
import { PaymentMethod } from '../payment_methods/entities/payment-method.entity.js';
import { CustomerAccount } from '../customer_accounts/entities/customer-account.entity.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

export interface OrdersDeps {
  orderService: OrderService;
  /** Feature 038 — configurable lifecycle: status-graph CRUD + transition engine. */
  orderStatusGraphService: OrderStatusGraphService;
  orderTransitionService: OrderTransitionService;
  /** Feature 038 US2 — orders list query, saved views, CSV export. */
  orderListService: OrderListService;
  orderListViewService: OrderListViewService;
  orderExportService: OrderExportService;
  /** Feature 038 US5 — order comments. */
  orderCommentService: OrderCommentService;
  /** Feature 038 US6 — reorder. */
  orderReorderService: OrderReorderService;
  /** Feature 038 US7 — clone an order into a Quote Request. */
  orderCloneToQuoteService: OrderCloneToQuoteService;
  /** Feature 038 US3 — create an order on behalf of a customer. */
  orderCreationAdminService: OrderCreationAdminService;
  /**
   * Feature 038 US3 — pricing engine, used by the read-only create-order
   * preview to resolve per-line prices for the chosen customer/channel. When
   * absent the preview endpoint returns a graceful zeroed summary.
   */
  pricingService?: PricingService;
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
  /** Feature 055 — validates + persists Order custom-field values (via the Command Bus). */
  customFieldValues?: CustomFieldValueService;
  /** Feature 055 — audits the custom-field write co-transactionally when provided. */
  commandBus?: CommandBus;
}

export async function registerOrderRoutes(
  app: FastifyInstance,
  deps: OrdersDeps,
): Promise<void> {
  const { orderService, emFactory, requireCustomer, requireAdmin, resolveCustomerContext } = deps;
  const { assertOrganizationCanTransact } = deps;
  const customFieldValues = deps.customFieldValues;
  const commandBus = deps.commandBus;

  // --- Custom fields (feature 055) -------------------------------------
  // Narrow admin write for Order custom-field values. The write runs through
  // the Command Bus (audited by construction, Principle XIII); validation may
  // reject with a per-field 422. Only mounted when both deps are provided.
  if (customFieldValues && commandBus) {
    app.patch<{ Params: { id: string } }>(
      '/api/v1/admin/orders/:id/custom-fields',
      { preHandler: requireAdmin('orders:write'), schema: { body: customFieldValuesSchema } },
      async (request) => {
        const patch = customFieldValuesSchema.parse(request.body);
        const orderId = request.params.id;
        const command: Command<Order> = {
          action: 'order.custom_fields.update',
          objectType: 'order',
          objectId: orderId,
          capture: async ({ em }) => {
            const o = await em.findOne(Order, { id: orderId });
            return o ? { customFieldValues: o.customFieldValues ?? {} } : null;
          },
          run: async ({ em }) => {
            const order = await em.findOne(Order, { id: orderId });
            if (!order) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Order not found.');
            order.customFieldValues = await customFieldValues.validateAndMerge(
              'order',
              order.customFieldValues ?? {},
              patch,
            );
            return { result: order, after: { customFieldValues: order.customFieldValues } };
          },
        };
        try {
          const order = await commandBus.run(command);
          return { data: await serializeOrder(emFactory(), order) };
        } catch (err) {
          if (err instanceof CustomFieldValidationError) {
            throw new HttpError(
              422,
              ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID,
              'One or more custom fields are invalid.',
              err.errors.map((e) => ({ path: e.field, issue: e.message })),
            );
          }
          throw err;
        }
      },
    );
  }

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

  // Read-only total preview for the active cart + chosen methods (feature 049).
  // The exact amount (incl. per-product VAT) is computed server-side so the
  // storefront can display it — e.g. for the inline Stripe Payment Element —
  // without re-deriving any pricing on the client.
  app.post(
    '/api/v1/orders/preview-total',
    { preHandler: requireCustomer, schema: { body: orderPreviewTotalRequestSchema } },
    async (request) => {
      const body = orderPreviewTotalRequestSchema.parse(request.body);
      const ctx = resolveCustomerContext(request);
      const totals = await orderService.previewTotal(ctx, body);
      return { data: totals };
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
    { preHandler: requireCustomer, config: { streamingResponse: true } },
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

  // Resolve the sales-rep org scope (feature 026 US6). `null` ⇒ no scoping
  // (platform admin sees all).
  const resolveListScope = async (request: FastifyRequest): Promise<OrderListScope | undefined> => {
    if (!deps.resolveAdminOrdersScope) return undefined;
    const scope = await deps.resolveAdminOrdersScope(request);
    return scope.allowAll ? undefined : { allowedOrganizationIds: scope.allowedOrganizationIds };
  };
  const isPlatformAdmin = async (request: FastifyRequest): Promise<boolean> => {
    if (!deps.resolveAdminOrdersScope) return true;
    return (await deps.resolveAdminOrdersScope(request)).allowAll;
  };

  app.get(
    '/api/v1/admin/orders',
    { preHandler: requireAdmin('orders:read'), schema: { querystring: adminOrdersListQuerySchema } },
    async (request) => {
      const query = adminOrdersListQuerySchema.parse(request.query);
      const scope = await resolveListScope(request);
      const result = await deps.orderListService.list(query, scope);
      return {
        data: result.rows,
        pagination: { page: query.page, pageSize: query.pageSize, total: result.total },
        counts: result.counts,
      };
    },
  );

  app.get(
    '/api/v1/admin/orders/export',
    {
      preHandler: requireAdmin('orders:read'),
      schema: { querystring: adminOrdersListQuerySchema },
      config: { streamingResponse: true },
    },
    async (request, reply) => {
      const query = adminOrdersListQuerySchema.parse(request.query);
      const scope = await resolveListScope(request);
      const { csv, rowCount, truncated } = await deps.orderExportService.exportCsv(query, scope);
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="orders.csv"');
      reply.header('x-export-row-count', String(rowCount));
      if (truncated) reply.header('x-export-truncated', 'true');
      return reply.send(csv);
    },
  );

  app.post(
    '/api/v1/admin/orders/bulk/status',
    { preHandler: requireAdmin('orders:write'), schema: { body: bulkOrderStatusRequestSchema } },
    async (request) => {
      const body = bulkOrderStatusRequestSchema.parse(request.body);
      const adminUserId = resolveAdminUserId(request);
      const actor = adminUserId
        ? ({ kind: 'admin', adminUserId } as const)
        : ({ kind: 'system', source: 'checkout' } as const);
      const changed: string[] = [];
      const skipped: Array<{ orderId: string; reason: 'invalid_transition' | 'terminal' | 'not_found' }> = [];
      for (const orderId of body.orderIds) {
        try {
          await deps.orderTransitionService.apply(orderId, body.toStatusCode, actor, body.reason ?? null);
          changed.push(orderId);
        } catch (err) {
          skipped.push({ orderId, reason: await classifySkip(err, orderId) });
        }
      }
      return { data: { changed, skipped } };
    },
  );

  app.post(
    '/api/v1/admin/orders/bulk/print-invoices',
    {
      preHandler: requireAdmin('orders:read'),
      schema: { body: bulkPrintInvoicesRequestSchema },
      config: { streamingResponse: true },
    },
    async (request, reply) => {
      const body = bulkPrintInvoicesRequestSchema.parse(request.body);
      const em = emFactory();
      const invoices = await em.find(Invoice, { orderId: { $in: body.orderIds } });
      const pdf = buildBulkInvoicesPdf(
        invoices.map((i) => ({ invoiceNumber: i.number, total: i.total, currency: i.currency })),
      );
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', 'attachment; filename="invoices.pdf"');
      return reply.send(pdf);
    },
  );

  // --- Saved list views (feature 038 US2) -------------------------------
  app.get('/api/v1/admin/orders/list-views', { preHandler: requireAdmin('orders:read') }, async (request) => {
    const adminUserId = resolveAdminUserId(request) ?? '';
    const views = await deps.orderListViewService.listFor(adminUserId);
    return { data: views.map(serializeSavedView) };
  });

  app.post(
    '/api/v1/admin/orders/list-views',
    { preHandler: requireAdmin('orders:read'), schema: { body: createOrderSavedViewRequestSchema } },
    async (request, reply) => {
      const body = createOrderSavedViewRequestSchema.parse(request.body);
      const adminUserId = resolveAdminUserId(request) ?? '';
      const view = await deps.orderListViewService.create(adminUserId, body);
      reply.code(201);
      return { data: serializeSavedView(view) };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/orders/list-views/:id',
    { preHandler: requireAdmin('orders:read'), schema: { body: updateOrderSavedViewRequestSchema } },
    async (request) => {
      const body = updateOrderSavedViewRequestSchema.parse(request.body);
      const adminUserId = resolveAdminUserId(request) ?? '';
      const view = await deps.orderListViewService.update(
        request.params.id,
        adminUserId,
        await isPlatformAdmin(request),
        body,
      );
      return { data: serializeSavedView(view) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/orders/list-views/:id',
    { preHandler: requireAdmin('orders:read') },
    async (request) => {
      const adminUserId = resolveAdminUserId(request) ?? '';
      await deps.orderListViewService.remove(request.params.id, adminUserId, await isPlatformAdmin(request));
      return { data: { deleted: request.params.id } };
    },
  );

  /** Classify why a bulk transition was skipped for one order. */
  async function classifySkip(
    err: unknown,
    orderId: string,
  ): Promise<'invalid_transition' | 'terminal' | 'not_found'> {
    if (err instanceof HttpError && err.code === ERROR_CODES.ORDER_NOT_FOUND) return 'not_found';
    const order = await emFactory().findOne(Order, { id: orderId });
    if (!order) return 'not_found';
    const graph = await deps.orderStatusGraphService.loadGraph();
    return graph.isTerminal(order.status) ? 'terminal' : 'invalid_transition';
  }

  // Create an order on behalf of a customer (feature 038 US3).
  app.post(
    '/api/v1/admin/orders',
    { preHandler: requireAdmin('orders:write'), schema: { body: adminCreateOrderRequestSchema } },
    async (request, reply) => {
      const body = adminCreateOrderRequestSchema.parse(request.body);
      const order = await deps.orderCreationAdminService.create(resolveAdminUserId(request), body);
      reply.code(201);
      return { data: await serializeOrder(emFactory(), order) };
    },
  );

  // Read-only pricing preview for the create-order form (US3). Mirrors
  // placeOrder's loads + totals math (order-service.ts) so the previewed
  // summary matches the order that will be created. Creates nothing.
  app.post(
    '/api/v1/admin/orders/preview',
    { preHandler: requireAdmin('orders:write'), schema: { body: adminOrderPreviewRequestSchema } },
    async (request) => {
      const body = adminOrderPreviewRequestSchema.parse(request.body);
      const em = emFactory();

      const customer = await em.findOne(CustomerAccount, { id: body.customerAccountId });
      if (!customer) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Customer account not found.');
      if (!customer.organizationId) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Customer has no organization.');
      }
      // Resolve the channel like placeOrder does — prefer the requested one,
      // fall back to an active channel so the preview never hard-fails on a
      // stale/legacy id (the price context still resolves sensibly).
      const salesChannel =
        (await em.findOne(SalesChannel, { id: body.salesChannelId })) ??
        (await em.findOne(SalesChannel, { status: 'active' }));
      if (!salesChannel) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Sales channel not found.');
      const organization = await em.findOne(Organization, { id: customer.organizationId });
      const deliveryMethod = body.deliveryMethodId
        ? await em.findOne(DeliveryMethod, { id: body.deliveryMethodId })
        : null;
      const paymentMethod = body.paymentMethodId
        ? await em.findOne(PaymentMethod, { id: body.paymentMethodId })
        : null;

      const currency = deliveryMethod?.currency ?? salesChannel.defaultCurrency;
      const customerGroupId = customer.customerGroupId ?? organization?.customerGroupId ?? null;

      const lines: Array<{
        productId: string;
        variantId: string | null;
        quantity: number;
        unitPrice: string;
        currency: string;
        lineTotal: number;
        unavailable?: boolean;
      }> = [];
      const messages: Array<{ productId: string; code: string }> = [];
      let subtotal = 0;

      for (const it of body.items) {
        const product = await em.findOne(Product, { id: it.productId });
        if (!product) {
          messages.push({ productId: it.productId, code: 'PRODUCT_NOT_FOUND' });
          lines.push({
            productId: it.productId,
            variantId: it.variantId ?? null,
            quantity: it.quantity,
            unitPrice: '0',
            currency,
            lineTotal: 0,
            unavailable: true,
          });
          continue;
        }

        const resolved = deps.pricingService
          ? await deps.pricingService.resolveLinePrice({
              product,
              variantId: it.variantId ?? null,
              context: {
                quantity: it.quantity,
                organization: organization ?? null,
                customerGroupId,
                salesChannel,
                currencyCode: currency,
              },
            })
          : null;

        // Quote-only products (displayMode 'none') cannot be ordered directly —
        // CartService rejects them at add time, so the preview flags them.
        if (resolved && resolved.displayMode === 'none') {
          messages.push({ productId: it.productId, code: 'QUOTE_ONLY' });
          lines.push({
            productId: it.productId,
            variantId: it.variantId ?? null,
            quantity: it.quantity,
            unitPrice: '0',
            currency: resolved.currency,
            lineTotal: 0,
            unavailable: true,
          });
          continue;
        }

        // Mirror CartService.addItem: resolved engine price, else the legacy
        // `defaultPrice` / `price` attribute fallback (so preview == order).
        const unitPrice = resolved
          ? Number(resolved.amount).toFixed(2)
          : Number(
              (product.attributeValues?.['defaultPrice'] as number | string | undefined) ??
                (product.attributeValues?.['price'] as number | string | undefined) ??
                0,
            ).toFixed(2);
        const lineCurrency = resolved?.currency ?? currency;
        subtotal += Number(unitPrice) * it.quantity;
        lines.push({
          productId: it.productId,
          variantId: it.variantId ?? null,
          quantity: it.quantity,
          unitPrice,
          currency: lineCurrency,
          lineTotal: Math.round(Number(unitPrice) * it.quantity * 100) / 100,
        });
      }

      // Same expressions as placeOrder (order-service.ts:686/722-725).
      const taxRate = 0.23;
      const taxTotal = Math.round(subtotal * taxRate * 100) / 100;
      const deliveryTotal = deliveryMethod ? Number(deliveryMethod.cost) : 0;
      const paymentSurcharge = paymentMethod ? Number(paymentMethod.additionalPrice ?? '0') : 0;
      const discountTotal = 0;
      const total =
        Math.round((subtotal + taxTotal + deliveryTotal + paymentSurcharge - discountTotal) * 100) / 100;

      return {
        data: {
          lines,
          summary: {
            subtotal: Math.round(subtotal * 100) / 100,
            taxTotal,
            deliveryTotal,
            paymentSurcharge,
            discountTotal,
            total,
            currency,
          },
          messages,
        },
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
      // Admin detail view: enrich with the linked organization + customer basics
      // so operators can handle the order without leaving the page.
      const [organization, customer] = await Promise.all([
        em.findOne(Organization, { id: order.organizationId }),
        em.findOne(CustomerAccount, { id: order.placedByCustomerAccountId }),
      ]);
      return {
        data: {
          ...(await serializeOrder(em, order)),
          organization: organization
            ? {
                id: organization.id,
                name: organization.name,
                legalName: organization.legalName ?? null,
                taxId: organization.taxId,
                vatStatus: organization.vatStatus,
              }
            : null,
          customer: customer
            ? {
                id: customer.id,
                firstName: customer.firstName,
                lastName: customer.lastName,
                email: customer.email,
              }
            : null,
        },
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
            defaultName: s.defaultName,
            isInitial: s.isInitial,
            isTerminal: s.isTerminal,
            isSystem: s.isSystem,
            weight: s.weight,
            color: s.color,
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

  // --- Order comments (feature 038 US5) ---------------------------------
  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/orders/:id/comments',
    { preHandler: requireAdmin('orders:read') },
    async (request) => {
      const comments = await deps.orderCommentService.listForAdmin(request.params.id);
      return { data: comments.map(serializeComment) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/orders/:id/comments',
    { preHandler: requireAdmin('orders:write'), schema: { body: adminAddOrderCommentRequestSchema } },
    async (request, reply) => {
      const body = adminAddOrderCommentRequestSchema.parse(request.body);
      const comment = await deps.orderCommentService.addByAdmin(
        request.params.id,
        resolveAdminUserId(request),
        body,
      );
      reply.code(201);
      return { data: serializeComment(comment) };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/orders/:id/comments',
    { preHandler: requireCustomer },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      await orderService.getById(request.params.id, ctx); // authorizes visibility (404 if out of scope)
      const comments = await deps.orderCommentService.listForCustomer(request.params.id);
      return { data: comments.map(serializeComment) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/orders/:id/comments',
    { preHandler: requireCustomer, schema: { body: customerAddOrderCommentRequestSchema } },
    async (request, reply) => {
      const body = customerAddOrderCommentRequestSchema.parse(request.body);
      const ctx = resolveCustomerContext(request);
      await orderService.getById(request.params.id, ctx); // authorizes ownership
      const comment = await deps.orderCommentService.addByCustomer(
        request.params.id,
        ctx.customerAccountId,
        body,
      );
      reply.code(201);
      return { data: serializeComment(comment) };
    },
  );

  // --- Reorder (feature 038 US6) ----------------------------------------
  app.post<{ Params: { id: string } }>(
    '/api/v1/orders/:id/reorder',
    { preHandler: requireCustomer },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      await orderService.getById(request.params.id, ctx); // authorize ownership/scope
      const result = await deps.orderReorderService.reorder(request.params.id, {
        customerAccountId: ctx.customerAccountId,
        organizationId: ctx.organizationId,
      });
      return { data: result };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/orders/:id/reorder',
    { preHandler: requireAdmin('orders:write') },
    async (request) => {
      const order = await emFactory().findOne(Order, { id: request.params.id });
      if (!order) throw new HttpError(404, ERROR_CODES.ORDER_NOT_FOUND, 'Order not found.');
      const result = await deps.orderReorderService.reorder(
        request.params.id,
        { customerAccountId: order.placedByCustomerAccountId, organizationId: order.organizationId },
        { notifyCustomer: true },
      );
      return { data: { cartId: result.cartId, unavailableItems: result.unavailableItems } };
    },
  );

  // --- Clone to quote request (feature 038 US7) -------------------------
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/orders/:id/clone-to-quote',
    { preHandler: requireAdmin('orders:write') },
    async (request) => {
      const order = await emFactory().findOne(Order, { id: request.params.id });
      if (!order) throw new HttpError(404, ERROR_CODES.ORDER_NOT_FOUND, 'Order not found.');
      const result = await deps.orderCloneToQuoteService.clone(request.params.id, {
        customerAccountId: order.placedByCustomerAccountId,
        organizationId: order.organizationId,
      });
      return { data: result };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/orders/:id/clone-to-quote',
    { preHandler: requireCustomer },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      await orderService.getById(request.params.id, ctx); // authorize ownership
      const result = await deps.orderCloneToQuoteService.clone(request.params.id, {
        customerAccountId: ctx.customerAccountId,
        organizationId: ctx.organizationId,
      });
      return { data: result };
    },
  );
}

function serializeComment(c: OrderComment): Record<string, unknown> {
  return {
    id: c.id,
    orderId: c.orderId,
    authorAdminUserId: c.authorAdminUserId ?? null,
    authorCustomerAccountId: c.authorCustomerAccountId ?? null,
    body: c.body,
    isCustomerVisible: c.isCustomerVisible,
    notifyCustomer: c.notifyCustomer,
    createdAt: c.createdAt.toISOString(),
  };
}

function serializeSavedView(v: {
  id: string;
  name: string;
  shared: boolean;
  ownerAdminUserId: string;
  filters: Record<string, unknown>;
  sort: { field: string; dir: 'asc' | 'desc' };
  visibleColumns: string[] | null;
}): Record<string, unknown> {
  return {
    id: v.id,
    name: v.name,
    shared: v.shared,
    ownerAdminUserId: v.ownerAdminUserId,
    filters: v.filters,
    sort: v.sort,
    visibleColumns: v.visibleColumns,
  };
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
  // Status label payload (feature 039 follow-up): the localized name map + the
  // language-independent default name, so any client resolves
  // name[language] → defaultName → code in the viewer's language.
  const statusDef = await em.findOne(OrderStatus, { code: order.status });
  // Feature 045 (US2) — per-promotion discount breakdown.
  const appliedPromotions = await em.find(OrderAppliedPromotion, { orderId: order.id });
  return {
    id: order.id,
    businessId: order.businessId,
    organizationId: order.organizationId,
    placedByCustomerAccountId: order.placedByCustomerAccountId,
    placedOnBehalfByAdminUserId: order.placedOnBehalfByAdminUserId ?? null,
    salesChannelId: order.salesChannelId,
    status: order.status,
    customFieldValues: order.customFieldValues ?? {},
    statusName: statusDef?.name ?? {},
    statusDefaultName: statusDef?.defaultName ?? order.status,
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
    appliedPromotions: appliedPromotions.map((ap) => ({
      promotionId: ap.promotionId,
      couponId: ap.couponId ?? null,
      amount: Number(ap.amount),
      currency: ap.currency,
    })),
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
