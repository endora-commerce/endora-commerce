/**
 * The audit-state rule for Orders (`specs/conventions/audit-state.md`, D-288,
 * issue #470): the platform audit log carries **names and structure** of an
 * Order, never its values. No Order history reads values back out of the audit
 * log — the one reader, the buyer-cancellation predicate, reads
 * `stateAfter.status`, a code — so the values are not stored anywhere else:
 * the Order row holds the current ones.
 *
 * The two Commands run through the **real** `CommandBus` with a recording
 * audit port; the EntityManager is an in-memory stand-in, because what is
 * under test is what the Command hands the bus, not SQL. The two placements
 * record through the audit port directly (they are not Commands), so their
 * state builders are held to the same sentinels.
 */
import { AssertionError } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CommandBus } from '@endora-commerce/platform/commands';
import type { RecordAuditInput } from '@endora-commerce/platform/kernel';
import { withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import type { OrderLineLayout } from '../domain/quote-line-groups.js';
import { Order } from '../entities/order.entity.js';
import {
  ORDER_AUDIT_KEYS,
  apiKeyPlacementAuditState,
  orderCustomFieldsUpdateCommand,
  placeOnBehalfAuditState,
} from './order-audit-state.js';
import { OrderCustomFieldCarryReceiver } from './order-custom-field-carry-receiver.js';

// ---------------------------------------------------------------------------
// The sentinel assertion. A local copy of `expectNoAuditValues` from
// `@endora-commerce/test-kit/audit` (#1004): this branch is not stacked on it.
// Replace this block with the import once #1004 has merged.
// ---------------------------------------------------------------------------
type Sentinel = string | number;
type AuditState = Pick<RecordAuditInput, 'action' | 'stateBefore' | 'stateAfter'>;

function leaksOf(entries: readonly AuditState[], sentinels: readonly Sentinel[]): string[] {
  const leaks: string[] = [];
  const hit = (text: string, sentinel: Sentinel) =>
    typeof sentinel === 'number' ? text.includes(String(sentinel)) : text.toLowerCase().includes(sentinel.toLowerCase());
  const walk = (value: unknown, path: string): void => {
    if (value === null || value === undefined || value instanceof Date) return;
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${path}[${index}]`));
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        for (const sentinel of sentinels) if (typeof sentinel === 'string' && hit(key, sentinel)) leaks.push(`${path}{${key}}`);
        walk(child, `${path}.${key}`);
      }
      return;
    }
    for (const sentinel of sentinels) {
      if (typeof value === 'number' ? value === sentinel : hit(String(value), sentinel)) {
        leaks.push(`${path} = ${JSON.stringify(value)}`);
      }
    }
  };
  entries.forEach((entry, index) => {
    walk(entry.stateBefore, `[${index}] ${entry.action} stateBefore`);
    walk(entry.stateAfter, `[${index}] ${entry.action} stateAfter`);
  });
  return leaks;
}

function expectNoAuditValues(entries: readonly AuditState[], sentinels: readonly Sentinel[]): void {
  if (entries.length === 0) throw new AssertionError({ message: 'no audit entry to inspect' });
  const leaks = leaksOf(entries, sentinels);
  if (leaks.length > 0) {
    throw new AssertionError({ message: `the audit log carries tenant-scoped values:\n  ${leaks.join('\n  ')}` });
  }
}
// ---------------------------------------------------------------------------

const ADMIN = '00000000-0000-4000-8000-0000000004a1';
const ORG = randomUUID();
const CONTACT = randomUUID();
const OPPORTUNITY = randomUUID();

const S = {
  customField: 'S470-CF',
  customFieldNew: 'S470-CF-NEW',
  carried: 'S470-CF-CARRIED',
  group: 'S470-GROUP',
  total: '470470.47',
  currency: 'XTS',
} as const;

const SENTINELS: readonly Sentinel[] = [...Object.values(S), 470470.47, ORG, CONTACT];

function topLevelKeys(entries: readonly AuditState[]): string[] {
  return [
    ...new Set(entries.flatMap((entry) => [...Object.keys(entry.stateBefore ?? {}), ...Object.keys(entry.stateAfter ?? {})])),
  ].sort();
}

type Row = Record<string, unknown>;

/** Enough of MikroORM's EntityManager for the two Commands, keyed by class name. */
class FakeEm {
  readonly tables = new Map<string, Row[]>();

  table(name: string): Row[] {
    let rows = this.tables.get(name);
    if (!rows) this.tables.set(name, (rows = []));
    return rows;
  }

  seed<T extends object>(entity: new () => T, data: Partial<T>): T {
    return this.create(entity, data);
  }

  create<T extends object>(entity: new () => T, data: Partial<T>): T {
    const row = Object.assign(new entity(), data);
    this.table(entity.name).push(row as Row);
    return row;
  }

  persist(row: object): this {
    const rows = this.table(row.constructor.name);
    if (!rows.includes(row as Row)) rows.push(row as Row);
    return this;
  }

  async findOne(entity: { name: string }, where: Row): Promise<Row | null> {
    return this.table(entity.name).find((row) => Object.entries(where).every(([k, v]) => row[k] === v)) ?? null;
  }

  async flush(): Promise<void> {}

  async transactional<T>(fn: (em: FakeEm) => Promise<T>): Promise<T> {
    return fn(this);
  }

  fork(): this {
    return this;
  }
}

function harness() {
  const em = new FakeEm();
  const entries: RecordAuditInput[] = [];
  const audit = {
    recordWithin: (_em: unknown, input: RecordAuditInput) => {
      entries.push(structuredClone(input));
      return input as never;
    },
    record: async () => {
      throw new Error('a Command records through recordWithin');
    },
  };
  const events = { run: async <T>(fn: () => Promise<T>) => fn(), emit: vi.fn() };
  const commandBus = new CommandBus({ em } as never, audit as never, events as never);
  return { em, entries, commandBus };
}

function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
  return withSystemScopeActingFor(ADMIN, 'orders audit-state sentinel test', fn);
}

function seedOrder(em: FakeEm, customFieldValues: Record<string, unknown>): Order {
  return em.seed(Order, {
    id: randomUUID(),
    businessId: 'ORD-000470',
    organizationId: ORG,
    placedByCustomerAccountId: CONTACT,
    status: 'new',
    total: S.total,
    currency: S.currency,
    customFieldValues,
  } as Partial<Order>);
}

describe('orders audit state carries names, never values (#470)', () => {
  it('order.custom_fields.update — names the changed keys, never their values', async () => {
    const h = harness();
    const order = seedOrder(h.em, { risk: S.customField, source: 'S470-CF-KEPT' });
    const merge = {
      validateAndMerge: async (_type: string, current: Record<string, unknown>, patch: Record<string, unknown>) => ({
        ...current,
        ...patch,
      }),
    };

    await asAdmin(() =>
      h.commandBus.run(orderCustomFieldsUpdateCommand(order.id, { risk: S.customFieldNew, channel: S.carried }, merge)),
    );

    expectNoAuditValues(h.entries, [...SENTINELS, 'S470-CF-KEPT']);
    const [entry] = h.entries;
    expect(entry?.action).toBe('order.custom_fields.update');
    expect(entry?.stateAfter).toEqual({ changedCustomFields: ['channel', 'risk'] });
    expect(order.customFieldValues).toEqual({ risk: S.customFieldNew, source: 'S470-CF-KEPT', channel: S.carried });
    expect(topLevelKeys(h.entries).filter((key) => !ORDER_AUDIT_KEYS.has(key))).toEqual([]);
  });

  it('order.custom_fields.carry — names the carried keys, never their values', async () => {
    const h = harness();
    const order = seedOrder(h.em, { risk: S.customField });
    const receiver = new OrderCustomFieldCarryReceiver({
      commandBus: h.commandBus,
      customFieldCarry: {
        plan: async ({ sourceValues, targetValues }) => ({
          values: { ...targetValues, channel: sourceValues.channel },
          carried: ['channel'],
          skipped: [{ key: 'risk', reason: 'target_not_empty' as never }],
        }),
      } as never,
    });

    const receipt = await asAdmin(() =>
      receiver.receiveCarriedValues({
        recordId: order.id,
        organizationId: ORG,
        source: {
          entityType: 'opportunity',
          recordId: OPPORTUNITY,
          reference: 'OPP-000470',
          values: { channel: S.carried, risk: S.customFieldNew },
        },
      }),
    );

    expect(receipt.outcome).toBe('applied');
    expectNoAuditValues(h.entries, SENTINELS);
    const [entry] = h.entries;
    expect(entry?.action).toBe('order.custom_fields.carry');
    expect(entry?.stateAfter).toMatchObject({
      changedCustomFields: ['channel'],
      customFieldCarry: { carried: ['channel'], skipped: [{ key: 'risk' }], source: { reference: 'OPP-000470' } },
    });
    expect(order.customFieldValues).toEqual({ risk: S.customField, channel: S.carried });
    expect(topLevelKeys(h.entries).filter((key) => !ORDER_AUDIT_KEYS.has(key))).toEqual([]);
  });

  it('order.place_on_behalf — status, line counts and carried keys; no total, currency or group name', () => {
    const layout: OrderLineLayout = {
      groups: [{ sourceId: 'a', name: S.group, position: 0 }],
      lines: new Map([
        ['0', { groupSourceId: 'a', position: 0 }],
        ['1', { groupSourceId: 'a', position: 1 }],
      ]),
    };
    const state = placeOnBehalfAuditState({
      order: { status: 'new' },
      layout,
      carriedCustomFieldKeys: ['risk'],
    });
    const entries = [{ action: 'order.place_on_behalf', stateBefore: null, stateAfter: state }];

    expectNoAuditValues(entries, SENTINELS);
    expect(state).toEqual({ status: 'new', groups: [{ lineCount: 2 }], carriedCustomFieldKeys: ['risk'] });
    expect(topLevelKeys(entries).filter((key) => !ORDER_AUDIT_KEYS.has(key))).toEqual([]);
  });

  it('order.place_via_api_key — the key and the order number; not the tenant anchor', () => {
    const state = apiKeyPlacementAuditState(
      { apiKeyId: ADMIN, organizationId: ORG, customerAccountId: CONTACT },
      { businessId: 'ORD-000470' },
    );
    const entries = [{ action: 'order.place_via_api_key', stateBefore: null, stateAfter: state }];

    expectNoAuditValues(entries, SENTINELS);
    expect(state).toEqual({ apiKeyId: ADMIN, businessId: 'ORD-000470' });
    expect(topLevelKeys(entries).filter((key) => !ORDER_AUDIT_KEYS.has(key))).toEqual([]);
  });
});
