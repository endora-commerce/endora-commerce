import { AssertionError } from 'node:assert';
import { describe, expect, it } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { CommandBus } from '@endora-commerce/platform/commands';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { MissingTenantContextError, withSystemScope } from '@endora-commerce/platform/tenancy';
import { OrganizationCustomFieldWriteService } from './organization-custom-field-write-port.js';

/**
 * The server-side custom-field write `organizations` publishes
 * (`organizationCustomFieldWritePort`): one Command, the caller's merge between
 * the owner's load and its write, one audit row.
 *
 * The bus is the platform's real {@link CommandBus} over a fake ORM whose
 * `transactional` marks the span of the transaction, so "inside one
 * transaction" is read off the bus's own composition rather than restated by a
 * fake. That the row and the audit entry really commit or roll back together is
 * the database's question, asked by
 * `backend/test/integration/organizations/custom-field-write-port.test.ts`.
 */

// ---------------------------------------------------------------------------
// The sentinel assertion. A local copy of `expectNoAuditValues` from
// `@endora-commerce/test-kit/audit`, as the other modules' sentinel tests keep
// it: this package does not depend on the test kit.
// ---------------------------------------------------------------------------
type Sentinel = string | number;

function expectNoAuditValues(entries: ReadonlyArray<Record<string, unknown>>, sentinels: readonly Sentinel[]): void {
  if (entries.length === 0) throw new AssertionError({ message: 'no audit entry to inspect' });
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
    walk(entry['stateBefore'], `[${index}] ${String(entry['action'])} stateBefore`);
    walk(entry['stateAfter'], `[${index}] ${String(entry['action'])} stateAfter`);
  });
  if (leaks.length > 0) {
    throw new AssertionError({ message: `the audit log carries tenant-scoped values:\n  ${leaks.join('\n  ')}` });
  }
}
// ---------------------------------------------------------------------------

const ORG = '00000000-0000-4000-8000-0000000c0f01';
const DELETED_ORG = '00000000-0000-4000-8000-0000000c0f02';
const UNKNOWN_ORG = '00000000-0000-4000-8000-0000000c0f03';

interface FakeOrganization {
  id: string;
  name: string;
  taxId: string;
  status: string;
  vatStatus: string;
  isPersonal: boolean;
  registeredAddress: Record<string, unknown>;
  path: string;
  version: number;
  customFieldValues: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

function organization(id: string, values: Record<string, unknown>, deletedAt: Date | null = null): FakeOrganization {
  return {
    id,
    name: 'Acme',
    taxId: 'PL0000000000',
    status: 'active',
    vatStatus: 'vat_payer',
    isPersonal: false,
    registeredAddress: { street: 'ul. Nowa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' },
    path: `/${id}/`,
    version: 1,
    customFieldValues: values,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    deletedAt,
  };
}

function harness() {
  const rows = new Map<string, FakeOrganization>([
    [ORG, organization(ORG, { tier: 'gold' })],
    [DELETED_ORG, organization(DELETED_ORG, { tier: 'silver' }, new Date('2026-11-02T00:00:00Z'))],
  ]);
  const state = { inTransaction: false, committed: 0, rolledBack: 0 };
  const flushes: boolean[] = [];
  const audits: Array<Record<string, unknown>> = [];

  const em = {
    async findOne(_entity: unknown, where: { id: string; deletedAt?: null }) {
      const row = rows.get(where.id);
      if (!row) return null;
      if ('deletedAt' in where && where.deletedAt === null && row.deletedAt !== null) return null;
      return row;
    },
    async flush() {
      flushes.push(state.inTransaction);
    },
    async transactional<T>(cb: (em: EntityManager) => Promise<T>): Promise<T> {
      state.inTransaction = true;
      try {
        const result = await cb(em as unknown as EntityManager);
        state.committed += 1;
        return result;
      } catch (error) {
        state.rolledBack += 1;
        throw error;
      } finally {
        state.inTransaction = false;
      }
    },
  };
  const orm = { em: { fork: () => em } } as unknown as MikroORM;
  const audit = {
    recordWithin(_em: EntityManager, input: Record<string, unknown>) {
      audits.push({ ...input, inTransaction: state.inTransaction });
      return {} as never;
    },
  } as unknown as AuditPort;
  const bus = new CommandBus(orm, audit, new EventBus<Record<string, EventBase>>());
  const port = new OrganizationCustomFieldWriteService(bus);
  return { port, rows, state, flushes, audits };
}

/** The system context a subscriber or worker runs in. */
const asSystem = <T>(fn: () => Promise<T>): Promise<T> => withSystemScope('organizations unit test: subscriber-style caller', fn);

describe('OrganizationCustomFieldWriteService.setCustomFieldValues', () => {
  it('runs the merge inside the Command transaction and writes its result with one audit row', async () => {
    const h = harness();
    const seen: Array<{ current: Record<string, unknown>; inTransaction: boolean }> = [];

    const record = await asSystem(() =>
      h.port.setCustomFieldValues(ORG, async (current) => {
        seen.push({ current: { ...current }, inTransaction: h.state.inTransaction });
        return { ...current, acquisition_source: 'trade_fair' };
      }),
    );

    expect(seen).toEqual([{ current: { tier: 'gold' }, inTransaction: true }]);
    expect(h.rows.get(ORG)?.customFieldValues).toEqual({ tier: 'gold', acquisition_source: 'trade_fair' });
    expect(h.flushes).toEqual([true]);
    expect(h.state).toMatchObject({ committed: 1, rolledBack: 0 });
    expect(record).toMatchObject({ id: ORG, customFieldValues: { tier: 'gold', acquisition_source: 'trade_fair' } });

    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      action: 'organization.set_custom_field_values',
      objectType: 'organization',
      objectId: ORG,
      // A subscriber has no administrator: the system actor records none.
      actorAdminUserId: null,
      actorCustomerAccountId: null,
      // Names, never values (`specs/conventions/audit-state.md`, D-288).
      stateBefore: null,
      stateAfter: { changedCustomFields: ['acquisition_source'] },
      inTransaction: true,
    });
  });

