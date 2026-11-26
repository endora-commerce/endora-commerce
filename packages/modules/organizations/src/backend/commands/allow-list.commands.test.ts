import { describe, expect, it } from 'vitest';
import { OptimisticLockError } from '@mikro-orm/core';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { CommandBus } from '@endora-commerce/platform/commands';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import type { Organization } from '../entities/organization.entity.js';
import { OrganizationVersionMismatchError } from '../services/organization-moderation-errors.js';
import { makePatchAllowListCommand, makeReplaceAllowListsCommand } from './allow-list.commands.js';

/**
 * `organization.allow_lists_replace` and `organization.allow_list_patch` as
 * Commands (`specs/186-aggregate-ports/` T022, T027). They were written inside
 * the restriction service's own transaction with a hand-recorded entry; as
 * Commands the link rows and the one entry commit together on the bus's `em`,
 * with the action strings and the state the hand audit recorded, and a stale
 * version or a lost race writes nothing.
 */

const ORG = '00000000-0000-4000-8000-000000186221';
const PM_A = '00000000-0000-4000-8000-0000001862a1';
const PM_B = '00000000-0000-4000-8000-0000001862a2';
const WH = '00000000-0000-4000-8000-0000001862b1';

function harness(options: { flushFails?: unknown; known?: boolean } = {}) {
  const org = { id: ORG, version: 5, deletedAt: null, updatedAt: new Date(0) } as unknown as Organization;
  const audits: Array<Record<string, unknown>> = [];
  const statements: string[] = [];
  const persisted: Array<Record<string, unknown>> = [];
  let flushed = 0;
  const em = {
    async findOne(_entity: unknown, where: { id: string }) {
      return options.known !== false && where.id === ORG ? org : null;
    },
    async nativeDelete(entity: { name: string }, where: Record<string, unknown>) {
      statements.push(`delete ${entity.name} ${JSON.stringify(where)}`);
      return 0;
    },
    create(entity: { name: string }, data: Record<string, unknown>) {
      return { entity: entity.name, ...data };
    },
    persist(row: Record<string, unknown>) {
      persisted.push(row);
    },
    async flush() {
      if (options.flushFails) throw options.flushFails;
      flushed += 1;
      org.version += 1;
    },
    async transactional<T>(cb: (em: EntityManager) => Promise<T>): Promise<T> {
      return cb(em as unknown as EntityManager);
    },
  };
  const audit = {
    recordWithin(_em: EntityManager, input: Record<string, unknown>) {
      audits.push(input);
      return {} as never;
    },
  } as unknown as AuditPort;
  const bus = new CommandBus(
    { em: { fork: () => em } } as unknown as MikroORM,
    audit,
    new EventBus<Record<string, EventBase>>(),
  );
  const run = <T>(command: Parameters<typeof bus.run<T>>[0]) =>
    withSystemScope('organizations unit test: allow lists', () => bus.run(command));
  return { org, audits, statements, persisted, flushed: () => flushed, run };
}

describe('organization.allow_lists_replace (186 T027)', () => {
  it('replaces the three lists and records the deduplicated ids in one entry', async () => {
    const h = harness();
    await h.run(
      makeReplaceAllowListsCommand({
        organizationId: ORG,
        paymentMethodIds: [PM_A, PM_B, PM_A],
        deliveryMethodIds: [],
        warehouseIds: [WH],
        expectedVersion: 5,
      }),
    );
    expect(h.statements).toHaveLength(3);
    expect(h.persisted.map((row) => row['entity'])).toEqual([
      'OrganizationPaymentMethodLink',
      'OrganizationPaymentMethodLink',
      'OrganizationWarehouseLink',
    ]);
    expect(h.org.version).toBe(6);
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: 'organization.allow_lists_replace',
        objectType: 'organization',
        objectId: ORG,
        stateBefore: null,
        stateAfter: { paymentMethodIds: [PM_A, PM_B], deliveryMethodIds: [], warehouseIds: [WH] },
      }),
    ]);
  });

  it('writes over the version it reads when none is expected', async () => {
    const h = harness();
    await h.run(
      makeReplaceAllowListsCommand({ organizationId: ORG, paymentMethodIds: [], deliveryMethodIds: [], warehouseIds: [] }),
    );
    expect(h.audits).toHaveLength(1);
  });

  it('refuses a stale version before writing, and records nothing', async () => {
    const h = harness();
    await expect(
      h.run(
        makeReplaceAllowListsCommand({
          organizationId: ORG,
          paymentMethodIds: [PM_A],
          deliveryMethodIds: [],
          warehouseIds: [],
          expectedVersion: 4,
        }),
      ),
    ).rejects.toMatchObject({ name: 'OrganizationVersionMismatchError', currentVersion: 5 });
    expect(h.statements).toEqual([]);
    expect(h.audits).toEqual([]);
  });

  it('answers a row that moved before the flush as a version mismatch', async () => {
    const h = harness({ flushFails: new OptimisticLockError('moved') });
    await expect(
      h.run(
        makeReplaceAllowListsCommand({ organizationId: ORG, paymentMethodIds: [], deliveryMethodIds: [], warehouseIds: [] }),
      ),
    ).rejects.toBeInstanceOf(OrganizationVersionMismatchError);
    expect(h.audits).toEqual([]);
  });

  it('answers an unknown or malformed id as not found', async () => {
    for (const id of [ORG, 'not-a-uuid']) {
      const h = harness({ known: false });
      await expect(
        h.run(makeReplaceAllowListsCommand({ organizationId: id, paymentMethodIds: [], deliveryMethodIds: [], warehouseIds: [] })),
      ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
      expect(h.audits).toEqual([]);
    }
  });
});

describe('organization.allow_list_patch (186 T027)', () => {
  it('adds and removes on the one list it names, and records kind, add and remove', async () => {
    const h = harness();
    await h.run(
      makePatchAllowListCommand({
        organizationId: ORG,
        kind: 'payment_method',
        add: [PM_A, PM_A],
        remove: [PM_B],
        expectedVersion: 5,
      }),
    );
    expect(h.statements).toEqual([
      `delete OrganizationPaymentMethodLink ${JSON.stringify({ organizationId: ORG, paymentMethodId: { $in: [PM_B] } })}`,
    ]);
    expect(h.persisted).toEqual([{ entity: 'OrganizationPaymentMethodLink', organizationId: ORG, paymentMethodId: PM_A }]);
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: 'organization.allow_list_patch',
        stateBefore: null,
        stateAfter: { kind: 'payment_method', add: [PM_A], remove: [PM_B] },
      }),
    ]);
  });

  it('touches warehouses only for the warehouse kind', async () => {
    const h = harness();
    await h.run(makePatchAllowListCommand({ organizationId: ORG, kind: 'warehouse', add: [WH] }));
    expect(h.statements).toEqual([]);
    expect(h.persisted).toEqual([{ entity: 'OrganizationWarehouseLink', organizationId: ORG, warehouseId: WH }]);
    expect(h.audits[0]).toMatchObject({ stateAfter: { kind: 'warehouse', add: [WH], remove: [] } });
  });

  it('refuses a stale version before writing', async () => {
    const h = harness();
    await expect(
      h.run(makePatchAllowListCommand({ organizationId: ORG, kind: 'delivery_method', add: [PM_A], expectedVersion: 9 })),
    ).rejects.toBeInstanceOf(OrganizationVersionMismatchError);
    expect(h.persisted).toEqual([]);
    expect(h.audits).toEqual([]);
  });
});
