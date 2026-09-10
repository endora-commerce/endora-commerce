import { dirname, join, resolve } from 'node:path';
import { ModuleAction } from '../../helpers/package-entities.js';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { defineModuleManifest } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { AuditLogService } from '@endora-commerce/platform/composition';
import { ModuleRegistration } from '@endora-commerce/platform/composition';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { TranslationBundle } from '../../helpers/package-entities.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import {
  buildStaticRegistry,
  ModuleLifecycleOrchestrator,
} from '@endora-commerce/platform/lifecycle';
import { migrationOwnershipOf } from '../../../src/db/configured-migrations.js';

/**
 * Feature 080, T036a / D-159 — `module:install` writes the projections the
 * manifest declares, and `module:uninstall --hard` takes them away again.
 *
 * The orchestrator here is built the way `scripts/install.ts` builds one: a
 * registry from `buildStaticRegistry` over the resolved manifest entries, and
 * **no reconciler injected** — because a platform command composes no container
 * and could resolve none. Before this task that shape wrote no
 * `translation_bundles` row and no `module_actions` row at all, silently.
 *
 * **How wide the gap was, measured rather than repeated.** D-159 describes this
 * as the terminal and the admin screen disagreeing, and the tree says something
 * narrower and worse: `grep -rn 'orchestrator.install' backend/src` returns the
 * two CLI scripts and nothing else. The platform axis has no HTTP surface at
 * all — `routes.admin.ts` says so, *"installing … a module at deployment level
 * is deployment-operator work"*, E-2 deferred — so `composition.ts` was handing
 * the two reconcilers to an orchestrator whose `install` nobody called. There
 * was no second answer: on **every** path, an install reconciled nothing and
 * only the next boot repaired it.
 *
 * The **hard uninstall** case is the one with no cure at all. Both boot
 * reconcilers iterate the whole manifest registry rather than the installed
 * set, so an install the CLI skipped self-heals at the next platform start; a
 * hard uninstall followed by `pnpm remove` leaves rows behind that no boot pass
 * will ever see a manifest for.
 *
 * The fixture module carries a real on-disk bundle directory, so the i18n
 * participant's filesystem read is exercised rather than stubbed: its
 * `modulePath` comes from `dirname(entry.filePath)`, which is the field the
 * registry has to carry all the way from the resolver.
 */

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(here, '../../fixtures/_i18n_integration/demo_module');
const MODULE_ID = 'fixture_projection_module';

const fixtureManifest = defineModuleManifest({
  id: MODULE_ID,
  name: 'Fixture projection module',
  version: '1.0.0',
  dependencies: [],
  i18n: { bundlesDir: 'i18n' },
  actions: [
    {
      id: 'open',
      labelKey: 'actions.open.label',
      icon: 'Settings',
      targetRoute: '/fixture-projection',
      keywords: [],
      weight: 100,
    },
  ],
});

/** Exactly what `scripts/install.ts` hands the orchestrator, plus the fixture. */
function cliShapedOrchestrator(db: TestDb, redis: Redis): ModuleLifecycleOrchestrator {
  const registry = buildStaticRegistry([
    ...REGISTERED_MANIFESTS,
    { manifest: fixtureManifest, filePath: join(FIXTURE_DIR, 'manifest.ts') },
  ]);
  return new ModuleLifecycleOrchestrator({
    orm: db.orm,
    redis,
    em: () => db.em(),
    auditLog: new AuditLogService(() => db.em()),
    registry,
    // The one thing the real CLI genuinely cannot supply — see
    // `OrchestratorDeps.migrationOwnership`. The fixture owns no migration and
    // saying so is what lets its hard uninstall proceed.
    migrationOwnership: migrationOwnershipOf([], [MODULE_ID]),
    migratorFor: async () =>
      ({
        getPendingMigrations: async () => [],
        up: async () => [],
        down: async () => [],
      }) as never,
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
}

describe('a module: command reconciles the manifest projections [integration]', () => {
  let db: TestDb;
  let redis: Redis;

  beforeAll(async () => {
    db = await setupTestDb();
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      lazyConnect: false,
    });
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
    await db.em().nativeDelete(ModuleRegistration, { moduleId: MODULE_ID });
    await db.em().nativeDelete(TranslationBundle, { moduleId: MODULE_ID });
    await db.em().nativeDelete(ModuleAction, { moduleId: MODULE_ID });
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  it('writes the bundles and the palette actions, with no reconciler injected', async () => {
    const result = await cliShapedOrchestrator(db, redis).install(MODULE_ID);
    expect(result.state).toBe('installed');

    const bundles = await db.em().find(TranslationBundle, { moduleId: MODULE_ID });
    expect(bundles.map((b) => b.languageCode).sort()).toEqual(['en', 'pl']);

    const actions = await db.em().find(ModuleAction, { moduleId: MODULE_ID });
    expect(actions.map((a) => a.actionId)).toEqual(['open']);
    expect(actions[0]?.targetRoute).toBe('/fixture-projection');
  });

  it('takes both away on a hard uninstall — the case with no other cure', async () => {
    const orchestrator = cliShapedOrchestrator(db, redis);
    await orchestrator.install(MODULE_ID);
    // Asserted before the uninstall, because "there are no rows" is what an
    // orchestrator that reconciles nothing at all answers too: without this the
    // case below is green on a platform where install writes nothing, which is
    // precisely the defect being closed.
    expect(await db.em().find(TranslationBundle, { moduleId: MODULE_ID })).toHaveLength(2);
    expect(await db.em().find(ModuleAction, { moduleId: MODULE_ID })).toHaveLength(1);

    const result = await orchestrator.uninstall(MODULE_ID, { hard: true });
    expect(result.state).toBe('uninstalled');

    expect(await db.em().find(TranslationBundle, { moduleId: MODULE_ID })).toHaveLength(0);
    expect(await db.em().find(ModuleAction, { moduleId: MODULE_ID })).toHaveLength(0);
  });

  it('leaves both in place on a SOFT uninstall, so a re-install finds them unchanged', async () => {
    const orchestrator = cliShapedOrchestrator(db, redis);
    await orchestrator.install(MODULE_ID);

    await orchestrator.uninstall(MODULE_ID, { hard: false });

    expect(await db.em().find(TranslationBundle, { moduleId: MODULE_ID })).toHaveLength(2);
    expect(await db.em().find(ModuleAction, { moduleId: MODULE_ID })).toHaveLength(1);
  });

  it('succeeds with the command palette switched off, and writes its rows anyway', async () => {
    // The owner's ruling, D-159 §9 (2026-08-22). `admin_actions` declares an
    // activation control, and its reconciler used to reach the orchestrator as
    // a gated port — so an operator with ⌘K switched off could not install an
    // *unrelated* module: the resolution threw `MODULE_DISABLED` and aborted
    // the whole operation. The participant is invoked from the manifest and is
    // gated on nothing, so the install succeeds and the rows are written. They
    // are inert while the palette is off, and the palette answers from them
    // unchanged when it comes back.
    const enabledIds = REGISTERED_MANIFESTS.map((e) => e.manifest.id);
    registryCache.__setEnabledForTesting(enabledIds, { deactivated: ['admin_actions'] });
    try {
      const result = await cliShapedOrchestrator(db, redis).install(MODULE_ID);

      expect(result.state).toBe('installed');
      expect(await db.em().find(ModuleAction, { moduleId: MODULE_ID })).toHaveLength(1);
    } finally {
      registryCache.__setEnabledForTesting(enabledIds);
    }
  });
});
