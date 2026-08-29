import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminI18nTranslatePort, PermissionReadPort } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';
import { AdminActionsService } from '../../../../packages/modules/admin_actions/src/backend/services/admin-actions-service.js';

/**
 * The palette resolves **both** presence axes through the injected probe.
 *
 * It used to resolve only one that way. Platform availability came from a knex
 * `join('module_registrations as r', …).where('r.state', 'installed')` — a
 * cross-module SQL reach into a kernel-owned table, ledgered under issue #187 —
 * while operator activation came from `effectiveState` through the probe both
 * composition roots contribute.
 *
 * Two sources for one answer is what this file pins shut, and the kernel's own
 * combiner says why in its own header: *"This is deliberately the only place
 * the two are combined: no caller — not the four wrappers, not the Admin UI,
 * not the storefront — recombines them."* The palette recombined them, and the
 * two disagreed for the length of every `registryCache.refreshFromDb`: between
 * a state change and the refresh that follows it, the SQL answer had already
 * moved and every route gate's had not. The palette therefore advertised
 * actions whose routes answered 503, and hid actions whose routes still served.
 *
 * The unit half is here because the defect is a *filter*, not a query: given a
 * probe that says the module is not installed here, the row must not reach the
 * operator whatever the database holds.
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

function row(moduleId: string, actionId: string): ActionRow {
  return {
    module_id: moduleId,
    action_id: actionId,
    label_key: `actions.${actionId}.label`,
    description_key: null,
    icon: 'Package',
    target_route: `/${moduleId}`,
    required_permission: null,
    keywords: [],
    weight: 100,
    version: 3,
  };
}

/**
 * A knex stand-in that answers `select` with `rows` and **fails the run if the
 * query joins anything**.
 *
 * The negative half is the point: a stub that merely tolerated a `join` would
 * stay green if the reach came back, and the assertion below would then be
 * asserting the filter over a query that had already filtered for it.
 */
function emReturning(rows: ActionRow[]): () => EntityManager {
  const knex = (): unknown => {
    const chain = {
      join: (): never => {
        throw new Error('the palette query must not join another owner\'s table');
      },
      where: (): unknown => chain,
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

async function visibleModuleIds(service: AdminActionsService): Promise<string[]> {
  const result = await service.listVisibleForOperator({
    language: 'en',
    adminUserId: 'admin-1',
  });
  return result.actions.map((a) => a.moduleId);
}

describe('admin_actions — both presence axes come from the probe', () => {
  it('hides an action whose module is not available on this platform', async () => {
    const service = new AdminActionsService({
      em: emReturning([row('blog', 'open'), row('catalog', 'open')]),
      i18nService: i18n,
      permissionService: permissions,
      presence: {
        isPlatformAvailable: (moduleId) => moduleId !== 'blog',
        isActivated: () => true,
        version: () => 1,
      },
    });

    expect(await visibleModuleIds(service)).toEqual(['catalog']);
    service.dispose();
  });

  it('hides an action whose module the operator deactivated', async () => {
    const service = new AdminActionsService({
      em: emReturning([row('blog', 'open'), row('catalog', 'open')]),
      i18nService: i18n,
      permissionService: permissions,
      presence: {
        isPlatformAvailable: () => true,
        isActivated: (moduleId) => moduleId !== 'catalog',
        version: () => 1,
      },
    });

    expect(await visibleModuleIds(service)).toEqual(['blog']);
    service.dispose();
  });

  it('a platform-unavailable module stays hidden however the operator voted', async () => {
    // Effective presence is the conjunction (Constitution XVII). The axis an
    // operator drives cannot resurrect a module the deployment does not ship,
    // and this is the direction the SQL join answered on its own — so it is the
    // one that has to keep holding now that the probe answers it.
    const service = new AdminActionsService({
      em: emReturning([row('blog', 'open')]),
      i18nService: i18n,
      permissionService: permissions,
      presence: {
        isPlatformAvailable: () => false,
        isActivated: () => true,
        version: () => 1,
      },
    });

    expect(await visibleModuleIds(service)).toEqual([]);
    service.dispose();
  });

  it('a change to the platform axis alone drops the snapshot', async () => {
    // The generation is a hash of *both* axes, so a platform flip moves it.
    // Before the cut this rebuild was unnecessary — the join re-read the table
    // on every miss — and it is the mechanism that replaces that freshness.
    const state = { available: true, version: 1 };
    const service = new AdminActionsService({
      em: emReturning([row('blog', 'open')]),
      i18nService: i18n,
      permissionService: permissions,
      presence: {
        isPlatformAvailable: () => state.available,
        isActivated: () => true,
        version: () => state.version,
      },
    });

    expect(await visibleModuleIds(service)).toEqual(['blog']);
    expect(service.stats.dbHits).toBe(1);

    state.available = false;
    state.version = 2;

    expect(await visibleModuleIds(service)).toEqual([]);
    expect(service.stats.dbHits).toBe(2);
    service.dispose();
  });
});
