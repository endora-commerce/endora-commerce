import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ModuleAction } from '../../helpers/package-entities.js';
import { Redis } from 'ioredis';
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql';
import type { AdminI18nTranslatePort, PermissionReadPort } from '@endora-commerce/contracts';
import mikroOrmConfig from '../../../src/db/mikro-orm.config.js';
import { AdminActionsService } from '../../../../packages/modules/admin_actions/src/backend/services/admin-actions-service.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import {
  ModuleRegistryCache,
  STATE_CHANGED_CHANNEL,
} from '../../../src/kernel/lifecycle/registry-cache.js';
import { ModuleEffectiveState } from '../../../src/kernel/lifecycle/effective-state.js';

/**
 * D-174 — the input the presence version cannot see, and the seam that covers
 * it.
 *
 * `presenceVersion()` is a content hash of two things: `module_registrations`
 * state per module, and resolved operator activation per module. A rewrite of
 * `module_actions` moves neither, so the pull `listVisibleForOperator` makes on
 * every read is structurally blind to it — which is why deleting the
 * cross-process invalidation would have left a stale palette until the next
 * change that *did* move presence.
 *
 * The invalidation is cross-process by construction: an operator's flip is
 * committed in one process and every other API and worker process has to hear
 * it. Its transport is the `b2b:module:state-changed` Redis channel, which this
 * module used to name directly. It no longer does — the kernel's own subscriber
 * (`ModuleRegistryCache.watch`) drives the in-process cache registry, and this
 * module registers a layer with it.
 *
 * The test is written as two processes because that is the property: process A
 * publishes, process B — the one holding the palette snapshot — drops it. It
 * asserts the version never moves, so a green here cannot be the presence pull
 * quietly doing the work.
 */

const MODULE_ID = 'fix_d174_a';
const FIRST_ACTION = 'd174a';
const SECOND_ACTION = 'd174b';

describe('AdminActionsService cross-process invalidation (integration)', () => {
  let orm: MikroORM;
  let em: EntityManager;
  let publisher: Redis;
  let subscriberRedis: Redis;

  beforeAll(async () => {
    orm = await MikroORM.init(await mikroOrmConfig());
    em = orm.em.fork() as EntityManager;
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    publisher = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
    subscriberRedis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
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
    publisher.disconnect();
    subscriberRedis.disconnect();
    await orm.close(true);
  });

  it('drops the palette snapshot when another process announces a state change', async () => {
    // ---- process B: the one holding a warm palette snapshot ----------------
    const cache = new ModuleRegistryCache();
    await cache.refreshFromDb(() => em);
    const state = new ModuleEffectiveState(cache);
    const service = new AdminActionsService({
      em: () => em,
      i18nService: i18nStub,
      permissionService: permissionStub,
      // Exactly what `composition.ts` and `test-server.ts` contribute as
      // `modulePresenceProbe`.
      presence: {
        isPlatformAvailable: (moduleId): boolean =>
          state.presence(moduleId)?.platformAvailable ?? false,
        isActivated: (moduleId): boolean => state.presence(moduleId)?.operatorActivated ?? true,
        version: (): number => state.presenceVersion(),
      },
    });
    await cache.watch({ redisSubscriber: subscriberRedis, em: () => em });

    try {
      expect(await visibleActionIds(service)).toEqual([FIRST_ACTION]);
      const versionBefore = state.presenceVersion();

      // ---- process A: an install rewrites this module's palette rows -------
      // Nothing about anybody's presence moves: no registry row changes state
      // and no activation value is written.
      await addSecondAction(orm.em.fork() as EntityManager);

      // The pull cannot see it. This is the premise the ruling rests on, and it
      // is asserted rather than assumed.
      expect(state.presenceVersion()).toBe(versionBefore);
      expect(await visibleActionIds(service)).toEqual([FIRST_ACTION]);

      // ---- process A publishes; process B has to hear it -------------------
      await publisher.publish(
        STATE_CHANGED_CHANNEL,
        JSON.stringify({ moduleId: MODULE_ID, newState: 'installed' }),
      );

      await waitFor(async () => {
        const ids = await visibleActionIds(service);
        return ids.length === 2;
      });

      expect(await visibleActionIds(service)).toEqual([FIRST_ACTION, SECOND_ACTION]);
      // And the version still has not moved — so the pull did not do this.
      expect(state.presenceVersion()).toBe(versionBefore);
    } finally {
      // Feature 073 — a dropped subscriber arms a degraded-mode refresh timer.
      cache.stopFallbackRefresh();
      service.dispose();
    }
  });
});

const i18nStub: AdminI18nTranslatePort = {
  translate: async (moduleId, key): Promise<string> => `${moduleId}:${key}`,
};

const permissionStub: PermissionReadPort = {
  listPermissions: async (): Promise<string[]> => ['*'],
};

async function visibleActionIds(service: AdminActionsService): Promise<string[]> {
  const result = await service.listVisibleForOperator({
    language: 'en',
    adminUserId: 'admin',
  });
  return result.actions
    .filter((a) => a.moduleId === MODULE_ID)
    .map((a) => a.actionId)
    .sort();
}

/** Poll until `predicate` holds, or give the pub/sub round-trip up for lost. */
async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
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
  await knex('module_actions').insert(actionRow(FIRST_ACTION, 100));
}

/**
 * What a reconcile does on an install that adds a palette entry: one more row
 * in `module_actions`, and nothing anywhere else.
 */
async function addSecondAction(em: EntityManager): Promise<void> {
  await em.getKnex()('module_actions').insert(actionRow(SECOND_ACTION, 200));
}

function actionRow(actionId: string, weight: number): Record<string, unknown> {
  return {
    module_id: MODULE_ID,
    action_id: actionId,
    label_key: `${actionId}.label`,
    icon: 'Plus',
    target_route: `/${actionId}`,
    required_permission: null,
    keywords: JSON.stringify([]),
    weight,
  };
}

async function cleanup(em: EntityManager): Promise<void> {
  await em.nativeDelete(ModuleAction, { moduleId: MODULE_ID });
  await em.nativeDelete(ModuleRegistration, { moduleId: MODULE_ID });
}
