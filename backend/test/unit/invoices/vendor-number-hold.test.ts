import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import type { EntityManager } from '@mikro-orm/postgresql';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InvoiceDetail, OrderItemRecord, OrderReadPort, OrderRecord } from '@endora-commerce/contracts';
import { Invoice } from '../../../../packages/modules/invoices/src/backend/entities/invoice.entity.js';
import { InvoiceLine } from '../../../../packages/modules/invoices/src/backend/entities/invoice-line.entity.js';
import { registerInvoicesAdminRoutes } from '../../../../packages/modules/invoices/src/backend/routes.admin.js';
import type {
  InvoiceEmailDispatcher,
  InvoicesAdminDeps,
} from '../../../../packages/modules/invoices/src/backend/routes.admin.js';
import { InvoiceService } from '../../../../packages/modules/invoices/src/backend/services/invoice-service.js';
import type { InvoicePdfRenderer } from '../../../../packages/modules/invoices/src/backend/services/invoice-pdf-renderer.js';
import type { InvoiceTemplateService } from '../../../../packages/modules/invoices/src/backend/services/invoice-template-service.js';

const OWN_ENTITIES: readonly unknown[] = [Invoice, InvoiceLine];

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
  };
  const em = {
    create,
    findOne: async (entity: unknown, where: Record<string, unknown>) => {
      guard(entity);
      if (entity !== Invoice) return null;
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

function orderRecord(): OrderRecord {
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
  };
}

function orderItem(): OrderItemRecord {
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
  };
}

function readPort(order: OrderRecord, items: OrderItemRecord[]): OrderReadPort {
  return {
    findById: async () => order,
    findByIds: async () => [order],
    listAll: async () => [order],
    listItems: async () => items,
    findIdsByBusinessIdLike: async () => [order.id],
    salesChannelIdsForCustomer: async () => [order.salesChannelId],
  };
}

const SELLER = {
  resolve: async () => ({
    name: 'Seller',
    taxId: '9876543210',
    addressLine1: 'Seller 1',
    addressLine2: '',
    postalCode: '00-002',
    city: 'Warsaw',
    country: 'PL',
  }),
};

function issueService(
  routing: ConstructorParameters<typeof InvoiceService>[7],
  emailOnReady?: (invoiceId: string) => Promise<void>,
): InvoiceService {
  return new InvoiceService(
    ownEntitiesOnly(),
    readPort(orderRecord(), [orderItem()]),
    { next: async () => 'FV 1/2026' } as ConstructorParameters<typeof InvoiceService>[2],
    SELLER as ConstructorParameters<typeof InvoiceService>[3],
    undefined,
    undefined,
    emailOnReady,
    routing,
  );
}

const ORDER_ID = '11111111-0000-4000-8000-000000000001';
const INVOICE_ID = '22222222-0000-4000-8000-000000000002';
const CHANNEL_ID = '33333333-0000-4000-8000-000000000003';

const PENDING_DETAIL = {
  id: INVOICE_ID,
  orderId: ORDER_ID,
  orderBusinessId: 'ORD-1',
  salesChannelId: CHANNEL_ID,
  kind: 'invoice',
  number: 'FV 1/2026',
  status: 'pending',
  currency: 'PLN',
  issuedAt: new Date('2026-08-17T10:00:00.000Z').toISOString(),
  saleDate: null,
  paymentDueDate: null,
  paymentMethod: null,
  netTotal: 100,
  taxTotal: 23,
  grossTotal: 123,
  paidTotal: 0,
  amountDue: 123,
  total: 123,
  originalInvoiceId: null,
  templateId: null,
  pdfAssetId: null,
  ksefReferenceNumber: null,
  ksefProcessedAt: null,
  lines: [],
  vatSummary: [],
  seller: {
    legalName: 'Seller',
    addressLine1: 'Street 1',
    addressLine2: '',
    postalCode: '00-000',
    city: 'City',
    country: 'PL',
    taxId: '1234567890',
    bankName: '',
    bankAccount: '',
    swift: '',
    email: '',
    phone: '',
  },
  buyer: {
    name: 'Buyer',
    taxId: '',
    addressLine1: '',
    addressLine2: '',
    postalCode: '',
    city: '',
    country: '',
  },
} satisfies InvoiceDetail;

describe('invoices — vendor number hold (mode B)', () => {
  it('keeps the invoice pending and does not send email when the vendor assigns the number', async () => {
    const emailed: string[] = [];
    const service = issueService(
      {
        numberingModeFor: async () => 'vendor',
        activeVendorModuleId: async () => 'infakt',
      },
      async (invoiceId) => {
        emailed.push(invoiceId);
      },
    );

    const detail = await service.issue('ord-1', 'invoice');

    expect(detail.status).toBe('pending');
    expect(detail.number).toBe('FV 1/2026');
    expect(emailed).toEqual([]);
  });

  it('issues ready when numbering stays with Endora', async () => {
    const service = issueService({
      numberingModeFor: async () => 'endora',
      activeVendorModuleId: async () => 'infakt',
    });

    const detail = await service.issue('ord-1', 'invoice');

    expect(detail.status).toBe('ready');
  });

  it('issues ready when vendor mode has no active ledger vendor', async () => {
    const service = issueService({
      numberingModeFor: async () => 'vendor',
      activeVendorModuleId: async () => null,
    });

    const detail = await service.issue('ord-1', 'invoice');

    expect(detail.status).toBe('ready');
  });
});

describe('invoices — send-on-issue skips a pending vendor hold', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not dispatch email when issue returns pending', async () => {
    const dispatch = vi.fn(async () => ({ sent: true }));
    const sendOnIssueEnabled = vi.fn(async () => true);
    const deps: InvoicesAdminDeps = {
      emFactory: (() => {
        throw new Error('the issue route must not touch the database in this test');
      }) as unknown as InvoicesAdminDeps['emFactory'],
      orderReadPort: new Proxy({} as InvoicesAdminDeps['orderReadPort'], {
        get() {
          throw new Error('the issue route must not read orders in this test');
        },
      }),
      requireAdmin: () => async () => undefined,
      invoiceService: {
        issue: vi.fn(async () => PENDING_DETAIL),
      } as unknown as InvoicesAdminDeps['invoiceService'],
      pdfRenderer: {} as InvoicePdfRenderer,
      templateService: {} as InvoiceTemplateService,
      emailDispatcher: {
        dispatch,
        sendOnIssueEnabled,
      } as unknown as InvoiceEmailDispatcher,
    };

    const app: FastifyInstance = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await registerInvoicesAdminRoutes(app, deps);
    await app.ready();
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/orders/${ORDER_ID}/invoices`,
        payload: { kind: 'invoice' },
      });
      expect(res.statusCode).toBe(201);
      expect((res.json() as { email: { status: string } }).email).toEqual({
        status: 'not_requested',
      });
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
