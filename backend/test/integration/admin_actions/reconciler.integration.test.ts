import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ModuleAction } from '../../helpers/package-entities.js';
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql';
import type { ModuleAction as ModuleActionDecl } from '@endora-commerce/contracts';
import mikroOrmConfig from '../../../src/db/mikro-orm.config.js';
import { AdminActionsReconciler } from '../../../../packages/modules/admin_actions/src/backend/services/admin-actions-reconciler.js';

/**
 * Integration test for the AdminActionsReconciler against a real
 * Postgres (T013, T014 — feature 020 / tasks.md).
 *
 * Drives the reconciler directly. Mirrors feature 019's
 * install-uninstall-bundles pattern — a per-test EM fork plus explicit
 * row cleanup rather than begin/rollback transactions; per-test isolation
 * comes from the unique fixture moduleId. (Until issue #200 the reconciler's
 * UPSERT ran through `em.getKnex().raw(...)` and could not have been rolled
 * back at all; the last test in this file is what holds that fixed.)
 */

const MODULE_ID = 'fixture_admin_actions_test';

describe('AdminActionsReconciler (integration)', () => {
  let orm: MikroORM;
  let em: EntityManager;

  beforeAll(async () => {
    orm = await MikroORM.init(await mikroOrmConfig());
    em = orm.em.fork() as EntityManager;
  }, 60_000);

  beforeEach(async () => {
    em = orm.em.fork() as EntityManager;
    await em.nativeDelete(ModuleAction, { moduleId: MODULE_ID });
  });

  afterEach(async () => {
    await em.nativeDelete(ModuleAction, { moduleId: MODULE_ID });
  });

  afterAll(async () => {
    await orm.close(true);
  });

  function reconciler(): AdminActionsReconciler {
    return new AdminActionsReconciler({ em: () => em });
  }

  const actionA: ModuleActionDecl = {
    id: 'action-a',
    labelKey: 'fixture.actions.a.label',
    icon: 'Plus',
    targetRoute: '/fixture/a',
    keywords: [],
    weight: 100,
  };
  const actionB: ModuleActionDecl = {
    id: 'action-b',
    labelKey: 'fixture.actions.b.label',
    icon: 'Settings',
    targetRoute: '/fixture/b',
    keywords: [],
    weight: 200,
  };

  it('install with one action lands one row', async () => {
    const result = await reconciler().installForModule({
      moduleId: MODULE_ID,
      actions: [actionA],
    });
    expect(result.upserted).toBe(1);
    expect(result.pruned).toBe(0);

    const fresh = orm.em.fork() as EntityManager;
    const rows = await fresh.find(ModuleAction, { moduleId: MODULE_ID });
    expect(rows.length).toBe(1);
    expect(rows[0]?.actionId).toBe('action-a');
    expect(rows[0]?.targetRoute).toBe('/fixture/a');
    expect(rows[0]?.icon).toBe('Plus');
  });

  it('re-running with two actions adds the second row and bumps the first version', async () => {
    const r = reconciler();
    await r.installForModule({ moduleId: MODULE_ID, actions: [actionA] });

    const fresh1 = orm.em.fork() as EntityManager;
    const v1 = (await fresh1.findOne(ModuleAction, {
      moduleId: MODULE_ID,
      actionId: 'action-a',
    }))!;
    const initialVersion = Number(v1.version);

    await r.installForModule({ moduleId: MODULE_ID, actions: [actionA, actionB] });

    const fresh2 = orm.em.fork() as EntityManager;
    const rows = await fresh2.find(
      ModuleAction,
      { moduleId: MODULE_ID },
      { orderBy: { actionId: 'asc' } },
    );
    expect(rows.map((row) => row.actionId)).toEqual(['action-a', 'action-b']);
    const refreshedA = (await fresh2.findOne(ModuleAction, {
      moduleId: MODULE_ID,
      actionId: 'action-a',
    }))!;
    expect(Number(refreshedA.version)).toBeGreaterThan(initialVersion);
  });

  it('re-running with action-a removed prunes the row', async () => {
    const r = reconciler();
    await r.installForModule({ moduleId: MODULE_ID, actions: [actionA, actionB] });

    const result = await r.installForModule({ moduleId: MODULE_ID, actions: [actionB] });
    expect(result.upserted).toBe(1);
    expect(result.pruned).toBe(1);

    const fresh = orm.em.fork() as EntityManager;
    const rows = await fresh.find(ModuleAction, { moduleId: MODULE_ID });
    expect(rows.map((row) => row.actionId)).toEqual(['action-b']);
  });

  it('removeForModule deletes every action row for the module', async () => {
    const r = reconciler();
    await r.installForModule({ moduleId: MODULE_ID, actions: [actionA, actionB] });

    const fresh1 = orm.em.fork() as EntityManager;
    expect((await fresh1.find(ModuleAction, { moduleId: MODULE_ID })).length).toBe(2);

    const result = await r.removeForModule({ moduleId: MODULE_ID });
    expect(result.removed).toBe(2);

    const fresh2 = orm.em.fork() as EntityManager;
    const rows = await fresh2.find(ModuleAction, { moduleId: MODULE_ID });
    expect(rows.length).toBe(0);
  });

  it('empty actions array on a previously-populated module prunes everything', async () => {
    const r = reconciler();
    await r.installForModule({ moduleId: MODULE_ID, actions: [actionA, actionB] });

    const result = await r.installForModule({ moduleId: MODULE_ID, actions: [] });
    expect(result.upserted).toBe(0);
    expect(result.pruned).toBe(2);

    const fresh = orm.em.fork() as EntityManager;
    const rows = await fresh.find(ModuleAction, { moduleId: MODULE_ID });
    expect(rows.length).toBe(0);
  });

  it('UPSERT is idempotent — re-running with the same payload does not duplicate', async () => {
    const r = reconciler();
    await r.installForModule({ moduleId: MODULE_ID, actions: [actionA] });
    await r.installForModule({ moduleId: MODULE_ID, actions: [actionA] });
    await r.installForModule({ moduleId: MODULE_ID, actions: [actionA] });

    const fresh = orm.em.fork() as EntityManager;
    const rows = await fresh.find(ModuleAction, { moduleId: MODULE_ID });
    expect(rows.length).toBe(1);
  });

  /**
   * Issue #200 — `installForModule` takes an `em`, and half of what it does
   * used to ignore it: the UPSERT ran through `em.getKnex().raw(...)`, which
   * carries no transaction context, while the prune next to it went through
   * `em.nativeDelete`. A caller that handed in a transactional em therefore got
   * a method that committed its inserts and rolled back its deletes.
   */
  it('rolls the UPSERT back with the transaction it was handed', async () => {
    const tx = orm.em.fork() as EntityManager;
    await expect(
      tx.transactional(async (txEm) => {
        await reconciler().installForModule({
          moduleId: MODULE_ID,
          actions: [actionA],
          em: txEm,
        });
        throw new Error('roll this back');
      }),
    ).rejects.toThrow('roll this back');

    const fresh = orm.em.fork() as EntityManager;
    const rows = await fresh.find(ModuleAction, { moduleId: MODULE_ID });
    expect(rows.length).toBe(0);
  });
});
