import { Cart, CartAuditEntry, type CartRow } from '../../helpers/package-entities.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

import { cliCommands } from '../../../../packages/modules/carts/src/manifest.js';

import { CartAbandonmentWorker } from '../../../../packages/modules/carts/src/backend/services/cart-abandonment-worker.js';

import { CartAuditService } from '../../../../packages/modules/carts/src/backend/services/cart-audit-service.js';

import { AuditLogService } from '@endora-commerce/platform/composition';

import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';

import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';

import { activationDeclarationsFrom } from '@endora-commerce/platform/composition';

import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';

import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { runModuleCommand } from '../../../src/cli/module-commands.js';

import { enterSystemScope } from '../../../src/kernel/scope.js';


/**
 * Issue #54, re-proved at the seam feature 080's T042b moved it to.
 *
 * The question is unchanged: an operator command has no route to gate, no worker
 * to gate and no port to resolve, so without a decision of its own it ran
 * whatever `module_registrations` said. What changed is **who asks**. The command
 * is now a manifest declaration the host runs (D-160.9), and
 * `runModuleCommand` asks `requireModuleEnabled` about the **declaring** module —
 * first, before it builds a context and outside every `try` — so a module author
 * writes no presence check and cannot forget one.
 *
 * Both cases below therefore drive `runModuleCommand` over `carts`' own
 * `cliCommands` declaration, which is what an operator's
 * `pnpm cart:abandonment-sweep` reaches through `src/cli.ts`.
 *
 * `contextFor` is a stub rather than a real composition, and that is the point
 * of the first assertion: it **records whether it was called**. A presence
 * answer that arrives after the context is built is a presence answer that
 * arrives after the module's services have been resolved, which is the
 * difference between failing closed and failing closed loudly enough to have
 * already done something.
 *
 * `registryCache` is a process singleton the harness seeds with
 * `__setEnabledForTesting`. Loading it from the database is the point of the
 * first assertion, so the seeded state is restored afterwards exactly as
 * `setupBackendServer` sets it.
 */

describe('cart abandonment-sweep command — module presence', () => {
  let db: TestDb;
  let systemDefaultChannelId: string;

  beforeAll(async () => {
    db = await setupTestDb();
    systemDefaultChannelId = db.systemDefaultChannelId;
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
    registryCache.__setEnabledForTesting(REGISTERED_MANIFESTS.map((e) => e.manifest.id));
  });

  /** An idle cart the sweep would take if it were allowed to run. */
  function seedIdleCart(token: string): CartRow {
    const em = db.em();
    return em.create(Cart, {
      anonymousCartToken: token,
      ...(systemDefaultChannelId ? { salesChannelId: systemDefaultChannelId } : {}),
      lastActivityAt: new Date(Date.now() - 400 * 24 * 60 * 60_000),
    });
  }

  /**
   * A `ModuleContext` carrying the one registration the command reads, plus a
   * record of whether the host asked for it at all.
   *
   * The worker is built here rather than composed for the reason the old file
   * gave for `sweepAbandonedCarts`: `composeApp()` owns the `initOrm` singleton
   * this harness also boots, so composing here would close the server's ORM out
   * from under the rest of the single-fork run. What is under test is the
   * host's gate and the command's body; the composition's own `contextFor` is
   * covered by `test/unit/cli/module-commands.test.ts`.
   */
  function stubContext(em: EntityManager): {
    contextFor: (moduleId: string) => ModuleContext;
    built: () => string[];
  } {
    const built: string[] = [];
    const worker = new CartAbandonmentWorker({
      emFactory: () => em,
      cartAuditService: new CartAuditService(() => em, new AuditLogService(() => em)),
      resolveInactivityMinutes: async () => 60,
      resolveNotificationRecipient: async () => '',
    });
    return {
      built: () => built,
      contextFor: (moduleId) => {
        built.push(moduleId);
        return {
          cradle: () => ({ cartAbandonmentWorker: worker }),
        } as unknown as ModuleContext;
      },
    };
  }

  async function run(em: EntityManager, stub: ReturnType<typeof stubContext>): Promise<number> {
    // The registry has to be loaded from the database for the presence answer
    // to be about the rows this test wrote. `src/cli.ts` gets this from
    // `composeApp()`; here it is the same two kernel ingredients.
    await registryCache.load({
      em: () => em,
      activationDeclarations: activationDeclarationsFrom(
        REGISTERED_MANIFESTS.map((e) => e.manifest),
      ),
    });
    return enterSystemScope(
      'test: cli sweep',
      () =>
        runModuleCommand({
          entries: [{ manifest: { id: 'carts' }, cliCommands }],
          moduleId: 'carts',
          name: 'abandonment-sweep',
          argv: [],
          contextFor: stub.contextFor,
          out: () => {},
          err: () => {},
        }),
      { entryPoint: 'cli' },
    );
  }

  it('refuses with MODULE_DISABLED when the platform registry has no installed carts', async () => {
    const em = db.em();
    // Stated rather than assumed: both cases set the registry row they are
    // about, inside the test transaction, so neither depends on what a
    // developer's database happens to carry.
    await em.nativeDelete(ModuleRegistration, { moduleId: 'carts' });
    const cart = seedIdleCart(`cli-absent-${Date.now()}`);
    await em.flush();
    const stub = stubContext(em);

    await expect(run(em, stub)).rejects.toMatchObject({
      statusCode: 503,
      code: 'MODULE_DISABLED',
      moduleId: 'carts',
    });

    // Decided *before* the work, not caught after it: the host never asked for
    // the module's context, so nothing was resolved and nothing ran.
    expect(stub.built()).toEqual([]);

    // Fail closed means nothing moved, not "moved and then complained".
    const reload = await em.findOneOrFail(Cart, { id: cart.id });
    expect(reload.status).toBe('active');
    expect(await em.find(CartAuditEntry, { cartId: cart.id })).toHaveLength(0);
  });

  it('sweeps once the platform registry has carts installed', async () => {
    const em = db.em();
    await em.nativeDelete(ModuleRegistration, { moduleId: 'carts' });
    em.create(ModuleRegistration, {
      moduleId: 'carts',
      state: 'installed',
      version: '2.0.0',
      installedAt: new Date(),
      lastStateChangeAt: new Date(),
    });
    const cart = seedIdleCart(`cli-present-${Date.now()}`);
    await em.flush();
    const stub = stubContext(em);

    expect(await run(em, stub)).toBe(0);
    expect(stub.built()).toEqual(['carts']);

    const reload = await em.findOneOrFail(Cart, { id: cart.id });
    expect(reload.status).toBe('abandoned');
    const audit = await em.find(CartAuditEntry, { cartId: cart.id });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorType).toBe('sweep');
  });
});
