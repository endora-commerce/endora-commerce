import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ERROR_CODES,
  isUuidShape,
  type CheckoutPayer,
  type CheckoutPayersResponse,
  type CreditAvailabilityReadPort,
  type InvoicePdfPort,
  type OrganizationPermissionPort,
  type PaidOrderReadPort,
  paidOrderListQuerySchema,
  type OrganizationRestrictionPort,
  type RelatedPayerPolicyPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { getResolvedChannel } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';

export interface RelatedPayersCustomerRouteDeps {
  readonly requireCustomer: (request: FastifyRequest, reply: unknown) => Promise<void>;
  readonly customerContextResolver: (request: FastifyRequest) => { customerAccountId: string; organizationId: string };
  readonly policy: RelatedPayerPolicyPort;
  readonly organizationRestriction: Pick<OrganizationRestrictionPort, 'allowedIdsFor'>;
  readonly channelEnabled: (salesChannelId: string) => Promise<boolean>;
  /** `credit_limits`' availability read, or `null` while that module is absent (`degrades-without`). */
  readonly creditAvailability: () => CreditAvailabilityReadPort | null;
  /** `orders`' read of the orders a payer pays for (FR-070). */
  readonly paidOrders: PaidOrderReadPort;
  /** `invoices`' renderer, or `null` while that module is absent (no document to download). */
  readonly invoicePdf: () => InvoicePdfPort | null;
  readonly permissions: Pick<OrganizationPermissionPort, 'can'>;
}

/**
 * FR-072 — one answer for every out-of-scope read of a paid order: the channel off, the
 * reader without *View orders we pay for*, an order that does not name the reader's
 * Organization, an invoice that is not that order's. Indistinguishable from a missing order.
 */
const ORDER_NOT_FOUND = () => new HttpError(404, ERROR_CODES.NOT_FOUND, 'Order not found.');

/**
 * The buyer's routes (`contracts/storefront-api.md`). Phase 2: the checkout payer list.
 *
 * Absent where the capability is off on the request's channel (FR-002): `404`, as for a
 * route that does not exist; and absent everywhere while the module is off, through
 * `ctx.routes` (`503 MODULE_DISABLED`).
 */
export async function registerRelatedPayersCustomerRoutes(
  app: FastifyInstance,
  deps: RelatedPayersCustomerRouteDeps,
): Promise<void> {
  /**
   * `GET /api/v1/checkout/payers` (FR-060, FR-066) — the payers this person may order with
   * now on this channel, each with its allowed billing addresses and its payment-method
   * allow-list. Empty without `related_payers.order_with_payer` (the policy decides). The
   * payer's addresses and allow-list are read under a system scope with the payer's id
   * from a usable link (research R-5): under the buyer's own context both would read as
   * absent, and an absent allow-list means "unrestricted" — fail-open.
   */
  app.get('/api/v1/checkout/payers', { preHandler: deps.requireCustomer }, async (request): Promise<CheckoutPayersResponse> => {
    const channel = getResolvedChannel(request);
    if (!(await deps.channelEnabled(channel.id))) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');
    }
    const customer = deps.customerContextResolver(request);
    const subject = {
      buyerOrganizationId: customer.organizationId,
      customerAccountId: customer.customerAccountId,
      salesChannelId: channel.id,
    };
    const payers = await deps.policy.usablePayers(subject);
    const data: CheckoutPayer[] = [];
    for (const payer of payers) {
      const addresses = await deps.policy.payerBillingAddresses(subject, payer.payerOrganizationId);
      const allowed = await withSystemScope('related_payers: payment methods of a linked payer', () =>
        deps.organizationRestriction.allowedIdsFor(payer.payerOrganizationId, 'paymentMethodIds'),
      );
      // RP-16 (c) — the payer's own available credit, read under a system scope with the
      // payer id from the usable link (a credit grant is tenant-scoped).
      const creditRead = deps.creditAvailability();
      const credit = creditRead
        ? await withSystemScope('related_payers: credit of a linked payer', () =>
            creditRead.availableFor(payer.payerOrganizationId),
          )
        : null;
      data.push({
        payerOrganizationId: payer.payerOrganizationId,
        name: payer.payerName,
        taxId: payer.payerTaxId,
        commercialTerms: payer.commercialTerms,
        billingAddresses: addresses.map((a) => ({
          id: a.id,
          recipientName: a.recipientName,
          street: a.street,
          city: a.city,
          postalCode: a.postalCode,
          country: a.country,
          phone: a.phone,
        })),
        paymentMethodIds: allowed === null || allowed.length === 0 ? null : allowed,
        creditAvailable: credit ? credit.availableAmount : null,
      });
    }
    return { data };
  });

  /** The reader's Organization when it may read the orders it pays for here; otherwise the one 404. */
  async function payerInScope(request: FastifyRequest): Promise<string> {
    const channel = getResolvedChannel(request);
    if (!(await deps.channelEnabled(channel.id))) throw ORDER_NOT_FOUND();
    const customer = deps.customerContextResolver(request);
    const may = await deps.permissions.can(
      { customerAccountId: customer.customerAccountId, organizationId: customer.organizationId },
      'related_payers.view_paid_orders',
    );
    if (!may) throw ORDER_NOT_FOUND();
    return customer.organizationId;
  }

  /** `GET /api/v1/account/paid-orders` (FR-070) — newest first, cursor-paged. */
  app.get('/api/v1/account/paid-orders', { preHandler: deps.requireCustomer }, async (request) => {
    const payerOrganizationId = await payerInScope(request);
    const query = paidOrderListQuerySchema.parse(request.query ?? {});
    const page = await deps.paidOrders.list(payerOrganizationId, query);
    return { data: page.items, pagination: { cursor: page.cursor, hasMore: page.hasMore, limit: query.limit } };
  });

  /** `GET /api/v1/account/paid-orders/:id` (FR-070, FR-071) — read-only. */
  app.get<{ Params: { id: string } }>(
    '/api/v1/account/paid-orders/:id',
    { preHandler: deps.requireCustomer },
    async (request) => {
      const payerOrganizationId = await payerInScope(request);
      if (!isUuidShape(request.params.id)) throw ORDER_NOT_FOUND();
      const order = await deps.paidOrders.find(payerOrganizationId, request.params.id);
      if (!order) throw ORDER_NOT_FOUND();
      return { data: order };
    },
  );

  /**
   * `GET /api/v1/account/paid-orders/:id/invoices/:invoiceId/pdf` (RP-13) — a document of that
   * order only, after the order passed the payer predicate. Rendered under a system scope: the
   * invoice is scoped to the buyer's order.
   */
  app.get<{ Params: { id: string; invoiceId: string } }>(
    '/api/v1/account/paid-orders/:id/invoices/:invoiceId/pdf',
    { preHandler: deps.requireCustomer, config: { streamingResponse: true } },
    async (request, reply: FastifyReply) => {
      const payerOrganizationId = await payerInScope(request);
      if (!isUuidShape(request.params.id)) throw ORDER_NOT_FOUND();
      const order = await deps.paidOrders.find(payerOrganizationId, request.params.id);
      const invoice = order?.invoices.find((i) => i.id === request.params.invoiceId);
      const pdf = deps.invoicePdf();
      if (!order || !invoice || !pdf) throw ORDER_NOT_FOUND();
      const bytes = Buffer.from(
        await withSystemScope('related_payers: an invoice of an order we pay for', () => pdf.renderInvoice(invoice.id)),
      );
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', `attachment; filename="${invoice.number.replace(/[/\\]/g, '-')}.pdf"`);
      return reply.send(bytes);
    },
  );
}
