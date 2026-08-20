import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminI18nTranslatePort, PermissionReadPort } from '@b2b/contracts';
import { describe, expect, it } from 'vitest';
import { AdminActionsService } from '../../../src/modules/admin_actions/services/admin-actions-service.js';

/**
 * Issue #225 — the palette snapshot is keyed to the presence generation it was
 * built under.
 *
 * The integration companion (`test/integration/admin_actions/
 * presence-refresh-window.integration.test.ts`) drives the real
 * `ModuleRegistryCache` through a held-open `refreshFromDb`. This file pins the
 * service's half of the contract without a database: given a probe whose
 * `version()` moves, a snapshot built under the old number must not be served
 * under the new one — and, just as importantly, a version that does **not**
 * move must not cost a rebuild, because that is the cache the measurement in
 * the MR description says is worth ~40 ms a read.
 */

interface ActionRow {
  module_id: string;
  action_id: string;
  label_key: string;
  description_key: string | null;
  icon: string;
  target_route: string;
  required_permission: string | null;
  keywords: string[];
  weight: number;
  version: number;
}

function emReturning(rows: ActionRow[]): () => EntityManager {
  const knex = (): unknown => {
    const chain = {
      join: () => chain,
      where: () => chain,
      select: async (): Promise<ActionRow[]> => rows,
    };
    return chain;
  };
  return () => ({ getKnex: () => knex }) as unknown as EntityManager;
}

const i18n: AdminI18nTranslatePort = {
  translate: async (moduleId, key) => `${moduleId}/${key}`,
};
const permissions: PermissionReadPort = {
  listPermissions: async () => ['*'],
};

function buildService(state: { activated: boolean; version: number }): AdminActionsService {
  return new AdminActionsService({
    em: emReturning([
      {
        module_id: 'blog',
        action_id: 'open',
        label_key: 'actions.open.label',
        description_key: null,
        icon: 'Package',
        target_route: '/blog',
        required_permission: null,
        keywords: [],
        weight: 100,
        version: 3,
      },
    ]),
    i18nService: i18n,
    permissionService: permissions,
    presence: {
      isActivated: () => state.activated,
      version: () => state.version,
    },
  });
}

async function visibleModuleIds(service: AdminActionsService): Promise<string[]> {
  const result = await service.listVisibleForOperator({
    language: 'en',
    adminUserId: 'admin-1',
  });
  return result.actions.map((a) => a.moduleId);
}

describe('admin_actions — the snapshot is keyed to the presence generation', () => {
  it('drops a snapshot whose presence generation has moved on', async () => {
    const state = { activated: true, version: 1 };
    const service = buildService(state);

    expect(await visibleModuleIds(service)).toEqual(['blog']);
    expect(service.stats.dbHits).toBe(1);

    // The flip lands in the probe's source *after* the snapshot was taken —
    // which is exactly the state a read served inside `refreshFromDb`'s window
    // leaves behind. Nothing sends a second pub/sub message for it.
    state.activated = false;
    state.version = 2;

    expect(await visibleModuleIds(service)).toEqual([]);
    expect(service.stats.dbHits).toBe(2);
  });

  it('serves the snapshot while the presence generation stands still', async () => {
    const state = { activated: true, version: 1 };
    const service = buildService(state);

    await visibleModuleIds(service);
    await visibleModuleIds(service);
    await visibleModuleIds(service);

    expect(service.stats.dbHits).toBe(1);
    expect(service.stats.cacheHits).toBe(2);
  });

  it('an unwired composition reads as activated and never invalidates', async () => {
    // No probe at all: the pre-073 shape of a composition that resolves no
    // activation state. It must not start rebuilding on every read.
    const service = new AdminActionsService({
      em: emReturning([
        {
          module_id: 'blog',
          action_id: 'open',
          label_key: 'actions.open.label',
          description_key: null,
          icon: 'Package',
          target_route: '/blog',
          required_permission: null,
          keywords: [],
          weight: 100,
          version: 3,
        },
      ]),
      i18nService: i18n,
      permissionService: permissions,
    });

    expect(await visibleModuleIds(service)).toEqual(['blog']);
    expect(await visibleModuleIds(service)).toEqual(['blog']);
    expect(service.stats.dbHits).toBe(1);
    expect(service.stats.cacheHits).toBe(1);
  });
});
