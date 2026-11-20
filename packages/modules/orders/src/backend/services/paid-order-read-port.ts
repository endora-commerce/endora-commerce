import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  InvoiceReadPort,
  OrganizationDetailsPort,
  PaidOrderDetail,
  PaidOrderListPage,
  PaidOrderListQuery,
  PaidOrderReadPort,
  PaidOrderSummary,
} from '@endora-commerce/contracts';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { Order } from '../entities/order.entity.js';
import { OrderItem } from '../entities/order-item.entity.js';
import { OrderStatus } from '../entities/order-status.entity.js';

const SCOPE_REASON = 'orders: orders billed to a related payer';

interface Cursor {
  readonly placedAt: string;
  readonly id: string;
}

function encodeCursor(order: Pick<Order, 'placedAt' | 'id'>): string {
  return Buffer.from(JSON.stringify({ placedAt: order.placedAt.toISOString(), id: order.id })).toString('base64url');
}

function decodeCursor(cursor: string | undefined): Cursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<Cursor>;
    return typeof parsed.placedAt === 'string' && typeof parsed.id === 'string' ? { placedAt: parsed.placedAt, id: parsed.id } : null;
  } catch {
    return null;
  }
}

/**
 * `paidOrderReadPort` (`specs/182-related-payers/` contracts/ports.md §3, research R-5) — the
 * orders a payer Organization pays for, for `related_payers`' paid-order routes.
 *
 * `Order` is `@OrgScoped` on the **buyer**: under the payer's own context the orders read as
 * absent. So every read runs under a system scope and is constrained by
 * `payer_organization_id` itself — never a widened tenant filter (FR-070). The projection is
 * read-only and carries what the payer pays and is invoiced for: no delivery address, no
 * customer note, no comment thread (FR-071). The caller has checked the reader's
 * `related_payers.view_paid_orders`; this port does not know that permission.
 */
export class PaidOrderReadService implements PaidOrderReadPort {
  constructor(
    private readonly deps: {
      readonly emFactory: () => EntityManager;
      readonly organizations: Pick<OrganizationDetailsPort, 'findByIds'>;
      /** `invoices`' read port, or `null` while that module is absent (no documents listed). */
      readonly invoiceRead: () => Pick<InvoiceReadPort, 'listForOrder'> | null;
    },
  ) {}

  async list(payerOrganizationId: string, query: PaidOrderListQuery): Promise<PaidOrderListPage> {
    const limit = query.limit ?? 20;
    const cursor = decodeCursor(query.cursor);
    const rows = await withSystemScope(SCOPE_REASON, () =>
      this.deps.emFactory().find(
        Order,
        {
          payerOrganizationId,
          ...(cursor
            ? {
                $or: [
                  { placedAt: { $lt: new Date(cursor.placedAt) } },
                  { placedAt: new Date(cursor.placedAt), id: { $lt: cursor.id } },
                ],
              }
            : {}),
        },
        { orderBy: { placedAt: 'desc', id: 'desc' }, limit: limit + 1 },
      ),
    );
    const page = rows.slice(0, limit);
    const items = await this.#summaries(page);
    const last = page[page.length - 1];
    return { items, hasMore: rows.length > limit, cursor: rows.length > limit && last ? encodeCursor(last) : null };
  }

  async find(payerOrganizationId: string, orderId: string): Promise<PaidOrderDetail | null> {
    return withSystemScope(SCOPE_REASON, async () => {
      const em = this.deps.emFactory();
      const order = await em.findOne(Order, { id: orderId, payerOrganizationId });
      if (!order || !order.payerSnapshot) return null;
      const [summary] = await this.#summaries([order]);
      const items = await em.find(OrderItem, { orderId: order.id }, { orderBy: { position: 'asc' } });
      const invoiceRead = this.deps.invoiceRead();
      // The order passed the payer predicate above; its documents are read in the same scope
      // (an invoice is transitively scoped to the buyer's order).
      const invoices = invoiceRead ? await invoiceRead.listForOrder(order.id) : [];
      return {
        ...summary!,
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
          groupId: it.groupId ?? null,
          position: it.position,
        })),
        subtotal: Number(order.subtotal),
        taxTotal: Number(order.taxTotal),
        discountTotal: Number(order.discountTotal ?? 0),
        deliveryTotal: Number(order.deliveryTotal),
        billingAddress: order.billingAddress,
        payer: {
          organizationId: order.payerSnapshot.organizationId,
          name: order.payerSnapshot.name,
          taxId: order.payerSnapshot.taxId,
          terms: order.payerTerms ?? 'buyer',
        },
        deliveryMethodName: order.deliveryMethodSnapshot.name,
        // Issued documents only — a pending document has no number a payer can act on.
        invoices: invoices.filter((inv) => inv.status === 'ready').map((inv) => ({ id: inv.id, number: inv.number })),
      };
    });
  }

  async #summaries(orders: readonly Order[]): Promise<PaidOrderSummary[]> {
    if (orders.length === 0) return [];
    const em = this.deps.emFactory();
    const buyers = new Map(
      (await this.deps.organizations.findByIds([...new Set(orders.map((o) => o.organizationId))])).map((o) => [o.id, o]),
    );
    const labels = new Map<string, string>();
    for (const code of new Set(orders.map((o) => o.status))) {
      const status = await withSystemScope(SCOPE_REASON, () => em.findOne(OrderStatus, { code }));
      labels.set(code, status?.defaultName ?? code);
    }
    return orders.map((order) => {
      const buyer = buyers.get(order.organizationId);
      return {
        id: order.id,
        businessId: order.businessId,
        placedAt: order.placedAt.toISOString(),
        status: order.status,
        statusLabel: labels.get(order.status) ?? order.status,
        paymentStatus: order.paymentStatus,
        buyerOrganizationId: order.organizationId,
        buyerName: buyer ? buyer.legalName || buyer.name : '',
        total: Number(order.total),
        currency: order.currency,
      };
    });
  }
}
