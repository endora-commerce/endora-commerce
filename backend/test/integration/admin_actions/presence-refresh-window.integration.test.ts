import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql';
import type { AdminI18nTranslatePort, PermissionReadPort } from '@b2b/contracts';
import mikroOrmConfig from '../../../src/db/mikro-orm.config.js';
import { AdminActionsService } from '../../../src/modules/admin_actions/services/admin-actions-service.js';
import { ModuleAction } from '../../../src/modules/admin_actions/entities/module-action.entity.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { ModuleRegistryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { ModuleEffectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';
import { SettingGroup } from '../../../src/kernel/settings/setting-group.entity.js';

/**
 * Issue #225 — the palette snapshot must not outlive the presence refresh that
 * followed the same state change.
 *
 * `listVisibleForOperator` reads its two presence axes from two different
 * places, and only one of them is fresh per call:
 *
 *  - platform availability comes from the SQL join on `module_registrations`,
 *    re-read on every rebuild;
 *  - operator activation comes from `registryCache`'s in-memory map, through
 *    the presence probe both composition roots wire to `effectiveState`.
 *
 * On a `b2b:module:state-changed` message the service drops its snapshot
 * **synchronously**, while `registryCache.refreshFromDb` — which is what makes
 * the second axis current — is still awaiting PostgreSQL. A palette request
 * landing in that window rebuilds from the pre-flip activation map. That answer
 * is stale, and unavoidably so: the cache is eventually consistent by design
 * and a read mid-refresh has nothing fresher to read.
 *
 * What is **not** unavoidable is that the stale answer is then memoised and
 * nothing drops it again until the *next* state change. That is the defect
 * pinned below, and it is independent of the order the two pub/sub listeners
 * were registered in: `refreshFromDb` is asynchronous, so the window exists
 * whichever listener runs first. Both orders are exercised, so a "fix" that
 * only reorders the listeners fails one of them.
 *
 * The window is opened deterministically rather than by racing two real
 * promises: the refresh is handed an EntityManager whose first `find` blocks on
 * a gate the test releases. Nothing here touches Redis — the listeners are
 * invoked directly, which is exactly what the two `on('message')` handlers do.
 */

const MODULE_ID = 'fix_prw_a';
const ACTION_ID = 'prw1';
const SETTING_CODE = 'fix_prw_a.enabled';
const GROUP_CODE = 'fix_prw';

describe('AdminActionsService presence-refresh window (integration)', () => {
  let orm: MikroORM;
  let em: EntityManager;

  beforeAll(async () => {
    orm = await MikroORM.init(await mikroOrmConfig());
    em = orm.em.fork() as EntityManager;
  }, 60_000);

  beforeEach(async () => {
    em = orm.em.fork() as EntityManager;
    await cleanup(em);
    await seed(em);
  });

  afterEach(async () => {
    await cleanup(em);
  });

  afterAll(async () => {
    await orm.close(true);
  });

  interface Rig {
    cache: ModuleRegistryCache;
    service: AdminActionsService;
  }

  async function buildRig(): Promise<Rig> {
    const cache = new ModuleRegistryCache();
    cache.setActivationDeclarations([
      {
        moduleId: MODULE_ID,
        settingCode: SETTING_CODE,
        default: true,
        nonDeactivatableReason: null,
      },
    ]);
    await cache.refreshFromDb(() => em);
    const state = new ModuleEffectiveState(cache);

    const i18nStub: AdminI18nTranslatePort = {
      translate: async (moduleId, key): Promise<string> => `${moduleId}:${key}`,
    };
    const permissionStub: PermissionReadPort = {
      listPermissions: async (): Promise<string[]> => ['*'],
    };

    const service = new AdminActionsService({
      em: () => em,
      i18nService: i18nStub,
      permissionService: permissionStub,
      // Exactly what `composition.ts` and `test-server.ts` contribute as
      // `modulePresenceProbe`.
      presence: {
        isActivated: (moduleId) => state.presence(moduleId)?.operatorActivated ?? true,
        version: () => state.presenceVersion(),
      },
    });

    return { cache, service };
  }

  async function visibleActionIds(service: AdminActionsService): Promise<string[]> {
    const result = await service.listVisibleForOperator({
      language: 'en',
      adminUserId: 'admin',
    });
    return result.actions
      .filter((a) => a.moduleId === MODULE_ID)
      .map((a) => a.actionId);
  }

  it('control — a flip the refresh has already observed hides the action', async () => {
    const rig = await buildRig();
    expect(await visibleActionIds(rig.service)).toEqual([ACTION_ID]);

    await deactivate(em);
    await rig.cache.refreshFromDb(() => em);
    rig.service.invalidate();

    expect(await visibleActionIds(rig.service)).toEqual([]);
  });

  for (const order of ['invalidate-then-refresh', 'refresh-then-invalidate'] as const) {
    it(`a snapshot built inside the refresh window does not outlive it (${order})`, async () => {
      const rig = await buildRig();
      // Warm the snapshot, as any palette open would.
      expect(await visibleActionIds(rig.service)).toEqual([ACTION_ID]);

      // The flip is committed by another process; this one learns about it
      // through `b2b:module:state-changed`.
      await deactivate(em);

      const gate = gatedEmFactory(orm);
      let refresh: Promise<void>;
      if (order === 'refresh-then-invalidate') {
        refresh = rig.cache.refreshFromDb(gate.em);
        rig.service.invalidate();
      } else {
        rig.service.invalidate();
        refresh = rig.cache.refreshFromDb(gate.em);
      }

      // A request served inside the window. Its answer is stale, and there is
      // nothing fresher for it to read — this is the eventual consistency the
      // cache is designed around, not the defect.
      expect(await visibleActionIds(rig.service)).toEqual([ACTION_ID]);

      gate.release();
      await refresh;

      // The defect: the presence the snapshot was built from is now current,
      // and it says the module is off — but nothing dropped the snapshot, so
      // the palette keeps offering an action that leads straight to a 503.
      expect(await visibleActionIds(rig.service)).toEqual([]);
    });
  }
});

