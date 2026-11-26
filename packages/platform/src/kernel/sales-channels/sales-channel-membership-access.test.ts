import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { EventBus } from '../../events/bus.js';
import type { AuditPort } from '../ports/audit.js';
import { ChannelBridgeRegistry } from './channel-bridge-registry.js';
import { SalesChannelMembershipService } from './sales-channel-membership.service.js';
import type { SalesChannelAccessCacheInvalidation } from './sales-channel-access-cache.js';

/**
 * Feature 154 — an Organization's channel assignment is what the access rule
 * reads, through a cache. The membership service is the single writer of that
 * assignment, so it is the one place that can drop the cache **as part of the
 * write** (D-93; `contracts/channel-access-rule.md` §5): after every committed
 * mutation of an Organization's channels and **before** it emits, so neither a
 * read-back on the writer nor a subscriber to `sales_channels.membership_changed`
 * can observe the pre-change set.
 *
 * Bridges other than the Organization one do not take part in access, and must
 * not cost a Redis round trip and a pub/sub message per write.
 */

const DEFAULT = 'ch-default';
const A = 'ch-a';
const B = 'ch-b';
const ORG = 'org-1';
const ORG_SOURCE = 'org-2';

/**
 * An `EntityManager` stand-in that understands exactly the statements the
 * membership service issues against a bridge, over an in-memory row set.
 */
function fakeEm(
  rows: Map<string, Set<string>>,
  log: string[],
  label = 'em',
  inTransaction = false,
): EntityManager {
  const setOf = (entityId: string): Set<string> => {
    let set = rows.get(entityId);
    if (!set) {
      set = new Set();
      rows.set(entityId, set);
    }
    return set;
  };
  const connection = {
    async execute(sql: string, params: string[]): Promise<unknown> {
      log.push(`${label}:${sql.split(' ').slice(0, 2).join(' ')}`);
      if (sql.startsWith('select "id" from "sales_channels"')) return [{ id: DEFAULT }];
      if (sql.startsWith('select count(*)')) {
        return [{ count: String(setOf(params[0]!).size) }];
      }
      if (sql.startsWith('select 1 as present')) {
        return setOf(params[1]!).has(params[0]!) ? [{ present: 1 }] : [];
      }
      if (sql.startsWith('select "sales_channel_id"')) {
        return [...setOf(params[0]!)].sort().map((id) => ({ sales_channel_id: id }));
      }
      if (sql.startsWith('insert into')) {
        const [channelId, entityId] = params as [string, string];
        const set = setOf(entityId);
        const isNew = !set.has(channelId);
        set.add(channelId);
        return isNew ? [{ entity_id: entityId }] : [];
      }
      if (sql.startsWith('delete from') && sql.includes('"sales_channel_id" = ?')) {
        setOf(params[1]!).delete(params[0]!);
        return [];
      }
      if (sql.startsWith('delete from')) {
        const removed = [...setOf(params[0]!)];
        rows.set(params[0]!, new Set());
        return removed.map((id) => ({ sales_channel_id: id }));
      }
      throw new Error(`unexpected statement: ${sql}`);
    },
  };
  const em = {
    getConnection: () => connection,
    getTransactionContext: () => undefined,
    isInTransaction: () => inTransaction,
    transactional: async <T>(work: (tx: EntityManager) => Promise<T>): Promise<T> => work(em),
    find: async () => [],
  } as unknown as EntityManager;
  return em;
}

function harness(initial: Record<string, string[]> = {}) {
  const rows = new Map(Object.entries(initial).map(([k, v]) => [k, new Set(v)]));
  const order: string[] = [];
  const statements: string[] = [];
  const eventBus = {
    emit: (name: string, payload: { entityId: string; op: string }) => {
      order.push(`emit:${name}:${payload.entityId}:${payload.op}`);
    },
  } as unknown as EventBus;
  const cache: SalesChannelAccessCacheInvalidation = {
    invalidateAfterWrite: async (organizationId) => {
      order.push(`drop:${organizationId}`);
      return 1;
    },
    invalidateAllAfterWrite: async () => {
      order.push('drop:*');
      return 1;
    },
  };
  const bridges = new ChannelBridgeRegistry();
  bridges.register({
    entityType: 'organization',
    table: 'sales_channel_organizations',
    entityIdColumn: 'organization_id',
  });
  bridges.register({
    entityType: 'product',
    table: 'sales_channel_products',
    entityIdColumn: 'product_id',
  });
  const service = new SalesChannelMembershipService(
    () => fakeEm(rows, statements),
    eventBus,
    undefined,
    bridges,
    cache,
  );
  return { service, rows, order, statements };
}

