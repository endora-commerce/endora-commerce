import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { Order } from '../entities/order.entity.js';
import { OrderExternalReference } from '../entities/order-external-reference.entity.js';
import { OrderExternalReferenceService } from './order-external-reference-service.js';

/**
 * Issue #1030 — `orderExternalReferencePort`, held here to its decisions over
 * an in-memory stand-in for the Command's `EntityManager`: what it refuses
 * before any Command runs, what a write records, and that a write changing
 * nothing records nothing. The same port against PostgreSQL, the tenant
 * filter and the real Command Bus is
 * `backend/test/contract/orders/external-reference-port.test.ts`.
 */

const ORDER_ID = '00000000-0000-4000-8000-0000000000a1';
const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000b1';

interface AuditEntry {
  action: string;
  objectType: string;
  objectId: string;
  before: unknown;
  after: unknown;
}

function harness(orders: Array<{ id: string; organizationId: string }> = [{ id: ORDER_ID, organizationId: ORGANIZATION_ID }]) {
  const rows: OrderExternalReference[] = [];
  const audit: AuditEntry[] = [];
  const commands: string[] = [];
  const matches = (row: OrderExternalReference, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value);
  const em = {
    async findOne(entity: unknown, where: Record<string, unknown>) {
      if (entity === Order) return orders.find((o) => o.id === where['id']) ?? null;
      if (entity === OrderExternalReference) return rows.find((r) => matches(r, where)) ?? null;
      throw new Error('unexpected entity');
    },
    async find(entity: unknown, where: Record<string, unknown>) {
      if (entity !== OrderExternalReference) throw new Error('unexpected entity');
      return rows.filter((r) => matches(r, where)).sort((a, b) => a.system.localeCompare(b.system));
    },
    persist(row: OrderExternalReference) {
      if (!rows.includes(row)) rows.push(row);
    },
    async flush() {},
  } as unknown as EntityManager;
  const commandBus = {
    async run<T>(command: Command<T>): Promise<T> {
      commands.push(command.action);
      const outcome = await command.run({
        em,
        actor: { actorAdminUserId: null, impersonatedCustomerAccountId: null, kind: 'system' },
      });
      if (!outcome.skipAudit) {
        audit.push({
          action: command.action,
          objectType: command.objectType,
          objectId: command.objectId,
          before: outcome.before ?? null,
          after: outcome.after ?? null,
        });
      }
      return outcome.result;
    },
  } as unknown as CommandBus;
  const port = new OrderExternalReferenceService({ emFactory: () => em, commandBus });
  return { port, rows, audit, commands };
}

const refusal = async (call: Promise<unknown>) => {
  try {
    await call;
  } catch (error) {
    return error as { statusCode?: number; code?: string };
  }
  throw new Error('expected a refusal');
};

