import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  SettingWriteValidationInput,
  SettingWriteValidator,
} from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { EventBus } from '@endora-commerce/platform/events';
import { HttpError } from '../../../src/http/error-envelope.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';
import { SettingValue } from '../../../src/kernel/settings/setting-value.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
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
});