const EMIT = 'emit:sales_channels.membership_changed';

describe('SalesChannelMembershipService drops the access cache before it emits', () => {
  it('on add', async () => {
    const h = harness({ [ORG]: [DEFAULT] });
    await h.service.addToChannel(A, 'organization', ORG);
    expect(h.order).toEqual([`drop:${ORG}`, `${EMIT}:${ORG}:add`]);
  });

  it('on remove', async () => {
    const h = harness({ [ORG]: [DEFAULT, A] });
    await h.service.removeFromChannel(A, 'organization', ORG);
    expect(h.order).toEqual([`drop:${ORG}`, `${EMIT}:${ORG}:remove`]);
  });

  it('on remove with the fallback to the default channel', async () => {
    const h = harness({ [ORG]: [A] });
    const result = await h.service.removeFromChannel(A, 'organization', ORG, {
      fallbackToDefault: true,
    });
    expect(result.fallbackAppliedToDefault).toBe(true);
    expect(h.order).toEqual([`drop:${ORG}`, `${EMIT}:${ORG}:remove`]);
  });

  it('on bind-to-default', async () => {
    const h = harness();
    await h.service.bindToDefaultIfEmpty('organization', ORG);
    expect(h.order).toEqual([`drop:${ORG}`, `${EMIT}:${ORG}:add`]);
  });

  it('once per replace, before any of its events', async () => {
    const h = harness({ [ORG]: [DEFAULT] });
    await h.service.replaceChannelsForEntity('organization', ORG, [A, B]);
    expect(h.order[0]).toBe(`drop:${ORG}`);
    expect(h.order.filter((e) => e.startsWith('drop:'))).toHaveLength(1);
    expect(h.order.slice(1).sort()).toEqual(
      [`${EMIT}:${ORG}:remove`, `${EMIT}:${ORG}:add`, `${EMIT}:${ORG}:add`].sort(),
    );
  });

  it('on copy, for the target Organization', async () => {
    const h = harness({ [ORG_SOURCE]: [A], [ORG]: [DEFAULT] });
    await h.service.copyMemberships('organization', ORG_SOURCE, ORG);
    expect(h.order).toEqual([`drop:${ORG}`, `${EMIT}:${ORG}:add`]);
  });

  it('not for an idempotent no-op', async () => {
    const h = harness({ [ORG]: [DEFAULT] });
    await h.service.addToChannel(DEFAULT, 'organization', ORG);
    await h.service.removeFromChannel(A, 'organization', ORG);
    await h.service.bindToDefaultIfEmpty('organization', ORG);
    await h.service.replaceChannelsForEntity('organization', ORG, [DEFAULT]);
    expect(h.order).toEqual([]);
  });

  it('not for a bridge that does not take part in access', async () => {
    const h = harness({ p1: [DEFAULT] });
    await h.service.addToChannel(A, 'product', 'p1');
    await h.service.removeFromChannel(A, 'product', 'p1');
    await h.service.replaceChannelsForEntity('product', 'p1', [B]);
    expect(h.order.some((e) => e.startsWith('drop:'))).toBe(false);
  });
});

describe('SalesChannelMembershipService runs on a caller-supplied EntityManager', () => {
  it('issues the bridge statements on options.em instead of a fresh fork', async () => {
    const h = harness();
    const callerRows = h.rows;
    const callerLog: string[] = [];
    const callerEm = fakeEm(callerRows, callerLog, 'caller');

    await h.service.bindToDefaultIfEmpty('organization', ORG, { em: callerEm });
    await h.service.replaceChannelsForEntity('organization', ORG, [A], { em: callerEm });
    await h.service.addToChannel(B, 'organization', ORG, { em: callerEm });

    expect(h.statements).toEqual([]);
    expect(callerLog.length).toBeGreaterThan(0);
    expect([...callerRows.get(ORG)!].sort()).toEqual([A, B]);
  });
});

/**
 * Issue #1926 (`specs/186-aggregate-ports/` research R-16.1) — given a caller's
 * transactional `em`, the writer **enlists**: each membership entry is recorded
 * on that `em` (so it rolls back with the caller), and the access-cache drop
 * waits for the enclosing EventBus scope to succeed — after the commit, and
 * still before the events. Without one, nothing changes.
 */
