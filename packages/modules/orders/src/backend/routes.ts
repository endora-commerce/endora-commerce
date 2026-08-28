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
  isCustomFieldValidationFailure,
  OrganizationCannotTransactError,
  orderPreviewTotalRequestSchema,
  placeOrderRequestSchema,
  setOrderTransitionsRequestSchema,
  updateOrderSavedViewRequestSchema,
  updateOrderStatusRequestSchema,
} from '@endora-commerce/contracts';
import type {
  AssetReadPort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  CustomFieldValuePort,
  DeliveryMethodReadPort,
  InvoicePdfPort,
  InvoiceReadPort,
  LinePricePort,
  OrganizationDetailsPort,
  PaymentMethodReadPort,
} from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '@endora-commerce/platform/http';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
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
import type { CustomerOrderCancellationService } from './services/order-cancellation-service.js';
import type { PurchaseConversionService } from './services/purchase-conversion-service.js';
import { Order } from './entities/order.entity.js';
import { OrderItem } from './entities/order-item.entity.js';
import { OrderAppliedPromotion } from './entities/order-applied-promotion.entity.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

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
   * Feature 085 (US3) — the buyer cancelling an order they placed, and the
   * capability the buyer's surface renders that control from.
   */
  customerOrderCancellation: CustomerOrderCancellationService;
  /**
   * Issue #277 — the per-order claim on the GA4 `purchase` conversion, spent
   * by whichever storefront page the buyer sees the order on first.
   */
  purchaseConversion: PurchaseConversionService;
  /**
   * Feature 038 US3 — pricing engine, used by the read-only create-order
   * preview to resolve per-line prices for the chosen customer/channel.
   *
   * Required since issue #124: "absent" used to mean "preview every line from
   * the catalogue's legacy `defaultPrice` attribute", which is a price no price
   * list supports, on the form an operator is about to turn into an order.
   */
  pricingService: LinePricePort;
  /**
   * The same VAT authority `placeOrder` uses (issue #124). The preview used to
   * apply a hard-coded 23% — so it disagreed with the order it claims to mirror
   * in every deployment whose tax rules say anything else, and it kept quoting
   * that 23% with `taxes` switched off entirely.
   */
  resolveTaxRate: (input: {
    country: string | null;
    productType: string;
    vatStatus: string;
  }) => Promise<number>;
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
  /**
   * The read models this surface resolves from the modules that own the rows
   * (feature 075). Each is a `lazyPort` handed down by `backend.ts`, so a
   * disabled owner answers 503 `MODULE_DISABLED` at the call rather than
   * returning rows from tables deactivation does not drop.
   */
  catalogProductRead: CatalogProductReadPort;
  customerAccountRead: CustomerAccountReadPort;
  organizationDetails: OrganizationDetailsPort;
  /**
   * The two method catalogues, as accessors. Both owners are deactivatable and
   * this module declares them `degrades-without` rather than as dependencies —
   * see `manifest.ts` — so presence is decided per request and `null` means
   * "there is no such catalogue here", which the preview quotes as no delivery
   * cost and no payment surcharge, the same figures it quotes for a request
   * that names neither.
   */
  deliveryMethodRead: () => DeliveryMethodReadPort | null;
  paymentMethodRead: () => PaymentMethodReadPort | null;
  /**
   * The invoice document behind an order. Both are accessors: `invoices` is
   * deactivatable and declares this module, so the edge is `degrades-without`
   * and presence is decided per request — `null` ⇒ no invoice surface.
   */
  invoiceRead: () => InvoiceReadPort | null;
  invoicePdf: () => InvoicePdfPort | null;
  /** `assets_library`, for the stored invoice PDF asset. */
  assetRead: AssetReadPort;
  /** Feature 055 — validates + persists Order custom-field values (via the Command Bus). */
  customFieldValues?: CustomFieldValuePort;
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

  /**
   * An order as the buyer who is reading it sees it (feature 085, FR-018).
   *
   * Every buyer-facing read goes through here so the cancel capability is
   * carried on all of them and computed in one place. It is scoped to the
   * asking account, not to the order: an Organization Admin may read a
   * colleague's order and may not cancel it, and a control offered on that read
   * would disagree with the 404 the cancel route gives.
   */
  const serializeForBuyer = async (
    order: Order,
    customerAccountId: string,
  ): Promise<Record<string, unknown>> =>
    serializeOrder(emFactory(), order, {
      customerCancellable: await deps.customerOrderCancellation.isCancellableByCustomer(
        order,
        customerAccountId,
      ),
    });

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
          if (isCustomFieldValidationFailure(err)) {
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
      return { data: await serializeForBuyer(order, ctx.customerAccountId) };
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
    const cancellable = await deps.customerOrderCancellation.cancellableOrderIds(
      orders,
      ctx.customerAccountId,
    );
    return {
      data: await Promise.all(
        orders.map((o) => serializeOrder(em, o, { customerCancellable: cancellable.has(o.id) })),
      ),
      pagination: { cursor: null, hasMore: false, limit: 50 },
    };
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/orders/:id',
    { preHandler: requireCustomer },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      const order = await orderService.getById(request.params.id, ctx);
      return { data: await serializeForBuyer(order, ctx.customerAccountId) };
    },
  );

  /**
   * The buyer cancels an order they placed (feature 085, US3 / FR-013).
   *
   * `POST`, and immediate: the owner's wording is that the customer cancels,
   * so there is no approval step, no pending-cancellation state and no staff
   * queue. Everything the refusal rules and the ownership scope are lives in
   * the service; the route is the seam.
   *
   * There is no request body — the target status is not the buyer's to choose.
   */
  app.post<{ Params: { id: string } }>(
    '/api/v1/orders/:id/cancel',
    { preHandler: requireCustomer },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      const order = await deps.customerOrderCancellation.cancelByCustomer(
        request.params.id,
        ctx.customerAccountId,
      );
      return { data: await serializeForBuyer(order, ctx.customerAccountId) };
    },
  );

  /**
   * Claim this order's GA4 `purchase` conversion (issue #277).
   *
   * The storefront asks before it fires the tag and fires only on `true`, so
   * one order is reported once however many times the buyer opens it, on
   * however many devices. Everything about *whether* the order may be counted
   * at all — a declined gateway payment, a refund, a bank transfer that has
   * not cleared — is the storefront's own eligibility rule and is settled
   * before this is called; this route answers one question, "has anyone
   * counted it yet".
   *
   * `POST`, because it spends the claim. Scoped through `getById`, which 404s
   * for an order this buyer may not read, so nobody can burn a stranger's
   * conversion.
   *
   * There is no request body and no side effect on the order.
   */
  app.post<{ Params: { id: string } }>(
    '/api/v1/orders/:id/purchase-conversion',
    { preHandler: requireCustomer },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      const order = await orderService.getById(request.params.id, ctx);
      const counted = await deps.purchaseConversion.claim(order.id);
      return { data: { counted } };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/orders/:id/invoice',
    { preHandler: requireCustomer, config: { streamingResponse: true } },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      const order = await orderService.getById(request.params.id, ctx);
      // `invoices` is deactivatable and declares this module, so the edge is
      // `degrades-without`: with the module absent there is no invoice document
      // and the answer is the same one an order that has not been invoiced yet
      // already gets.
      const invoiceRead = deps.invoiceRead();
      const invoicePdf = deps.invoicePdf();
      const invoice = invoiceRead ? (await invoiceRead.listForOrder(order.id))[0] : undefined;
      if (!invoice || invoice.status !== 'ready' || !invoicePdf) {
        throw new HttpError(
          404,
          ERROR_CODES.INVOICE_NOT_READY,
          'Invoice is not ready yet.',
        );
      }
      let pdfBytes: Buffer | null = null;
      if (invoice.pdfAssetId) {
        const asset = await deps.assetRead.findById(invoice.pdfAssetId);
        if (asset?.storageUrl.startsWith('data:application/pdf;base64,')) {
          pdfBytes = Buffer.from(
            asset.storageUrl.slice('data:application/pdf;base64,'.length),
            'base64',
          );
        }
      }
      if (!pdfBytes) {
        pdfBytes = Buffer.from(
          invoicePdf.renderMinimal({
            invoiceNumber: invoice.number,
            total: invoice.total,
            currency: invoice.currency,
          }),
        );
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

  /**
   * Load an order for an admin route that names one, through the tenant guard.
   *
   * `Order` is `@OrgScoped`, so this read carries the `org` global filter
   * (feature 050): a scoped admin's request runs in `allowed-set` mode — the
   * request scope hook derives it from the very same `resolveAdminOrdersScope`
   * the list and the export use — and an order outside that set is not
   * returned. **An order the caller may not see is therefore answered exactly
   * as one that does not exist**, which is the answer the list already gives by
   * omitting the row, and the answer `OrderService.#scopedOrderWhere` already
   * documents for the customer surface: 404, never 403, so the refusal does not
   * disclose that the order is there.
   *
   * Routes below that reach an order's *children* need this, because those
   * children carry no organization column and no filter of their own —
   * `OrderComment` is `@GlobalEntity`, `Invoice` is `@TransitivelyScoped` — so
   * a read keyed only on `orderId` answers for every order on the platform.
   * Routes that already load the order themselves are covered by the same
   * filter and do not call this.
   */
  const loadScopedAdminOrder = async (orderId: string): Promise<Order> => {
    const order = await emFactory().findOne(Order, { id: orderId });
    if (!order) throw new HttpError(404, ERROR_CODES.ORDER_NOT_FOUND, 'Order not found.');
    return order;
  };

  /**
   * Refuse an admin action taken *for a customer* when the caller's assignment
   * scope does not reach that customer's organization.
   *
   * Neither route this guards names an order, which is why the route sweep
   * flagged them: an INSERT is not filtered by MikroORM, and the preview reads
   * a **price** rather than a row. Measured, both are nonetheless refused
   * today — through the *customer* rather than the order, because
   * `CustomerAccount` is `@OrgScoped` as well, so `customerAccountRead.findById`
   * comes back empty for a scoped caller and each route raises its own 404. The
   * door was shut; what was missing was anyone deciding to shut it.
   *
   * That is not the redundant restatement a route-level compare would be on the
   * order-keyed routes, where it would re-read the very row the transition
   * service reads, through the very filter that already answered. This compares
   * against `resolveAdminOrdersScope` **independently of how the read below it
   * is implemented**: `customerAccountRead` is a port another module owns, and
   * on the day that implementation resolves a customer through raw SQL or under
   * a widened scope, this is the line still standing.
   *
   * Which matters most on the preview. It resolves the same negotiated,
   * per-organization, per-customer-group price list a real order would, and it
   * persists nothing — so it is the cheapest possible read of terms the caller
   * may not read. In B2B those terms are among the most sensitive figures the
   * platform holds: a rival distributor's discount curve outlives the order
   * that would have followed it.
   *
   * The refusal is **403, not the 404** the order-keyed routes give, and not
   * the 404 these two gave by accident. There is no order here whose existence
   * a status code could disclose; the subject is the caller's authority over an
   * organization they named themselves, in the body of their own request. A 403
   * says that and is actionable — the operator learns to ask for the
   * assignment — where "Customer account not found." sends them looking for a
   * typo in an id they are reading off their own screen.
   *
   * It discloses nothing the 404 did not: for a scoped caller an absent
   * customer, a customer with no organization, and a customer in an
   * organization they are not assigned to all get that one answer, so the
   * status code is no probe for which account ids exist. A platform
   * administrator keeps each route's own 404/422, and the branch deciding which
   * applies is `allowAll` — the shape `resolveAdminOrdersScope` returns — never
   * a role code read here.
   */
  const assertCustomerInScope = async (
    request: FastifyRequest,
    customerAccountId: string,
  ): Promise<void> => {
    const scope = await resolveListScope(request);
    if (!scope) return;
    const customer = await deps.customerAccountRead.findById(customerAccountId);
    if (
      !customer?.organizationId ||
      !scope.allowedOrganizationIds.includes(customer.organizationId)
    ) {
      throw new HttpError(
        403,
        ERROR_CODES.FORBIDDEN,
        'You may only act for customers in the organizations assigned to you.',
        { code: 'customer_outside_assignment_scope' },
      );
    }
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
        // Feature 085 (FR-021) — the money axis, as its own map. `paid` is a
        // shipped order status code as well as a payment status, so folding the
        // two axes into `counts` would add two populations under one key.
        paymentStatusCounts: result.paymentStatusCounts,
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

  // Bulk status change. **Per item, not all-or-nothing** — and the assignment
  // scope is one more per-item reason rather than an exception to that shape.
  // Every other refusal this route can give (no such edge in the graph, a
  // terminal source, no such order) is already reported per order while the
  // rest of the batch applies, so a caller reads `changed` and `skipped` to
  // learn what happened and never has to infer it. Refusing the whole call on
  // one out-of-scope member would also hand a scoped admin an existence
  // oracle: "the batch failed" would say that one of these ids is an order
  // somebody else's, which is exactly what the 404 on the single-order route
  // refuses to say. An out-of-scope order is reported as `not_found`, the same
  // reason a nonexistent one gets — `classifySkip` reaches that answer through
  // the tenant filter, not through a branch of its own.
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
      const invoiceRead = deps.invoiceRead();
      const invoicePdf = deps.invoicePdf();
      if (!invoiceRead || !invoicePdf) {
        // Same `degrades-without` answer as the customer download: with
        // `invoices` absent there are no documents to print.
        throw new HttpError(404, ERROR_CODES.INVOICE_NOT_READY, 'Invoice is not ready yet.');
      }
      // Resolve the requested orders through the tenant guard before the
      // documents are resolved. `Invoice` is scoped transitively through
      // `Order` and so carries no filter of its own: a read keyed only on
      // `orderId` returns the number, the total and the currency for every
      // order named, whether or not the caller may see it. An id the filter
      // drops contributes no page — the same answer this route already gives
      // for an order that has no invoice.
      const visibleOrders = await emFactory().find(Order, { id: { $in: body.orderIds } });
      const invoices = await invoiceRead.listForOrders(visibleOrders.map((o) => o.id));
      const pdf = Buffer.from(
        invoicePdf.renderBulk(
          invoices.map((i) => ({ invoiceNumber: i.number, total: i.total, currency: i.currency })),
        ),
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
    // Every reason this returns is a statement about the order. A module that
    // is off is a statement about the platform, and reporting one hundred
    // orders as `invalid_transition` sends the operator to the status graph to
    // look for a rule that was never the problem.
    rethrowIfModuleDisabled(err);
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
      // Decided here rather than left to whatever the creation service happens
      // to read: the row this route writes carries its organization inward, and
      // an INSERT passes through no filter on the way.
      await assertCustomerInScope(request, body.customerAccountId);
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
      // Before any price is resolved, and before the customer read below that
      // currently refuses first. See `assertCustomerInScope`: this route quotes
      // negotiated terms and persists nothing, which makes it the cheapest read
      // of a price list the caller may not read.
      await assertCustomerInScope(request, body.customerAccountId);
      const em = emFactory();

      const customer = await deps.customerAccountRead.findById(body.customerAccountId);
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
      const organization = await deps.organizationDetails.findById(customer.organizationId);
      const deliveryMethodRead = deps.deliveryMethodRead();
      const paymentMethodRead = deps.paymentMethodRead();
      const deliveryMethod =
        body.deliveryMethodId && deliveryMethodRead
          ? await deliveryMethodRead.findById(body.deliveryMethodId)
          : null;
      const paymentMethod =
        body.paymentMethodId && paymentMethodRead
          ? await paymentMethodRead.findById(body.paymentMethodId)
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
      /** Net per product tax class, so VAT resolves the way `placeOrder` resolves it. */
      const taxableByProductType = new Map<string, number>();

      for (const it of body.items) {
        const product = await deps.catalogProductRead.findById(it.productId);
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

        const resolved = await deps.pricingService.resolveLinePrice({
          product,
          variantId: it.variantId ?? null,
          context: {
            quantity: it.quantity,
            organization: organization ?? null,
            customerGroupId,
            salesChannel,
            currencyCode: currency,
          },
        });

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

        // Mirror CartService.addItem: the resolved engine price, else the legacy
        // `defaultPrice` / `price` catalogue attribute (so preview == order).
        // `resolved === null` is `price_lists` answering "no list applies"; an
        // absent `price_lists` never reaches here, because resolving the port
        // above throws `MODULE_DISABLED` (issue #124).
        const unitPrice = resolved
          ? Number(resolved.amount).toFixed(2)
          : Number(
              (product.attributeValues?.['defaultPrice'] as number | string | undefined) ??
                (product.attributeValues?.['price'] as number | string | undefined) ??
                0,
            ).toFixed(2);
        const lineCurrency = resolved?.currency ?? currency;
        subtotal += Number(unitPrice) * it.quantity;
        taxableByProductType.set(
          product.type,
          (taxableByProductType.get(product.type) ?? 0) + Number(unitPrice) * it.quantity,
        );
        lines.push({
          productId: it.productId,
          variantId: it.variantId ?? null,
          quantity: it.quantity,
          unitPrice,
          currency: lineCurrency,
          lineTotal: Math.round(Number(unitPrice) * it.quantity * 100) / 100,
        });
      }

      // VAT from the same authority `placeOrder` uses, per product tax class —
      // not the flat 23% this endpoint used to apply (issue #124). That constant
      // was the preview's own invention: it disagreed with the order it claims
      // to mirror wherever the deployment's tax rules said anything else, and it
      // went on quoting a rate with `taxes` switched off, which is precisely
      // when nobody could tell it was wrong.
      const vatStatus = organization?.vatStatus ?? 'vat_payer';
      const taxCountry = organization?.registeredAddress?.country ?? null;
      let taxTotal = 0;
      for (const [productType, taxable] of taxableByProductType) {
        const rate =
          vatStatus === 'vat_payer'
            ? await deps.resolveTaxRate({ country: taxCountry, productType, vatStatus })
            : 0;
        taxTotal += taxable * rate;
      }
      taxTotal = Math.round(taxTotal * 100) / 100;
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
        deps.organizationDetails.findById(order.organizationId),
        deps.customerAccountRead.findById(order.placedByCustomerAccountId),
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

  /**
   * Per-order status change.
   *
   * This route and its bulk twin carry `requireAdmin('orders:write')` and no
   * scope argument, and that is not the hole it reads as: the transition
   * service reaches the order with `em.findOne(Order, …)`, `Order` is
   * `@OrgScoped`, and the request runs in the tenant context the request-scope
   * hook derived from `resolveAdminOrdersScope`. A scoped admin therefore gets
   * 404 `ORDER_NOT_FOUND` for an order outside their assignments — measured,
   * not assumed: `test/integration/orders/admin-write-scope.test.ts` drives
   * both routes with a `sales_representative` session holding `orders:write`.
   *
   * An explicit `allowedOrganizationIds.includes(order.organizationId)` here
   * would be unreachable — the filtered read never returns the row the compare
   * would reject — and Principle XI wants tenant isolation held structurally
   * rather than restated per route. **The guarantee does rest on the order
   * being loaded through a filtered EntityManager**, so a future transition
   * seam that reads through `getKnex()` or widens with `withSystemScope` would
   * take it away silently. That test is what makes such a change go red.
   */
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
      // The thread is reached through the order, so the order is what
      // authorizes it. Without this load the handler answers from
      // `order_comments` alone — a global entity with no organization column —
      // and hands a scoped admin the internal notes on an order the same
      // session cannot list. The write twin below has always been covered,
      // because `addByAdmin` loads the order to check it is non-terminal.
      await loadScopedAdminOrder(request.params.id);
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

/**
 * @param capabilities what *this reader* may do with the order — computed by
 *   the platform and carried to the surface (feature 085, FR-018). Buyer-facing
 *   reads pass it; the admin reads do not, because an administrator's power to
 *   cancel has no per-order condition to report.
 */
async function serializeOrder(
  em: EntityManager,
  order: Order,
  capabilities?: { customerCancellable: boolean },
): Promise<Record<string, unknown>> {
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
    deliveryPoint: order.deliveryPointSnapshot ?? null,
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
    ...(capabilities ? { customerCancellable: capabilities.customerCancellable } : {}),
  };
}
