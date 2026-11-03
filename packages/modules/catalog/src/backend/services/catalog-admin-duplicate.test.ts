import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { Product } from '../entities/product.entity.js';
import { CatalogAdminService, type CatalogEventBus } from './catalog-admin.service.js';

/**
 * Feature 163, Phase 16 review — `duplicateProduct` allocates the copy's slug under the
 * URL-key advisory lock (`pg_advisory_xact_lock`), which only holds inside a
 * transaction. The allocation therefore has to run on the em the Command hands its
 * body, not on a bare `emFactory()` em, where autocommit released the lock at once and
 * a concurrent `product.url_keys.update` could claim the key between check and insert.
 */

const SOURCE_ID = '00000000-0000-4000-8000-0000000000a1';

interface Statement {
  em: string;
  sql: string;
  params: unknown[];
}

/**
 * `takenKeys` are held by other products throughout; a `racedKeys` key is free until
 * someone locks it, then taken — a concurrent writer that won it in between.
 */
function fakeEm(
  name: string,
  log: Statement[],
  takenKeys: ReadonlySet<string>,
  racedKeys: ReadonlySet<string>,
): EntityManager {
  const source = {
    id: SOURCE_ID,
    sku: 'DRILL',
    slug: 'drill',
    type: 'simple',
    name: 'Drill',
    description: {},
    visibility: 'public',
    attributeValues: {},
    allowedOrganizationIds: [],
    attributeSetId: null,
    manageStock: false,
    backorderEnabled: false,
    lowStockThresholdMode: 'inherit',
  };
  const em = {
    findOne: async (entity: unknown, where: Record<string, unknown>) =>
      entity === Product && where.id === SOURCE_ID ? source : null,
    find: async () => [],
    create: (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
    persist: () => undefined,
    flush: async () => undefined,
    execute: async (sql: string, params: unknown[] = []) => {
      log.push({ em: name, sql, params });
      if (sql.includes('from "products" where "slug"')) {
        const key = String(params[0]);
        const lockedEarlier = log.some((s) => s.sql.includes('pg_advisory_xact_lock') && s.params[0] === `catalog.url-key:${key}`);
        return takenKeys.has(key) || (racedKeys.has(key) && lockedEarlier) ? [{ '?column?': 1 }] : [];
      }
      return [];
    },
    transactional: async <T>(fn: (em: EntityManager) => Promise<T>) => fn(em as unknown as EntityManager),
  };
  return em as unknown as EntityManager;
}

function rig(takenKeys: ReadonlySet<string> = new Set(), racedKeys: ReadonlySet<string> = new Set()) {
  const log: Statement[] = [];
  const outer = fakeEm('factory', log, takenKeys, racedKeys);
  const inner = fakeEm('command', log, takenKeys, racedKeys);
  const commandBus = {
    run: async <T>(command: Command<T>) => {
      const outcome = await command.run({
        em: inner,
        actor: { actorAdminUserId: null, impersonatedCustomerAccountId: null, kind: 'system' },
      });
      return outcome.result;
    },
  } as unknown as CommandBus;
  const events = { emit: () => undefined } as unknown as CatalogEventBus;
  const service = new CatalogAdminService(() => outer, events, undefined, undefined, commandBus);
  return { service, log };
}

const locks = (log: Statement[]): Statement[] => log.filter((s) => s.sql.includes('pg_advisory_xact_lock'));

describe('CatalogAdminService.duplicateProduct — slug allocation under the Command', () => {
  it('takes the URL-key lock and decides on the Command em, never on the factory em', async () => {
    const { service, log } = rig();
    const dup = await service.duplicateProduct(SOURCE_ID);
    expect(dup.slug).toBe('drill-copy');
    expect(locks(log).length).toBeGreaterThan(0);
    expect(locks(log).every((s) => s.em === 'command')).toBe(true);
    const slugProbes = log.filter((s) => s.sql.includes('from "products" where "slug"'));
    expect(slugProbes.every((s) => s.em === 'command')).toBe(true);
  });

  it('a candidate lost to a concurrent writer: the locks are still taken once, in sorted order', async () => {
    // drill-copy … -8 are taken; -9 is free when probed and taken once locked. Index
    // order then reaches -10, which sorts before -9: one lock at a time would invert.
    const taken = new Set(['drill-copy', ...Array.from({ length: 7 }, (_, i) => `drill-copy-${i + 2}`)]);
    const { service, log } = rig(taken, new Set(['drill-copy-9']));
    const dup = await service.duplicateProduct(SOURCE_ID);
    expect(dup.slug).toBe('drill-copy-10');
    const locked = locks(log).map((s) => String(s.params[0]).replace('catalog.url-key:', ''));
    expect(locked).toEqual([...locked].sort());
    expect(locked).toContain('drill-copy-10');
    expect(new Set(locked).size).toBe(locked.length);
  });
});
