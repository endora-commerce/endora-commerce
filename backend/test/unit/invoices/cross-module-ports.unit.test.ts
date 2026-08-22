import type { EntityManager } from '@mikro-orm/postgresql';
import type { OrderItemRecord, OrderReadPort, OrderRecord } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { Invoice } from '../../../src/modules/invoices/entities/invoice.entity.js';
import { InvoiceLine } from '../../../src/modules/invoices/entities/invoice-line.entity.js';
import { InvoiceService } from '../../../src/modules/invoices/services/invoice-service.js';
import {
  InvoiceEmailDispatcher,
  type InvoiceEmailDispatchDeps,
} from '../../../src/modules/invoices/services/invoice-email-dispatch.js';

/**
 * Feature 075, Phase C — `invoices` reads orders over `orders`' port.
 *
 * Five of this module's nine edges were `em.findOne(Order, …)` and
 * `em.find(OrderItem, …)` written inside `invoices`' own services and routes.
 * Deactivation drops no tables, so every one of them kept answering out of an
 * `orders` an operator had switched off: an invoice — a legal document about an
 * order — went on being drawn from a module the platform was no longer serving.
 *
 * The `EntityManager` below throws on any entity this module does not own, so
 * the red reads "`invoices` queried someone else's table directly" rather than
 * as a silent pass. `Invoice` and `InvoiceLine` are the only two it admits.
 */

const OWN_ENTITIES: readonly unknown[] = [Invoice, InvoiceLine];

/**
 * An in-memory store over this module's **own** two entities, and nothing else.
 * Anything asked about another module's entity throws, which is the assertion:
 * after the cut there is no such question to ask.
 */
function ownEntitiesOnly(): () => EntityManager {
  const guard = (entity: unknown): void => {
    if (!OWN_ENTITIES.includes(entity)) {
      throw new Error(
        `invoices queried an entity it does not own: ${String(
          (entity as { name?: string }).name ?? entity,
        )}`,
      );
    }
  };
  let invoice: Record<string, unknown> | null = null;
  const lines: Array<Record<string, unknown>> = [];
  const create = (entity: unknown, data: Record<string, unknown>): Record<string, unknown> => {
    guard(entity);
    if (entity === Invoice) {
      invoice = { id: 'inv-1', ...data };
      return invoice;
    }
    const line = { id: `line-${lines.length + 1}`, ...data };
    lines.push(line);
    return line;
  };
  const tx = {
    create,
    persistAndFlush: async () => {},
    flush: async () => {},
    getKnex: () => {
      throw new Error('invoices reached for raw SQL in a unit test');
    },
  };
  const em = {
    create,
    findOne: async (entity: unknown, where: Record<string, unknown>) => {
      guard(entity);
      if (entity !== Invoice) return null;
      // `issue` looks an existing invoice up by `(orderId, kind)` before it
      // draws one, and `buildDetail` by id afterwards. Only the second matches.
      return where['id'] === undefined ? null : invoice;
    },
    find: async (entity: unknown) => {
      guard(entity);
      return entity === InvoiceLine ? lines : [];
    },
    transactional: async <T>(cb: (t: unknown) => Promise<T>): Promise<T> => cb(tx),
  } as unknown as EntityManager;
  return () => em;
}

function orderRecord(over: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: 'ord-1',
    businessId: 'ORD-1',
    organizationId: 'org-1',
    placedByCustomerAccountId: 'cust-1',
    placedOnBehalfByAdminUserId: null,
    salesChannelId: 'ch-1',
    status: 'placed',
    paymentStatus: 'paid',
    deliveryAddress: {} as OrderRecord['deliveryAddress'],
    billingAddress: {
      recipientName: 'Buyer',
      companyName: 'Buyer sp. z o.o.',
      taxId: '1234567890',
      street: 'Main 1',
      postalCode: '00-001',
      city: 'Warsaw',
      country: 'PL',
    } as OrderRecord['billingAddress'],
    deliveryMethodId: 'dm-1',
    deliveryMethodSnapshot: {} as OrderRecord['deliveryMethodSnapshot'],
    paymentMethodId: 'pm-1',
    paymentMethodSnapshot: { code: 'transfer', name: 'Transfer', kind: 'bank_transfer' },
    sourceQuoteRequestId: null,
    subtotal: '100.00',
    taxTotal: '23.00',
    discountTotal: '0.00',
    deliveryTotal: '0.00',
    total: '123.00',
    currency: 'PLN',
    promotionCode: null,
    customerNote: null,
    placedAt: new Date('2026-08-01T10:00:00Z'),
    createdAt: new Date('2026-08-01T10:00:00Z'),
    updatedAt: new Date('2026-08-01T10:00:00Z'),
    customFieldValues: {},
    ...over,
  };
}

