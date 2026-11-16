import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  SettingWriteValidationInput,
  SettingWriteValidator,
} from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { EventBus } from '@endora-commerce/platform/events';
import { HttpError } from '@endora-commerce/platform/http';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { Setting } from '@endora-commerce/platform/kernel';
import { SettingValue } from '@endora-commerce/platform/kernel';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { defineModuleSettingsManifest } from '@endora-commerce/contracts';
import { settingsManifest } from '../../../../packages/modules/settings/src/manifest.js';
import { SettingsAdminService } from '../../../../packages/modules/settings/src/backend/services/settings-admin.service.js';
import { SettingWriteValidatorRegistry } from '../../../../packages/modules/settings/src/backend/services/setting-write-validators.js';

/**
 * Feature 078, D-95.2 — the seam, exercised with a **fake** validator.
 *
 * `settings` tests must not depend on `invoices`: the division of labour is the
 * point of the seam, and a test that reached for the real validator would be
 * asserting the two halves together.
 */

const CODE = 'wv_mod.knob';
const ENUM_CODE = 'wv_mod.choice';

const manifest = defineModuleSettingsManifest({
  moduleCode: 'wv_mod',
  groups: [],
  settings: [
    { code: CODE, name: 'Knob', valueType: 'string', defaultValue: 'default' },
    {
      code: ENUM_CODE,
      name: 'Choice',
      valueType: 'string',
      defaultValue: 'a',
      enumOptions: ['a', 'b'],
    },
  ],
});

const noCache = {
  invalidateAfterWrite: async () => null,
  invalidateAllAfterWrite: async () => null,
};

const ACTOR = { actorAdminUserId: null };