  it('records the keys it changed and none of the values (D-288 sentinel)', async () => {
    const h = harness();
    h.rows.get(ORG)!.customFieldValues = { tier: 'S470-CF-OLD', region: 'S470-CF-KEPT', legacy: 'S470-CF-GONE' };

    await asSystem(() =>
      h.port.setCustomFieldValues(ORG, async (current) => {
        const next: Record<string, unknown> = { ...current, tier: 'S470-CF', acquisition_source: 'S470-CF-NEW' };
        delete next['legacy'];
        return next;
      }),
    );

    expectNoAuditValues(h.audits, ['S470-CF', 'Acme', 'PL0000000000', ORG]);
    expect(h.audits[0]).toMatchObject({
      stateBefore: null,
      stateAfter: { changedCustomFields: ['acquisition_source', 'legacy', 'tier'] },
    });
    expect(Object.keys((h.audits[0]?.['stateAfter'] ?? {}) as object)).toEqual(['changedCustomFields']);
  });

  it('keeps the before-state honest when the merge mutates the bag it was given', async () => {
    const h = harness();
    await asSystem(() =>
      h.port.setCustomFieldValues(ORG, async (current) => {
        current['tier'] = 'platinum';
        return current;
      }),
    );
    expect(h.audits[0]).toMatchObject({
      stateBefore: null,
      stateAfter: { changedCustomFields: ['tier'] },
    });
  });

  it('writes nothing and records nothing when the merge throws, and propagates the error unchanged', async () => {
    const h = harness();
    const refusal = Object.assign(new Error('One or more custom fields are invalid.'), {
      errors: [{ field: 'acquisition_source', message: 'invalid' }],
    });

    await expect(
      asSystem(() =>
        h.port.setCustomFieldValues(ORG, async () => {
          throw refusal;
        }),
      ),
    ).rejects.toBe(refusal);

    expect(h.rows.get(ORG)?.customFieldValues).toEqual({ tier: 'gold' });
    expect(h.flushes).toEqual([]);
    expect(h.audits).toEqual([]);
    expect(h.state).toMatchObject({ committed: 0, rolledBack: 1 });
  });

  it.each([
    ['an unknown organization', UNKNOWN_ORG],
    ['a deleted organization', DELETED_ORG],
    ['an id that is not a uuid', 'not-a-uuid'],
  ])('answers not found for %s without calling the merge', async (_label, id) => {
    const h = harness();
    let called = false;

    await expect(
      asSystem(() =>
        h.port.setCustomFieldValues(id, async (current) => {
          called = true;
          return current;
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: ERROR_CODES.NOT_FOUND });

    expect(called).toBe(false);
    expect(h.audits).toEqual([]);
    expect(h.flushes).toEqual([]);
  });

  it('refuses before any write when the caller has no tenant context', async () => {
    const h = harness();
    let called = false;

    await expect(
      h.port.setCustomFieldValues(ORG, async (current) => {
        called = true;
        return current;
      }),
    ).rejects.toBeInstanceOf(MissingTenantContextError);

    expect(called).toBe(false);
    expect(h.audits).toEqual([]);
  });
});
