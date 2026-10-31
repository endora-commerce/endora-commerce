import { readFileSync } from 'node:fs';

import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  OrderItemRecord,
  OrderReadPort,
  OrderRecord,
  SupportedLanguage,
} from '@endora-commerce/contracts';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { describe, expect, it } from 'vitest';

import { InvoiceService } from './invoice-service.js';

/**
 * Issue #95 (`invoices`) — the lines an invoice itemises beside the products
 * (delivery, the payment-method surcharge, the discount) were named in Polish
 * whatever the invoice's language. The name is stored with the line, so it is
 * written in the invoice's language at issue, from this module's bundle. The
 * Polish names are the ones every issued invoice carried.
 */

const bundle = (language: SupportedLanguage): Record<string, string> =>
  JSON.parse(
    readFileSync(new URL(`../../../i18n/${language}.json`, import.meta.url), 'utf8'),
  ) as Record<string, string>;

const bundleTranslate = (key: string, language: SupportedLanguage): Promise<string> =>
  Promise.resolve(bundle(language)[key] ?? bundle('en')[key] ?? `invoices.${key}`);

function recordingEm(): { emFactory: () => EntityManager; lines: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = [];
  let invoice: Record<string, unknown> | null = null;
  const create = (_entity: unknown, data: Record<string, unknown>): Record<string, unknown> => {
    if ('ordinal' in data) {
      const line = { id: `line-${lines.length + 1}`, ...data };
      lines.push(line);
      return line;
    }
    invoice = { id: 'inv-1', ...data };
    return invoice;
  };
  const tx = { create, persistAndFlush: async () => {}, flush: async () => {} };
  const em = {
    create,
    findOne: async (_entity: unknown, where: Record<string, unknown>) =>
      where['id'] === undefined ? null : invoice,
    find: async () => lines,
    transactional: async <T>(cb: (t: unknown) => Promise<T>): Promise<T> => cb(tx),
  } as unknown as EntityManager;
  return { emFactory: () => em, lines };
}

const order = {
  id: 'ord-1',
  businessId: 'ORD-1',
  organizationId: 'org-1',
  salesChannelId: 'ch-1',
  status: 'placed',
  paymentStatus: 'unpaid',
  billingAddress: {
    recipientName: 'Buyer',
    companyName: 'Buyer sp. z o.o.',
    taxId: '1234567890',
    street: 'Main 1',
    postalCode: '00-001',
    city: 'Warsaw',
    country: 'PL',
  },
  paymentMethodSnapshot: { code: 'cod', name: 'Cash on delivery', kind: 'cod', additionalPrice: 5 },
  subtotal: '100.00',
  taxTotal: '23.00',
  discountTotal: '10.00',
  deliveryTotal: '15.00',
  total: '133.00',
  currency: 'PLN',
} as unknown as OrderRecord;

const item = {
  id: 'oi-1',
  orderId: 'ord-1',
  productId: 'p-1',
  productSnapshot: { sku: 'SKU-1', name: 'Widget' },
  packagingUnitSnapshot: null,
  quantity: 2,
  unitPrice: '50.00',
  taxRate: '0.23',
  lineTotal: '123.00',
} as unknown as OrderItemRecord;

const readPort = {
  findById: async () => order,
  listItems: async () => [item],
} as unknown as OrderReadPort;

async function issuedLines(prose: ConstructorParameters<typeof InvoiceService>[10]) {
  const { emFactory, lines } = recordingEm();
  const service = new InvoiceService(
    emFactory,
    readPort,
    { next: async () => 'FV 1/2026' } as unknown as ConstructorParameters<typeof InvoiceService>[2],
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
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    prose,
  );
  await withSystemScope('invoices line-name unit test', () => service.issue('ord-1', 'invoice'));
  return lines.map((line) => [line['name'], line['unit']]);
}

describe('invoices — the names of the lines beside the products', () => {
  it('names them in Polish, as every issued invoice did, on a Polish invoice', async () => {
    expect(await issuedLines({ translate: bundleTranslate, language: 'pl' })).toEqual([
      ['Widget', 'szt.'],
      ['Dostawa', 'usł.'],
      ['Dopłata za metodę płatności', 'usł.'],
      ['Rabat', 'usł.'],
    ]);
  });

  it('writes the invoice language by default — Polish (owner answer N5)', async () => {
    expect(await issuedLines({ translate: bundleTranslate })).toContainEqual([
      'Dopłata za metodę płatności',
      'usł.',
    ]);
  });

  it('names them in English on an English invoice', async () => {
    expect(await issuedLines({ translate: bundleTranslate, language: 'en' })).toEqual([
      ['Widget', 'pcs'],
      ['Delivery', 'svc'],
      ['Payment method surcharge', 'svc'],
      ['Discount', 'svc'],
    ]);
  });

  it('names them in English in code when no translator is wired', async () => {
    expect(await issuedLines({})).toContainEqual(['Payment method surcharge', 'svc']);
  });
});