/**
 * An EntityManager factory whose first `find` blocks until {@link release}.
 * `refreshFromDb` calls `em()` synchronously and then awaits
 * `fork.find(ModuleRegistration, {})`, so this holds the refresh open at
 * exactly the point production holds it open: waiting on PostgreSQL.
 */
function gatedEmFactory(orm: MikroORM): { em: () => EntityManager; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const em = (): EntityManager => {
    const fork = orm.em.fork() as EntityManager;
    return new Proxy(fork, {
      get(target, property, receiver) {
        if (property === 'find') {
          return async (...args: unknown[]): Promise<unknown> => {
            await gate;
            return (target.find as (...a: unknown[]) => Promise<unknown>)(...args);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as EntityManager;
  };
  return { em, release };
}

async function seed(em: EntityManager): Promise<void> {
  const knex = em.getKnex();
  const now = new Date();
  await knex('module_registrations').insert({
    module_id: MODULE_ID,
    state: 'installed',
    version: '1.0.0',
    installed_at: now,
    last_state_change_at: now,
  });
  await knex('module_actions').insert({
    module_id: MODULE_ID,
    action_id: ACTION_ID,
    label_key: 'prw1.label',
    icon: 'Plus',
    target_route: '/prw1',
    required_permission: null,
    keywords: JSON.stringify([]),
    weight: 100,
  });
  const groupId = randomUUID();
  await knex('setting_groups').insert({
      id: groupId,
      code: GROUP_CODE,
      name: 'Presence refresh window fixture',
      is_system_protected: false,
      owner_module: MODULE_ID,
      created_at: now,
      updated_at: now,
  });
  await knex('settings').insert({
    id: randomUUID(),
    code: SETTING_CODE,
    name: 'Fixture activation control',
    group_id: groupId,
    value_type: 'boolean',
    default_value: JSON.stringify(true),
    global_value: JSON.stringify(true),
    owner_module: MODULE_ID,
    hidden: false,
    created_at: now,
    updated_at: now,
  });
}

/** Commit the operator's flip, as the activation Command does. */
async function deactivate(em: EntityManager): Promise<void> {
  await em
    .getKnex()('settings')
    .where('code', SETTING_CODE)
    .update({ global_value: JSON.stringify(false) });
}

async function cleanup(em: EntityManager): Promise<void> {
  await em.nativeDelete(ModuleAction, { moduleId: MODULE_ID });
  await em.nativeDelete(ModuleRegistration, { moduleId: MODULE_ID });
  await em.nativeDelete(Setting, { code: SETTING_CODE });
  await em.nativeDelete(SettingGroup, { code: GROUP_CODE });
}