function orderItem(over: Partial<OrderItemRecord> = {}): OrderItemRecord {
  return {
    id: 'oi-1',
    orderId: 'ord-1',
    productId: 'p-1',
    productSnapshot: { sku: 'SKU-1', name: 'Widget' },
    variantId: null,
    variantSnapshot: null,
    packagingUnitSnapshot: { name: 'karton', baseQuantity: 6 },
    quantity: 2,
    unitPrice: '50.00',
    taxRate: '0.23',
    lineTotal: '100.00',
    createdAt: new Date('2026-08-01T10:00:00Z'),
    ...over,
  };
}

/** Only the methods `OrderReadPort` publishes — never `orders`' entities. */
function readPort(
  order: OrderRecord | null,
  items: OrderItemRecord[] = [],
): { port: OrderReadPort; calls: () => string[] } {
  const calls: string[] = [];
  const port: OrderReadPort = {
    findById: async (id) => {
      calls.push(`findById:${id}`);
      return order;
    },
    findByIds: async (ids) => {
      calls.push(`findByIds:${ids.join(',')}`);
      return order ? [order] : [];
    },
    listAll: async () => (order ? [order] : []),
    listItems: async (orderId) => {
      calls.push(`listItems:${orderId}`);
      return items;
    },
    findIdsByBusinessIdLike: async (fragment, limit) => {
      calls.push(`findIdsByBusinessIdLike:${fragment}:${limit}`);
      return order ? [order.id] : [];
    },
  };
  return { port, calls: () => calls };
}

