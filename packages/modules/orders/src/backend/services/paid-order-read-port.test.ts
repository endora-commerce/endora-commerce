import { describe, expect, it } from 'vitest';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import { paidOrderDetailSchema } from '@endora-commerce/contracts';
import { PaidOrderReadService } from './paid-order-read-port.js';

/**
 * `specs/182-related-payers/` T037 (FR-070, FR-071) — `paidOrderReadPort` reads the orders a
 * payer pays for under a system scope, constrained by `payer_organization_id`, and projects
 * them read-only: no delivery address, no customer note, no comment thread.
 */
const X = '00000000-0000-4000-8000-0000000000b1';
const Y = '00000000-0000-4000-8000-0000000000b2';
const Z = '00000000-0000-4000-8000-0000000000b3';

function order(id: string, payer: string | null, placedAt: string) {
  return {
    id,
    businessId: `B-${id.slice(-2)}`,
    organizationId: X,
    payerOrganizationId: payer,
    payerTerms: payer ? 'buyer' : null,
    payerSnapshot: payer ? { organizationId: payer, name: 'Payer SA', taxId: 'PL1234567890', vatStatus: 'vat_payer', billingAddress: {} } : null,
    status: 'new',
    paymentStatus: 'awaiting_payment',
    placedAt: new Date(placedAt),
    subtotal: '100.00',
    taxTotal: '23.00',
    discountTotal: '0.00',
    deliveryTotal: '10.00',
    total: '133.00',
    currency: 'PLN',
    customerNote: 'S182-NOTE call me',
    deliveryAddress: { recipientName: 'X', street: 'S182-STREET', city: 'W', postalCode: '00-001', country: 'PL', phone: '+48 600 182 182' },
    billingAddress: { recipientName: 'Payer SA', street: 'Płatnika 9', city: 'K', postalCode: '30-001', country: 'PL', phone: null, companyName: 'Payer SA', taxId: 'PL1234567890' },
    deliveryMethodSnapshot: { code: 'dpd', name: 'DPD', cost: 10 },
  };
}

const ORDERS = [
  order('00000000-0000-4000-8000-0000000000e1', Y, '2026-11-18T10:00:00.000Z'),
  order('00000000-0000-4000-8000-0000000000e2', Y, '2026-11-18T11:00:00.000Z'),
  order('00000000-0000-4000-8000-0000000000e3', Z, '2026-11-18T12:00:00.000Z'),
  order('00000000-0000-4000-8000-0000000000e4', null, '2026-11-18T13:00:00.000Z'),
];

function harness() {
  const modes: string[] = [];
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (typeof v === 'object' && v !== null ? true : row[k] === v));
  const em = {
    find: async (entity: { name: string }, where: Record<string, unknown>) => {
      modes.push(getTenantContext()?.mode ?? 'none');
      if (entity.name === 'Order') {
        const { $or, ...rest } = where as { $or?: Array<Record<string, { $lt?: unknown } | unknown>> };
        const cursorAt = $or ? (($or[0]!['placedAt'] as { $lt: Date }).$lt).getTime() : null;
        return ORDERS.filter((o) => matches(o as unknown as Record<string, unknown>, rest))
          .filter((o) => cursorAt === null || o.placedAt.getTime() < cursorAt)
          .sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime());
      }
      if (entity.name === 'OrderItem') {
        return [
          {
            id: '00000000-0000-4000-8000-0000000000f1',
            orderId: where['orderId'],
            productId: '00000000-0000-4000-8000-0000000000f2',
            productSnapshot: { sku: 'S1', name: 'Screw', primaryAssetUrl: null },
            variantId: null,
            variantSnapshot: null,
            quantity: 2,
            unitPrice: '50.00',
            taxRate: '0.23',
            lineTotal: '100.00',
            groupId: null,
            position: 0,
          },
        ];
      }
      return [];
    },
    findOne: async (entity: { name: string }, where: Record<string, unknown>) => {
      modes.push(getTenantContext()?.mode ?? 'none');
      if (entity.name === 'OrderStatus') return { code: 'new', defaultName: 'New', name: { en: 'New' } };
      if (entity.name === 'Order') return ORDERS.find((o) => matches(o as unknown as Record<string, unknown>, where)) ?? null;
      return null;
    },
  };
  const service = new PaidOrderReadService({
    emFactory: () => em as never,
    organizations: { findByIds: async (ids: readonly string[]) => ids.map((id) => ({ id, name: `Org ${id.slice(-2)}`, legalName: null })) as never },
    invoiceRead: () => ({
      listForOrder: async (orderId: string) =>
        orderId === ORDERS[0]!.id ? ([{ id: '00000000-0000-4000-8000-0000000000a9', number: 'FV/1/2026', kind: 'invoice', status: 'ready' }] as never) : [],
    }),
  });
  return { service, modes };
}

describe('PaidOrderReadService (paidOrderReadPort)', () => {
  it('lists only the orders naming the payer, newest first, under a system scope', async () => {
    const { service, modes } = harness();
    const page = await service.list(Y, { limit: 20 });
    expect(page.items.map((o) => o.id)).toEqual([ORDERS[1]!.id, ORDERS[0]!.id]);
    expect(page.items[0]).toMatchObject({ buyerOrganizationId: X, total: 133, currency: 'PLN', statusLabel: 'New' });
    expect(page.hasMore).toBe(false);
    expect(new Set(modes)).toEqual(new Set(['system']));
  });

  it('answers null for an order that does not name the payer — another payer\'s, or none', async () => {
    const { service } = harness();
    expect(await service.find(Y, ORDERS[2]!.id)).toBeNull();
    expect(await service.find(Y, ORDERS[3]!.id)).toBeNull();
    expect(await service.find(Z, ORDERS[0]!.id)).toBeNull();
  });

  it('projects the order read-only: no delivery address or phone, no note, no comments', async () => {
    const { service } = harness();
    const detail = await service.find(Y, ORDERS[0]!.id);
    expect(paidOrderDetailSchema.parse(detail)).toEqual(detail);
    const json = JSON.stringify(detail);
    expect(json).not.toContain('S182-NOTE');
    expect(json).not.toContain('+48 600 182 182');
    expect(json).not.toContain('S182-STREET');
    expect(detail).not.toHaveProperty('comments');
    expect(detail).toMatchObject({
      payer: { organizationId: Y, terms: 'buyer' },
      deliveryMethodName: 'DPD',
      invoices: [{ id: '00000000-0000-4000-8000-0000000000a9', number: 'FV/1/2026' }],
      items: [{ quantity: 2, unitPrice: 50, lineTotal: 100 }],
    });
  });

  it('pages by a cursor', async () => {
    const { service } = harness();
    const first = await service.list(Y, { limit: 1 });
    expect(first.items.map((o) => o.id)).toEqual([ORDERS[1]!.id]);
    expect(first.hasMore).toBe(true);
    const second = await service.list(Y, { limit: 1, cursor: first.cursor! });
    expect(second.items.map((o) => o.id)).toEqual([ORDERS[0]!.id]);
  });
});
