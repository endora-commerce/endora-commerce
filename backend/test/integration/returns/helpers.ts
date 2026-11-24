import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  DEFAULT_RETURN_STATUSES,
  computeDefaultTransitions,
} from '../../../../packages/modules/returns/src/backend/domain/return-status-graph.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { ReturnReason } from '../../helpers/package-entities.js';
import { Order, OrderItem } from '../../helpers/package-entities.js';

export const CUSTOMER_COOKIE = { b2b_session: 'stub-customer-session' };
export const ADMIN_COOKIE = { b2b_admin_session: 'stub-admin-session' };

/**
 * Restore the returns status graph to its seeded defaults. The status tables
 * are migration-seeded (not truncated between test files), and the US3 workflow
 * tests mutate them, so each returns test file resets the graph in `beforeAll`
 * to stay isolated regardless of file execution order.
 *
 * Only what differs from the defaults is touched: a status or transition the
 * defaults do not name is removed, and each default row is written back in
 * place (`on conflict … do update`), so the tables end as exactly the defaults
 * without emptying them first.
 */
export async function resetReturnGraph(em: EntityManager): Promise<void> {
  const statuses = DEFAULT_RETURN_STATUSES;
  const transitions = computeDefaultTransitions();
  const pairs = transitions.map(() => '("from_status_code" = ? and "to_status_code" = ?)').join(' or ');
  const pairParams = transitions.flatMap((t) => [t.fromStatusCode, t.toStatusCode]);
  await em.execute(`delete from "return_status_transitions" where not (${pairs})`, pairParams);
  await em.execute(
    `delete from "return_statuses" where "code" not in (${statuses.map(() => '?').join(', ')})`,
    statuses.map((s) => s.code),
  );
  const now = new Date();
  await em.execute(
    `insert into "return_statuses"
       ("id", "code", "name", "default_name", "is_initial", "is_terminal", "is_system", "weight", "color",
        "created_at", "updated_at")
     values ${statuses.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
     on conflict ("code") do update set
       "name" = excluded."name", "default_name" = excluded."default_name", "is_initial" = excluded."is_initial",
       "is_terminal" = excluded."is_terminal", "is_system" = excluded."is_system", "weight" = excluded."weight",
       "color" = excluded."color", "updated_at" = excluded."updated_at"`,
    statuses.flatMap((s) => [
      randomUUID(),
      s.code,
      JSON.stringify(s.name),
      s.defaultName,
      s.isInitial,
      s.isTerminal,
      s.isSystem,
      s.weight,
      s.color,
      now,
      now,
    ]),
  );
  await em.execute(
    `insert into "return_status_transitions" ("id", "from_status_code", "to_status_code", "is_system", "created_at")
     values ${transitions.map(() => '(?, ?, ?, ?, ?)').join(', ')}
     on conflict ("from_status_code", "to_status_code") do update set "is_system" = excluded."is_system"`,
    transitions.flatMap((t) => [randomUUID(), t.fromStatusCode, t.toStatusCode, t.isSystem, now]),
  );
}

export interface SeededOrder {
  orderId: string;
  itemIds: string[];
}

/** One seeded order line — feature 155 lets a test choose the quantity and the placement stamp. */
export interface SeededOrderLine {
  quantity: number;
  name?: string;
  productId?: string;
  /**
   * The line's `returnable_at_purchase` (feature 155, FR-016a). Omitted or
   * `null` = a line placed before the feature, which `returns` treats as
   * returnable (FR-025).
   */
  returnableAtPurchase?: boolean | null;
}

/**
 * Seed a completed order owned by the test customer with two lines
 * (quantities 3 and 1), or with `lines` when given. `status` defaults to
 * `completed` so the order is return-eligible; pass `new` to exercise the
 * not-eligible path.
 */
export async function seedReturnableOrder(
  em: EntityManager,
  opts: {
    status?: string;
    salesChannelId?: string;
    lines?: readonly SeededOrderLine[];
    /** `specs/170-organization-roles/` WP-14 — whose order it is; the test customer's by default. */
    organizationId?: string;
    placedByCustomerAccountId?: string;
  } = {},
): Promise<SeededOrder> {
  const order = em.create(Order, {
    organizationId: opts.organizationId ?? TEST_ORGANIZATION_ID,
    placedByCustomerAccountId: opts.placedByCustomerAccountId ?? TEST_CUSTOMER_ID,
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

  if (opts.lines) {
    const items = opts.lines.map((line, i) =>
      em.create(OrderItem, {
        orderId: order.id,
        productId: line.productId ?? randomUUID(),
        productSnapshot: { sku: `SKU-${i + 1}`, name: line.name ?? `Line ${i + 1}`, primaryAssetUrl: null },
        quantity: line.quantity,
        unitPrice: '10.00',
        taxRate: '0.0000',
        lineTotal: (10 * line.quantity).toFixed(2),
        returnableAtPurchase: line.returnableAtPurchase ?? null,
      }),
    );
    await em.persistAndFlush(items);
    return { orderId: order.id, itemIds: items.map((it) => it.id) };
  }

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
