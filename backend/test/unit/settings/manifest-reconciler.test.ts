import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defineModuleSettingsManifest } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import {
  BreakingChangeRejected,
  GroupCodeConflict,
  ManifestReconciler,
  ManifestSchemaInvalid,
  SettingCodeConflict,
} from '../../../src/kernel/settings/manifest-reconciler.js';
import { Setting } from '@endora-commerce/platform/kernel';
import { SettingGroup } from '@endora-commerce/platform/kernel';
import { settingsManifest } from '../../../../packages/modules/settings/src/manifest.js';

/**
 * T021 — Reconciler unit tests against the real test DB (Constitution
 * Principle III: integration tests use real Postgres; this is a focused
 * scenario-by-scenario suite, hosted under `unit/` for organisation but using
 * the same DB harness because the reconciler is hard to mock meaningfully).
 */
describe('ManifestReconciler (T021)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTx();
  });

  async function rollback() {
    await db.rollbackTx();
  }

  it('seeds the built-in general group on first apply', async () => {
    try {
      const em = db.em();
      const reconciler = new ManifestReconciler(em);
      await reconciler.apply([settingsManifest]);

      const general = await em.findOne(SettingGroup, { code: 'general' });
      expect(general).toBeTruthy();
      expect(general?.isSystemProtected).toBe(true);
      expect(general?.ownerModule).toBe('settings');
    } finally {
      await rollback();
    }
  });

  it('is a no-op on a second apply with identical input', async () => {
    try {
      const em = db.em();
      const reconciler = new ManifestReconciler(em);
      await reconciler.apply([settingsManifest]);
      const result = await reconciler.apply([settingsManifest]);
      expect(result.totalAddedGroups).toBe(0);
      expect(result.totalAddedSettings).toBe(0);
    } finally {
      await rollback();
    }
  });

  it('rejects two modules trying to own the same setting code', async () => {
    try {
      const em = db.em();
      const reconciler = new ManifestReconciler(em);
      await reconciler.apply([settingsManifest]);

      const a = defineModuleSettingsManifest({
        moduleCode: 'mod_a',
        groups: [],
        settings: [
          {
            code: 'shared.flag',
            name: 'Shared Flag',
            valueType: 'boolean',
            defaultValue: false,
          },
        ],
      });
      const b = defineModuleSettingsManifest({
        moduleCode: 'mod_b',
        groups: [],
        settings: [
          {
            code: 'shared.flag',
            name: 'Shared Flag',
            valueType: 'boolean',
            defaultValue: true,
          },
        ],
      });

      await reconciler.apply([a]);
      await expect(reconciler.apply([b])).rejects.toBeInstanceOf(SettingCodeConflict);
    } finally {
      await rollback();
    }
  });

  it('rejects breaking valueType change without --force', async () => {
    try {
      const em = db.em();
      const reconciler = new ManifestReconciler(em);
      await reconciler.apply([settingsManifest]);

      const v1 = defineModuleSettingsManifest({
        moduleCode: 'mod_x',
        groups: [],
        settings: [
          {
            code: 'mod_x.knob',
            name: 'Knob',
            valueType: 'string',
            defaultValue: 'a',
          },
        ],
      });
      const v2 = defineModuleSettingsManifest({
        moduleCode: 'mod_x',
        groups: [],
        settings: [
          {
            code: 'mod_x.knob',
            name: 'Knob',
            valueType: 'number',
            defaultValue: 42,
          },
        ],
      });

      await reconciler.apply([v1]);
      await expect(reconciler.apply([v2])).rejects.toBeInstanceOf(BreakingChangeRejected);
    } finally {
      await rollback();
    }
  });

  it('accepts breaking change with force=true', async () => {
    try {
      const em = db.em();
      const reconciler = new ManifestReconciler(em);
      await reconciler.apply([settingsManifest]);

      const v1 = defineModuleSettingsManifest({
        moduleCode: 'mod_y',
        groups: [],
        settings: [
          {
            code: 'mod_y.knob',
            name: 'Knob',
            valueType: 'string',
            defaultValue: 'a',
          },
        ],
      });
      const v2 = defineModuleSettingsManifest({
        moduleCode: 'mod_y',
        groups: [],
        settings: [
          {
            code: 'mod_y.knob',
            name: 'Knob',
            valueType: 'number',
            defaultValue: 42,
          },
        ],
      });

      await reconciler.apply([v1]);
      await reconciler.apply([v2], { force: true });
      const stored = await em.findOne(Setting, { code: 'mod_y.knob' });
      expect(stored?.valueType).toBe('number');
      expect(stored?.defaultValue).toBe(42);
    } finally {
      await rollback();
    }
  });

  /**
   * Feature 078, D-95.3 move 4 — the declared default migration.
   *
   * `BreakingChangeRejected` refuses any `defaultValue` change at boot, and no
   * composition root passes `force`, so changing a shipped default takes every
   * existing deployment down at start-up. `previousDefaultValues` is how a
   * module declares which prior value it is safe to move from — the same shape,
   * and the same self-healing argument, as the sanctioned `string` → `secret`
   * valueType upgrade beside it.
   */
  describe('previousDefaultValues (D-95.3)', () => {
    function knob(defaultValue: string, previous?: readonly string[]) {
      return defineModuleSettingsManifest({
        moduleCode: 'mod_pdv',
        groups: [],
        settings: [
          {
            code: 'mod_pdv.pattern',
            name: 'Pattern',
            valueType: 'string',
            defaultValue,
            ...(previous ? { previousDefaultValues: [...previous] } : {}),
          },
        ],
      });
    }

    it('migrates a stored default the manifest declares it supersedes', async () => {
      try {
        const em = db.em();
        const reconciler = new ManifestReconciler(em);
        await reconciler.apply([settingsManifest]);
        await reconciler.apply([knob('FV {seq}/{YYYY}')]);

        const result = await reconciler.apply([
          knob('FV {seq}/{channel}/{YYYY}', ['FV {seq}/{YYYY}']),
        ]);

        const stored = await em.findOne(Setting, { code: 'mod_pdv.pattern' });
        expect(stored?.defaultValue).toBe('FV {seq}/{channel}/{YYYY}');
        expect(result.perModule.find((m) => m.moduleCode === 'mod_pdv')?.updatedSettings).toBe(1);
      } finally {
        await rollback();
      }
    });

    it('still refuses a stored default the manifest does not declare', async () => {
      try {
        const em = db.em();
        const reconciler = new ManifestReconciler(em);
        await reconciler.apply([settingsManifest]);
        await reconciler.apply([knob('OPERATOR CHOICE {seq}')]);

        await expect(
          reconciler.apply([knob('FV {seq}/{channel}/{YYYY}', ['FV {seq}/{YYYY}'])]),
        ).rejects.toBeInstanceOf(BreakingChangeRejected);
      } finally {
        await rollback();
      }
    });

    it('leaves a manifest without the declaration exactly as it was', async () => {
      try {
        const em = db.em();
        const reconciler = new ManifestReconciler(em);
        await reconciler.apply([settingsManifest]);
        await reconciler.apply([knob('FV {seq}/{YYYY}')]);

        await expect(
          reconciler.apply([knob('FV {seq}/{channel}/{YYYY}')]),
        ).rejects.toBeInstanceOf(BreakingChangeRejected);
      } finally {
        await rollback();
      }
    });

    it('keeps force overriding both paths', async () => {
      try {
        const em = db.em();
        const reconciler = new ManifestReconciler(em);
        await reconciler.apply([settingsManifest]);
        await reconciler.apply([knob('OPERATOR CHOICE {seq}')]);

        await reconciler.apply([knob('FV {seq}/{channel}/{YYYY}', ['FV {seq}/{YYYY}'])], {
          force: true,
        });
        const stored = await em.findOne(Setting, { code: 'mod_pdv.pattern' });
        expect(stored?.defaultValue).toBe('FV {seq}/{channel}/{YYYY}');
      } finally {
        await rollback();
      }
    });
  });

  it('rejects defaultValue mismatched against valueType', async () => {
    try {
      const em = db.em();
      const reconciler = new ManifestReconciler(em);
      const bad = defineModuleSettingsManifest({
        moduleCode: 'mod_z',
        groups: [],
        settings: [
          {
            code: 'mod_z.knob',
            name: 'Knob',
            valueType: 'number',
            defaultValue: 'not a number',
          },
        ],
      });
      await expect(reconciler.apply([settingsManifest, bad])).rejects.toBeInstanceOf(
        ManifestSchemaInvalid,
      );
    } finally {
      await rollback();
    }
  });

  it('rejects two modules trying to own the same group code', async () => {
    try {
      const em = db.em();
      const reconciler = new ManifestReconciler(em);
      await reconciler.apply([settingsManifest]);

      const a = defineModuleSettingsManifest({
        moduleCode: 'mod_a',
        groups: [{ code: 'shared_group', name: 'Shared' }],
        settings: [],
      });
      const b = defineModuleSettingsManifest({
        moduleCode: 'mod_b',
        groups: [{ code: 'shared_group', name: 'Shared' }],
        settings: [],
      });

      await reconciler.apply([a]);
      await expect(reconciler.apply([b])).rejects.toBeInstanceOf(GroupCodeConflict);
    } finally {
      await rollback();
    }
  });

  it('reports orphans without removing them', async () => {
    try {
      const em = db.em();
      const reconciler = new ManifestReconciler(em);
      await reconciler.apply([settingsManifest]);

      const v1 = defineModuleSettingsManifest({
        moduleCode: 'orph',
        groups: [],
        settings: [
          {
            code: 'orph.a',
            name: 'A',
            valueType: 'string',
            defaultValue: '',
          },
          {
            code: 'orph.b',
            name: 'B',
            valueType: 'string',
            defaultValue: '',
          },
        ],
      });
      const v2 = defineModuleSettingsManifest({
        moduleCode: 'orph',
        groups: [],
        settings: [
          {
            code: 'orph.a',
            name: 'A',
            valueType: 'string',
            defaultValue: '',
          },
        ],
      });

      await reconciler.apply([v1]);
      const r2 = await reconciler.apply([v2]);
      const mod = r2.perModule.find((m) => m.moduleCode === 'orph')!;
      expect(mod.orphanSettings).toEqual(['orph.b']);

      // The orphan row is still present.
      const stillThere = await em.findOne(Setting, { code: 'orph.b' });
      expect(stillThere).toBeTruthy();
    } finally {
      await rollback();
    }
  });
});