describe('invoices — the order and its lines come from orders, over its port', () => {
  it('issues from OrderReadPort alone, touching no table it does not own', async () => {
    const { port, calls } = readPort(orderRecord(), [orderItem()]);
    const service = new InvoiceService(
      ownEntitiesOnly(),
      port,
      { next: async () => 'FV 1/2026' } as unknown as ConstructorParameters<
        typeof InvoiceService
      >[2],
      {
        resolve: async () => ({
          name: 'Seller',
          taxId: '9876543210',
          addressLine1: 'Seller 1',
          addressLine2: '',
          postalCode: '00-002',
          city: 'Warsaw',
          country: 'PL',
        }),
      } as unknown as ConstructorParameters<typeof InvoiceService>[3],
    );

    const detail = await service.issue('ord-1', 'invoice');

    // Three reads, every one of them over the port: the order, its lines, and
    // the order again for the transitive tenant scope `buildDetail` re-checks
    // before it hands the detail back.
    expect(calls()).toEqual(['findById:ord-1', 'listItems:ord-1', 'findById:ord-1']);
    expect(detail.number).toBe('FV 1/2026');
    expect(detail.currency).toBe('PLN');
  });

  it('carries each order line\'s own VAT rate and unit onto the invoice line', async () => {
    // MR !569's mirroring reads both off the order line. `OrderItemRecord`
    // publishes `taxRate` and `packagingUnitSnapshot`, so the port carries what
    // the correction later inherits — which is the reason the record shape,
    // and not a narrower one, is what `orders` publishes.
    const { port } = readPort(orderRecord(), [
      orderItem({ taxRate: '0.08', packagingUnitSnapshot: { name: 'paleta', baseQuantity: 48 } }),
    ]);
    const service = new InvoiceService(
      ownEntitiesOnly(),
      port,
      { next: async () => 'FV 2/2026' } as unknown as ConstructorParameters<
        typeof InvoiceService
      >[2],
      {
        resolve: async () => ({
          name: 'Seller',
          taxId: '9876543210',
          addressLine1: 'Seller 1',
          addressLine2: '',
          postalCode: '00-002',
          city: 'Warsaw',
          country: 'PL',
        }),
      } as unknown as ConstructorParameters<typeof InvoiceService>[3],
    );

    const detail = await service.issue('ord-1', 'invoice');
    expect(detail.lines[0]?.taxRate).toBe(0.08);
    expect(detail.lines[0]?.unit).toBe('paleta');
  });

  it('refuses to issue when the port answers no order', async () => {
    const { port } = readPort(null);
    const service = new InvoiceService(
      ownEntitiesOnly(),
      port,
      {} as unknown as ConstructorParameters<typeof InvoiceService>[2],
      {} as unknown as ConstructorParameters<typeof InvoiceService>[3],
    );
    await expect(service.issue('ord-1', 'invoice')).rejects.toMatchObject({
      code: 'ORDER_NOT_FOUND',
    });
  });

  it('lets a switched-off orders through the dispatcher rather than reporting a failed send', async () => {
    // The whole point of the cut, and the defect #115 removed: the FR-029
    // tolerance around dispatch is narrow. A `ModuleDisabledError` is a
    // presence answer about the operation, so it propagates; absorbing it would
    // report "the e-mail did not go out" where the truth is "this capability is
    // off".
    const deps: InvoiceEmailDispatchDeps = {
      orderReadPort: {
        findById: async () => {
          throw new ModuleDisabledError('orders');
        },
      } as unknown as InvoiceEmailDispatchDeps['orderReadPort'],
      invoiceService: {
        buildDetail: async () => ({
          id: 'inv-1',
          orderId: 'ord-1',
          number: 'FV 1/2026',
          grossTotal: 123,
          currency: 'PLN',
          salesChannelId: null,
        }),
      } as unknown as InvoiceEmailDispatchDeps['invoiceService'],
      pdfRenderer: {} as InvoiceEmailDispatchDeps['pdfRenderer'],
      settingsService: {
        get: async () => true,
      } as unknown as InvoiceEmailDispatchDeps['settingsService'],
      getSender: () => ({ send: async () => ({ status: 'sent' as const }) }),
      resolveRecipientEmail: async () => 'buyer@example.test',
      resolveLanguage: async () => 'en-US',
      log: () => {},
    };

    await expect(new InvoiceEmailDispatcher(deps).dispatch('inv-1')).rejects.toBeInstanceOf(
      ModuleDisabledError,
    );
  });

  it('still contains an ordinary send failure, and names it', async () => {
    const logged: Array<{ reason: unknown }> = [];
    const deps: InvoiceEmailDispatchDeps = {
      orderReadPort: {
        findById: async () => orderRecord(),
      } as unknown as InvoiceEmailDispatchDeps['orderReadPort'],
      invoiceService: {
        buildDetail: async () => ({
          id: 'inv-1',
          orderId: 'ord-1',
          number: 'FV 1/2026',
          grossTotal: 123,
          currency: 'PLN',
          salesChannelId: null,
        }),
      } as unknown as InvoiceEmailDispatchDeps['invoiceService'],
      pdfRenderer: {} as InvoiceEmailDispatchDeps['pdfRenderer'],
      settingsService: {
        get: async () => 'link',
      } as unknown as InvoiceEmailDispatchDeps['settingsService'],
      getSender: () => ({
        send: async () => {
          throw new Error('smtp down');
        },
      }),
      resolveRecipientEmail: async () => 'buyer@example.test',
      resolveLanguage: async () => 'en-US',
      log: (_message, context) => logged.push({ reason: context['reason'] }),
    };

    await expect(new InvoiceEmailDispatcher(deps).dispatch('inv-1')).resolves.toEqual({
      sent: false,
      reason: 'failed',
    });
    expect(logged).toEqual([{ reason: 'failed' }]);
  });
});