describe('settings — contributed write validators', () => {
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

  function build(validator?: SettingWriteValidator, presence?: (id: string) => boolean) {
    const registry = new SettingWriteValidatorRegistry(
      presence
        ? { presenceOf: (id) => presence(id), activationControlOwner: () => undefined }
        : undefined,
    );
    if (validator) registry.register(validator);
    const service = new SettingsAdminService(
      () => db.em(),
      new EventBus(),
      noCache,
      undefined,
      undefined,
      undefined,
      registry,
    );
    return { registry, service };
  }

  function recorder(behaviour?: (input: SettingWriteValidationInput) => void): {
    validator: SettingWriteValidator;
    seen: SettingWriteValidationInput[];
  } {
    const seen: SettingWriteValidationInput[] = [];
    return {
      seen,
      validator: {
        contributorModuleId: 'wv_mod',
        codes: [CODE, ENUM_CODE],
        validate: async (input) => {
          seen.push(input);
          behaviour?.(input);
        },
      },
    };
  }

  async function seed(): Promise<void> {
    await new ManifestReconciler(db.em()).apply([settingsManifest, manifest]);
  }

  it('runs on both write paths and lets the refusal reach the caller unchanged', async () => {
    try {
      await seed();
      const refuse = recorder(() => {
        throw new HttpError(400, 'VALIDATION_FAILED', 'refused by the owning module');
      });
      const { service } = build(refuse.validator);

      await expect(
        service.setValueForAllChannels(CODE, 'x', null, ACTOR),
      ).rejects.toThrow('refused by the owning module');

      const channel = await db.em().findOne(SalesChannel, { systemDefault: true });
      await expect(
        service.setValueForSubset(CODE, [channel!.code], 'y', null, ACTOR),
      ).rejects.toThrow('refused by the owning module');

      expect(refuse.seen).toHaveLength(2);
    } finally {
      await db.rollbackTx();
    }
  });

  it('runs after the shape and enum checks, so a wrong value never reaches it', async () => {
    try {
      await seed();
      const seenAll = recorder();
      const { service } = build(seenAll.validator);

      await expect(
        service.setValueForAllChannels(ENUM_CODE, 'not-an-option', null, ACTOR),
      ).rejects.toThrow(/must be one of/);
      expect(seenAll.seen).toHaveLength(0);
    } finally {
      await db.rollbackTx();
    }
  });

  it('runs before persistence, so a refusal leaves the stored value untouched', async () => {
    try {
      await seed();
      const accept = recorder();
      const accepting = build(accept.validator);
      const first = await accepting.service.setValueForAllChannels(CODE, 'kept', null, ACTOR);

      const refuse = recorder(() => {
        throw new HttpError(400, 'VALIDATION_FAILED', 'no');
      });
      const refusing = build(refuse.validator);
      await expect(
        refusing.service.setValueForAllChannels(CODE, 'discarded', null, ACTOR),
      ).rejects.toThrow('no');

      const stored = await db.em().findOne(Setting, { code: CODE });
      expect(stored?.globalValue).toBe('kept');
      const after = await accepting.service.setValueForAllChannels(
        CODE,
        'kept',
        first.newVersion,
        ACTOR,
      );
      expect(after.newVersion).toBeTruthy();
    } finally {
      await db.rollbackTx();
    }
  });

  it('does not enumerate a validator whose contributing module is switched off', async () => {
    try {
      await seed();
      const refuse = recorder(() => {
        throw new HttpError(400, 'VALIDATION_FAILED', 'should never run');
      });
      const { service } = build(refuse.validator, () => false);

      await service.setValueForAllChannels(CODE, 'written', null, ACTOR);
      expect(refuse.seen).toHaveLength(0);
      expect((await db.em().findOne(Setting, { code: CODE }))?.globalValue).toBe('written');
    } finally {
      await db.rollbackTx();
    }
  });

  it('projects three-tier resolution: an own row beats a platform-wide write', async () => {
    try {
      await seed();
      const em = db.em();
      const channels = await em.find(SalesChannel, {});
      const pinned = channels[0]!;
      const setting = await em.findOne(Setting, { code: CODE });
      em.create(SettingValue, { setting: setting!, salesChannel: pinned, value: 'its own' });
      await em.flush();

      const seenAll = recorder();
      const { service } = build(seenAll.validator);
      await service.setValueForAllChannels(CODE, 'proposed globally', null, ACTOR);

      const [input] = seenAll.seen;
      expect(input!.targetedChannelIds).toEqual([]);
      const byId = new Map(input!.projection.map((p) => [p.salesChannelId, p.value]));
      expect(byId.get(pinned.id)).toBe('its own');
      for (const channel of channels.filter((c) => c.id !== pinned.id)) {
        expect(byId.get(channel.id)).toBe('proposed globally');
      }
    } finally {
      await db.rollbackTx();
    }
  });

  it('hands over the value being written, which the projection can leave out entirely', async () => {
    // A platform-wide write reaches no channel that carries a row of its own.
    // When every channel does, the proposed value is in nobody's projection —
    // and a rule about the value itself (a size limit, say) would never see
    // what is about to be stored. So the value travels beside the projection.
    try {
      await seed();
      const em = db.em();
      const channels = await em.find(SalesChannel, {});
      const setting = await em.findOne(Setting, { code: CODE });
      for (const channel of channels) {
        em.create(SettingValue, { setting: setting!, salesChannel: channel, value: 'its own' });
      }
      await em.flush();

      const seenAll = recorder();
      const { service } = build(seenAll.validator);
      await service.setValueForAllChannels(CODE, 'proposed globally', null, ACTOR);
      await service.setValueForSubset(CODE, [channels[0]!.code], 'proposed for one', null, ACTOR);

      const [platformWide, subset] = seenAll.seen;
      expect(platformWide!.projection.map((p) => p.value)).not.toContain('proposed globally');
      expect(platformWide!.proposedValue).toBe('proposed globally');
      expect(subset!.proposedValue).toBe('proposed for one');
    } finally {
      await db.rollbackTx();
    }
  });
  it('hands over every value stored before the write, so a re-saved value is not a new one (issue #544)', async () => {
    try {
      await seed();
      const em = db.em();
      const [pinned] = await em.find(SalesChannel, {}, { orderBy: { code: 'asc' } });
      const setting = await em.findOne(Setting, { code: CODE });
      setting!.globalValue = 'stored globally';
      em.create(SettingValue, { setting: setting!, salesChannel: pinned!, value: 'its own' });
      await em.flush();

      const seenAll = recorder();
      const { service } = build(seenAll.validator);
      await service.setValueForAllChannels(CODE, 'proposed globally', null, ACTOR);

      const [input] = seenAll.seen;
      expect([...(input!.currentValues ?? [])].sort()).toEqual(['its own', 'stored globally']);
    } finally {
      await db.rollbackTx();
    }
  });

  it('reads the manifest default as the value in force when nothing is stored', async () => {
    try {
      await seed();
      const seenAll = recorder();
      const { service } = build(seenAll.validator);
      await service.setValueForAllChannels(CODE, 'first write', null, ACTOR);
      expect(seenAll.seen[0]!.currentValues).toEqual(['default']);
    } finally {
      await db.rollbackTx();
    }
  });
});
