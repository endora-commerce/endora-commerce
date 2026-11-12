import type { EntityManager } from '@mikro-orm/postgresql';
import { LockMode } from '@mikro-orm/core';
import type { z } from 'zod';
import {
  ERROR_CODES,
  isUuidShape,
  orderExternalReferenceSystemSchema,
  orderExternalReferenceWriteSchema,
  type AdminOrderExternalReference,
  type OrderExternalReference as OrderExternalReferenceRecord,
  type OrderExternalReferencePort,
  type OrderExternalReferenceWrite,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { Order } from '../entities/order.entity.js';
import { OrderExternalReference } from '../entities/order-external-reference.entity.js';

/** The audit action every recorded change carries. */
export const ORDER_EXTERNAL_REFERENCE_SET_ACTION = 'order.external_reference.set';

/**
 * `orderExternalReferencePort` (issue #1030) — what an integration records on
 * an order about the external system it hands the order to.
 *
 * **Refusals come first.** A system key or a value that fails the published
 * schema is a `400 VALIDATION_FAILED` before any Command runs; a malformed
 * order id is the `404 ORDER_NOT_FOUND` an unknown one is.
 *
 * **One Command per write, `order.external_reference.set`.** The order row is
 * read `for update` inside the Command's transaction, which both refuses an
 * order the caller's tenant context cannot see and serialises two writers of
 * the same order, so the unique `(order_id, system)` row is created once. A
 * write whose outcome equals the stored entry answers `skipAudit` and touches
 * nothing — a sync loop resends, and a resend is not a change.
 *
 * The reads are plain reads on the module's own entity, which is org-scoped:
 * the tenant filter is what confines them, and a malformed argument answers
 * empty rather than refusing.
 */
export class OrderExternalReferenceService implements OrderExternalReferencePort {
  constructor(private readonly deps: { emFactory: () => EntityManager; commandBus: CommandBus }) {}

  async set(
    orderId: string,
    system: string,
    value: OrderExternalReferenceWrite,
  ): Promise<OrderExternalReferenceRecord> {
    const key = parseOr400(orderExternalReferenceSystemSchema, system, 'system');
    const write = parseOr400(orderExternalReferenceWriteSchema, value, 'value');
    if (!isUuidShape(orderId)) throw orderNotFound();
    return this.deps.commandBus.run(setCommand(orderId, key, write));
  }

  async get(orderId: string, system: string): Promise<OrderExternalReferenceRecord | null> {
    if (!isUuidShape(orderId) || !orderExternalReferenceSystemSchema.safeParse(system).success) return null;
    const row = await this.deps.emFactory().findOne(OrderExternalReference, { orderId, system });
    return row ? toRecord(row) : null;
  }

  async listForOrder(orderId: string): Promise<OrderExternalReferenceRecord[]> {
    if (!isUuidShape(orderId)) return [];
    return (await listExternalReferenceRows(this.deps.emFactory(), orderId)).map(toRecord);
  }

  async findOrderIds(system: string, reference: string): Promise<string[]> {
    if (!orderExternalReferenceSystemSchema.safeParse(system).success || reference.length === 0) return [];
    const rows = await this.deps.emFactory().find(
      OrderExternalReference,
      { system, reference },
      { orderBy: { orderId: 'asc' } },
    );
    return rows.map((row) => row.orderId);
  }
}

/** Every system's entry for one order, by system key — the port's read and the admin detail's. */
export function listExternalReferenceRows(em: EntityManager, orderId: string): Promise<OrderExternalReference[]> {
  return em.find(OrderExternalReference, { orderId }, { orderBy: { system: 'asc' } });
}

/** The admin order detail's shape of one entry. */
export function toAdminExternalReference(row: OrderExternalReference): AdminOrderExternalReference {
  return { ...snapshot(row), updatedAt: row.updatedAt.toISOString() };
}

function setCommand(
  orderId: string,
  system: string,
  write: OrderExternalReferenceWrite,
): Command<OrderExternalReferenceRecord> {
  return {
    action: ORDER_EXTERNAL_REFERENCE_SET_ACTION,
    objectType: 'order',
    objectId: orderId,
    run: async ({ em }) => {
      const order = await em.findOne(Order, { id: orderId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      if (!order) throw orderNotFound();
      const existing = await em.findOne(OrderExternalReference, { orderId, system });
      const stored = existing ? snapshot(existing) : null;
      const next = {
        system,
        reference: write.reference === undefined ? (stored?.reference ?? null) : write.reference,
        state: write.state,
        message: write.message ?? null,
      };
      if (
        existing &&
        stored &&
        stored.reference === next.reference &&
        stored.state === next.state &&
        stored.message === next.message
      ) {
        return { result: toRecord(existing), skipAudit: true };
      }
      const row = existing ?? new OrderExternalReference();
      if (!existing) {
        row.organizationId = order.organizationId;
        row.orderId = orderId;
        row.system = system;
      }
      row.reference = next.reference;
      row.state = next.state;
      row.message = next.message;
      row.updatedAt = new Date();
      em.persist(row);
      await em.flush();
      return { result: toRecord(row), before: stored, after: { ...next } };
    },
  };
}

/** What an entry says, with the ORM's hydrated `undefined` read as the `null` it stores. */
function snapshot(row: OrderExternalReference): {
  system: string;
  reference: string | null;
  state: OrderExternalReferenceRecord['state'];
  message: string | null;
} {
  return { system: row.system, reference: row.reference ?? null, state: row.state, message: row.message ?? null };
}

function toRecord(row: OrderExternalReference): OrderExternalReferenceRecord {
  return { orderId: row.orderId, ...snapshot(row), updatedAt: row.updatedAt };
}

function orderNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.ORDER_NOT_FOUND, 'Order not found.');
}

function parseOr400<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      parsed.error.issues.map((i) => `${[label, ...i.path].join('.')}: ${i.message}`).join(' '),
      parsed.error.issues.map((i) => ({ path: [label, ...i.path].join('.'), issue: i.message })),
    );
  }
  return parsed.data;
}