describe('SalesChannelMembershipService enlists in the caller’s transaction', () => {
  function enlisting(initial: Record<string, string[]> = {}) {
    const rows = new Map(Object.entries(initial).map(([k, v]) => [k, new Set(v)]));
    const order: string[] = [];
    const eventBus = new EventBus();
    eventBus.on('sales_channels.membership_changed', (payload) => {
      const { entityId, op } = payload as unknown as { entityId: string; op: string };
      order.push(`${EMIT}:${entityId}:${op}`);
    });
    const audit = {
      record: async (input: { objectId: string }) => {
        order.push(`audit:own:${input.objectId}`);
        return {} as never;
      },
      recordWithin: (em: EntityManager, input: { objectId: string }) => {
        order.push(`audit:within:${em === callerEm ? 'caller' : 'other'}:${input.objectId}`);
        return {} as never;
      },
    } as unknown as AuditPort;
    const cache: SalesChannelAccessCacheInvalidation = {
      invalidateAfterWrite: async (organizationId) => {
        order.push(`drop:${organizationId}`);
        return 1;
      },
      invalidateAllAfterWrite: async () => 1,
    };
    const bridges = new ChannelBridgeRegistry();
    bridges.register({
      entityType: 'organization',
      table: 'sales_channel_organizations',
      entityIdColumn: 'organization_id',
    });
    const statements: string[] = [];
    const service = new SalesChannelMembershipService(
      () => fakeEm(rows, statements),
      eventBus,
      audit,
      bridges,
      cache,
    );
    const callerEm = fakeEm(rows, [], 'caller', true);
    return { service, eventBus, order, callerEm };
  }

  const within = (channel: string) => `audit:within:caller:${channel}:organization:${ORG}`;
  const own = (channel: string) => `audit:own:${channel}:organization:${ORG}`;

  it('records each entry on the caller’s em and drops the cache only once the scope has succeeded', async () => {
    const h = enlisting({ [ORG]: [DEFAULT] });
    await h.eventBus.run(async () => {
      await h.service.replaceChannelsForEntity('organization', ORG, [A], { em: h.callerEm });
      h.order.push('commit');
    });
    expect(h.order).toEqual([
      within(DEFAULT),
      within(A),
      'commit',
      `drop:${ORG}`,
      `${EMIT}:${ORG}:remove`,
      `${EMIT}:${ORG}:add`,
    ]);
  });

  it('a rolled-back caller leaves no drop and no event, and its entries were never its own', async () => {
    const h = enlisting({ [ORG]: [DEFAULT] });
    await expect(
      h.eventBus.run(async () => {
        await h.service.replaceChannelsForEntity('organization', ORG, [A], { em: h.callerEm });
        throw new Error('vetoed');
      }),
    ).rejects.toThrow('vetoed');
    expect(h.order).toEqual([within(DEFAULT), within(A)]);
  });

  it('enlists on every mutation, not only on a replacement', async () => {
    const h = enlisting({ [ORG]: [DEFAULT], [ORG_SOURCE]: [B] });
    await h.eventBus.run(async () => {
      await h.service.addToChannel(A, 'organization', ORG, { em: h.callerEm });
      await h.service.removeFromChannel(A, 'organization', ORG, { em: h.callerEm });
      await h.service.copyMemberships('organization', ORG_SOURCE, ORG, { em: h.callerEm });
      h.order.push('commit');
    });
    expect(h.order.slice(0, 4)).toEqual([within(A), within(A), within(B), 'commit']);
    expect(h.order.filter((e) => e.startsWith('audit:own'))).toEqual([]);
    expect(h.order.indexOf(`drop:${ORG}`)).toBe(4);
  });

  it('bind-to-default enlists too', async () => {
    const h = enlisting();
    await h.eventBus.run(async () => {
      await h.service.bindToDefaultIfEmpty('organization', ORG, { em: h.callerEm });
      h.order.push('commit');
    });
    expect(h.order).toEqual([within(DEFAULT), 'commit', `drop:${ORG}`, `${EMIT}:${ORG}:add`]);
  });

  it('without an em, keeps its own audit fork and drops at once — its own transaction has committed', async () => {
    const h = enlisting({ [ORG]: [DEFAULT] });
    await h.eventBus.run(async () => {
      await h.service.replaceChannelsForEntity('organization', ORG, [A]);
      h.order.push('scope body done');
    });
    expect(h.order).toEqual([
      `drop:${ORG}`,
      own(DEFAULT),
      own(A),
      'scope body done',
      `${EMIT}:${ORG}:remove`,
      `${EMIT}:${ORG}:add`,
    ]);
  });

  it('given an em with no transaction open, behaves as without one: its statements have already committed', async () => {
    const h = enlisting({ [ORG]: [DEFAULT] });
    const autocommitEm = fakeEm(new Map([[ORG, new Set([DEFAULT])]]), [], 'autocommit', false);
    await h.service.addToChannel(A, 'organization', ORG, { em: autocommitEm });
    expect(h.order).toEqual([own(A), `drop:${ORG}`, `${EMIT}:${ORG}:add`]);
  });
});