describe('OrderExternalReferenceService (issue #1030)', () => {
  it('records a first entry as one audited Command naming the order', async () => {
    const { port, audit } = harness();
    const answer = await port.set(ORDER_ID, 'erp_connector', { state: 'pending' });
    expect(answer).toMatchObject({
      orderId: ORDER_ID,
      system: 'erp_connector',
      reference: null,
      state: 'pending',
      message: null,
    });
    expect(answer.updatedAt).toBeInstanceOf(Date);
    expect(audit).toEqual([
      {
        action: 'order.external_reference.set',
        objectType: 'order',
        objectId: ORDER_ID,
        before: null,
        after: { system: 'erp_connector', reference: null, state: 'pending', message: null },
      },
    ]);
  });

  it('records each change with the state before it', async () => {
    const { port, audit } = harness();
    await port.set(ORDER_ID, 'erp_connector', { state: 'pending' });
    await port.set(ORDER_ID, 'erp_connector', { state: 'synced', reference: 'ZS/1042' });
    expect(audit[1]).toMatchObject({
      before: { system: 'erp_connector', reference: null, state: 'pending', message: null },
      after: { system: 'erp_connector', reference: 'ZS/1042', state: 'synced', message: null },
    });
  });

  it('records nothing, and keeps `updatedAt`, when a resend changes nothing', async () => {
    const { port, audit } = harness();
    const first = await port.set(ORDER_ID, 'erp_connector', { state: 'error', message: 'Item 1042 is blocked for sale' });
    const again = await port.set(ORDER_ID, 'erp_connector', { state: 'error', message: 'Item 1042 is blocked for sale' });
    expect(audit).toHaveLength(1);
    expect(again).toEqual(first);
  });

  it('keeps the stored reference when a write omits it, and clears it on `null`', async () => {
    const { port } = harness();
    await port.set(ORDER_ID, 'erp_connector', { state: 'synced', reference: 'ZS/1042' });
    expect((await port.set(ORDER_ID, 'erp_connector', { state: 'error', message: 'Cancelled in ERP' })).reference).toBe(
      'ZS/1042',
    );
    expect((await port.set(ORDER_ID, 'erp_connector', { state: 'pending', reference: null })).reference).toBeNull();
  });

  it('drops a stale message when a write omits it', async () => {
    const { port } = harness();
    await port.set(ORDER_ID, 'erp_connector', { state: 'error', message: 'Item 1042 is blocked for sale' });
    expect((await port.set(ORDER_ID, 'erp_connector', { state: 'synced', reference: 'ZS/1042' })).message).toBeNull();
  });

  it('keeps one entry per system', async () => {
    const { port, rows } = harness();
    await port.set(ORDER_ID, 'wms', { state: 'pending' });
    await port.set(ORDER_ID, 'erp_connector', { state: 'synced', reference: 'ZS/1042' });
    await port.set(ORDER_ID, 'erp_connector', { state: 'synced', reference: 'ZS/1043' });
    expect(rows).toHaveLength(2);
    expect((await port.listForOrder(ORDER_ID)).map((r) => r.system)).toEqual(['erp_connector', 'wms']);
    expect(await port.get(ORDER_ID, 'wms')).toMatchObject({ state: 'pending' });
    expect(await port.get(ORDER_ID, 'nobody')).toBeNull();
    expect(await port.findOrderIds('erp_connector', 'ZS/1043')).toEqual([ORDER_ID]);
    expect(await port.findOrderIds('wms', 'ZS/1043')).toEqual([]);
  });

  it('refuses an unknown order with ORDER_NOT_FOUND, and a malformed id the same way', async () => {
    const { port, rows, audit } = harness([]);
    for (const id of [ORDER_ID, 'not-a-uuid']) {
      expect(await refusal(port.set(id, 'erp_connector', { state: 'pending' }))).toMatchObject({
        statusCode: 404,
        code: 'ORDER_NOT_FOUND',
      });
    }
    expect(rows).toHaveLength(0);
    expect(audit).toHaveLength(0);
  });

  it('refuses a malformed system key or value before running any Command', async () => {
    const { port, commands } = harness();
    const invalid = [
      port.set(ORDER_ID, 'ERP Connector', { state: 'pending' }),
      port.set(ORDER_ID, 'erp_connector', { state: 'error', message: 'x'.repeat(1001) }),
      port.set(ORDER_ID, 'erp_connector', { state: 'error', message: 'bad\u0000byte' }),
      port.set(ORDER_ID, 'erp_connector', { state: 'unknown' as 'pending' }),
      port.set(ORDER_ID, 'erp_connector', { state: 'synced', reference: '' }),
    ];
    for (const call of invalid) {
      expect(await refusal(call)).toMatchObject({ statusCode: 400, code: 'VALIDATION_FAILED' });
    }
    expect(commands).toEqual([]);
  });

  it('answers the reads for an unknown or malformed order and system with nothing', async () => {
    const { port } = harness();
    expect(await port.get('not-a-uuid', 'erp_connector')).toBeNull();
    expect(await port.get(ORDER_ID, 'Not A Key')).toBeNull();
    expect(await port.listForOrder('not-a-uuid')).toEqual([]);
    expect(await port.findOrderIds('Not A Key', 'ZS/1042')).toEqual([]);
  });
});
