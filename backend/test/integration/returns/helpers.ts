import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import { OrderItem } from '../../../src/modules/orders/entities/order-item.entity.js';
import {
  DEFAULT_RETURN_STATUSES,
  computeDefaultTransitions,
} from '../../../../packages/modules/returns/src/backend/domain/return-status-graph.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { ReturnReason } from '../../helpers/package-entities.js';

export const CUSTOMER_COOKIE = { b2b_session: 'stub-customer-session' };
export const ADMIN_COOKIE = { b2b_admin_session: 'stub-admin-session' };

/**
 * Restore the returns status graph to its seeded defaults. The status tables
 * are migration-seeded (not truncated between test files), and the US3 workflow
 * tests mutate them, so each returns test file resets the graph in `beforeAll`
 * to stay isolated regardless of file execution order.
 */
export async function resetReturnGraph(em: EntityManager): Promise<void> {
  const knex = em.getKnex();
  await knex('return_status_transitions').del();
  await knex('return_statuses').del();
  const now = new Date();
  await knex('return_statuses').insert(
    DEFAULT_RETURN_STATUSES.map((s) => ({
      id: randomUUID(),
      code: s.code,
      name: JSON.stringify(s.name),
      default_name: s.defaultName,
      is_initial: s.isInitial,
      is_terminal: s.isTerminal,
      is_system: s.isSystem,
      weight: s.weight,
      color: s.color,
      created_at: now,
      updated_at: now,
    })),
  );
  await knex('return_status_transitions').insert(
    computeDefaultTransitions().map((t) => ({
      id: randomUUID(),
      from_status_code: t.fromStatusCode,
      to_status_code: t.toStatusCode,
      is_system: t.isSystem,
      created_at: now,
    })),
  );
}

export interface SeededOrder {
  orderId: string;
  itemIds: string[];
}

/**
 * Seed a completed order owned by the test customer with two lines
 * (quantities 3 and 1). `status` defaults to `completed` so the order is
 * return-eligible; pass `new` to exercise the not-eligible path.
 */
export async function seedReturnableOrder(
  em: EntityManager,
  opts: { status?: string; salesChannelId?: string } = {},
): Promise<SeededOrder> {
  const order = em.create(Order, {
    organizationId: TEST_ORGANIZATION_ID,
    placedByCustomerAccountId: TEST_CUSTOMER_ID,
    // Feature 078, D-95: `{channel}` renders the `sales_channels` row, so an
    // order has to be seeded on a channel that exists. This used to be
    // `randomUUID()` with a note telling every caller to pin one channel per
    // file, because two orders on two fresh channels both drew sequence 1 and
    // the second issuance died on `invoices_number_unique`. The pattern carries
    // the channel now, so the constraint that produced that note is gone.
    salesChannelId: opts.salesChannelId ?? (await systemDefaultSalesChannelId(em)),
    status: opts.status ?? 'completed',
    deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
    billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
    deliveryMethodId: randomUUID(),
    deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
    paymentMethodId: randomUUID(),
    paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer' },
    subtotal: '300.00',
    taxTotal: '0.00',
    deliveryTotal: '0.00',
    total: '300.00',
    currency: 'PLN',
    placedAt: new Date(),
  });
  await em.persistAndFlush(order);

  const item1 = em.create(OrderItem, {
    orderId: order.id,
    productId: randomUUID(),
    productSnapshot: { sku: 'SKU-1', name: 'Widget', primaryAssetUrl: null },
    quantity: 3,
    unitPrice: '100.00',
    taxRate: '0.0000',
    lineTotal: '300.00',
  });
  const item2 = em.create(OrderItem, {
    orderId: order.id,
    productId: randomUUID(),
    productSnapshot: { sku: 'SKU-2', name: 'Gadget', primaryAssetUrl: null },
    quantity: 1,
    unitPrice: '50.00',
    taxRate: '0.0000',
    lineTotal: '50.00',
  });
  await em.persistAndFlush([item1, item2]);

  return { orderId: order.id, itemIds: [item1.id, item2.id] };
}

/** Pick a seeded active reason id applicable to returns. */
export async function anyReasonId(em: EntityManager): Promise<string> {
  const reason = await em.findOneOrFail(ReturnReason, { isActive: true });
  return reason.id;
}
