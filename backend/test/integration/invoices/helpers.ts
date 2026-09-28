import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import type { BackendServerHandle } from '../../helpers/test-server.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { Order, OrderItem } from '../../helpers/package-entities.js';

export const CUSTOMER_COOKIE = { b2b_session: 'stub-customer-session' };
export const ADMIN_COOKIE = { b2b_admin_session: 'stub-admin-session' };

export interface SeededInvoiceOrder {
  orderId: string;
  salesChannelId: string;
  /** The seeded order items, in line order — the link an invoice line snapshots. */
  itemIds: [string, string];
}

/**
 * Seed a paid order owned by the test customer with two 23%-VAT lines
 * (net 900 + net 4505 = 5405 net, 6648.15 gross — matches the reference invoice).
 * `lineTaxRate` re-rates both product lines, so a genuinely zero-rated original
 * is expressible without a second seeder.
 */
export async function seedInvoiceableOrder(
  em: EntityManager,
  opts: {
    salesChannelId?: string;
    paymentStatus?: 'paid' | 'awaiting_payment';
    deliveryTotal?: number;
    discountTotal?: number;
    organizationId?: string;
    placedByCustomerAccountId?: string;
    lineTaxRate?: number;
    /**
     * Packaging unit name for the first line, e.g. `opak.`. Left unset the item
     * carries no packaging snapshot and issuance falls back to `szt.`.
     */
    packagingUnitName?: string;
  } = {},
): Promise<SeededInvoiceOrder> {
  // Feature 078, D-95: `{channel}` renders the `sales_channels` row, so an
  // order has to be seeded on a channel that exists. See
  // `systemDefaultSalesChannelId` for why this is not a fallback.
  const salesChannelId = opts.salesChannelId ?? (await systemDefaultSalesChannelId(em));
  const deliveryTotal = opts.deliveryTotal ?? 0;
  const discountTotal = opts.discountTotal ?? 0;
  const lineTaxRate = opts.lineTaxRate ?? 0.23;
  // Base products: net 5405, VAT 1243.15 at the default 23%. Order model adds
  // delivery and subtracts discount on the gross without extra VAT.
  const productNet = 5405;
  const productTax = Math.round((productNet * lineTaxRate + Number.EPSILON) * 100) / 100;
  const total = productNet + productTax + deliveryTotal - discountTotal;
  const order = em.create(Order, {
    organizationId: opts.organizationId ?? TEST_ORGANIZATION_ID,
    placedByCustomerAccountId: opts.placedByCustomerAccountId ?? TEST_CUSTOMER_ID,
    salesChannelId,
    status: 'paid',
    paymentStatus: opts.paymentStatus ?? 'paid',
    deliveryAddress: { recipientName: 'Example Buyer', street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-002', country: 'PL' },
    billingAddress: {
      recipientName: 'Jan Kowalski',
      street: 'ul. Testowa 1',
      city: 'Warszawa',
      postalCode: '00-002',
      country: 'PL',
      companyName: 'Example Buyer Sp. z o.o.',
      taxId: '1111111111',
    },
    deliveryMethodId: randomUUID(),
    deliveryMethodSnapshot: { code: 'dm', name: 'Kurier', cost: 0 },
    paymentMethodId: randomUUID(),
    paymentMethodSnapshot: { code: 'pm', name: 'Przelew', kind: 'bank_transfer' },
    subtotal: productNet.toFixed(2),
    taxTotal: productTax.toFixed(2),
    deliveryTotal: deliveryTotal.toFixed(2),
    discountTotal: discountTotal.toFixed(2),
    total: total.toFixed(2),
    currency: 'PLN',
    placedAt: new Date(),
  });
  await em.persistAndFlush(order);

  const item1 = em.create(OrderItem, {
    orderId: order.id,
    productId: randomUUID(),
    productSnapshot: { sku: 'TM-1', name: 'Example Server', primaryAssetUrl: null },
    quantity: 1,
    unitPrice: '900.00',
    taxRate: lineTaxRate.toFixed(4),
    lineTotal: '900.00',
    ...(opts.packagingUnitName
      ? { packagingUnitSnapshot: { name: opts.packagingUnitName, baseQuantity: 1 } }
      : {}),
  });
  const item2 = em.create(OrderItem, {
    orderId: order.id,
    productId: randomUUID(),
    productSnapshot: { sku: 'TM-2', name: 'Example Labour Hours', primaryAssetUrl: null },
    quantity: 27,
    unitPrice: '170.00',
    taxRate: lineTaxRate.toFixed(4),
    lineTotal: '4505.00',
  });
  await em.persistAndFlush([item1, item2]);

  return { orderId: order.id, salesChannelId, itemIds: [item1.id, item2.id] };
}

/** Configure the seller (own company) settings globally so issuance is allowed. */
export async function setSellerSettings(h: BackendServerHandle): Promise<void> {
  const audit = { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };
  await h.settings.adminService.setValueForAllChannels('invoices.seller.tax_id', '1234567890', null, audit);
  await h.settings.adminService.setValueForAllChannels(
    'invoices.seller.company_data',
    {
      legalName: 'Example Seller Sp. z o.o.',
      addressLine1: 'ul. Przykładowa 2',
      postalCode: '00-001',
      city: 'Warszawa',
      country: 'PL',
      bankName: 'Example Bank S.A.',
      bankAccount: '00 1234 5678 0000 0000 0000 0000',
      swift: 'EXMPPLPW',
    },
    null,
    audit,
  );
}

/** Clear the seller settings so the missing-settings guard can be exercised. */
export async function clearSellerSettings(h: BackendServerHandle): Promise<void> {
  const audit = { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };
  await h.settings.adminService.setValueForAllChannels('invoices.seller.tax_id', '', null, audit);
  await h.settings.adminService.setValueForAllChannels('invoices.seller.company_data', {}, null, audit);
}
