import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineModuleSettingsManifest } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import {
  SettingNotRegistered,
  SettingOutOfScopeForChannel,
} from '../../../src/kernel/settings/settings.service.js';
import { Setting } from '@endora-commerce/platform/kernel';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * T046 — End-to-end test for the universal getter via the composed
 * backend server (Redis cache included). Confirms that any module that
 * receives `settingsService` from the composition root reads the same
 * data — admin override when present, manifest default otherwise.
 */
describe('SettingsService end-to-end (T046)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await new ManifestReconciler(h.em()).apply([
      defineModuleSettingsManifest({
        moduleCode: 'us3_e2e',
        groups: [],
        settings: [
          {
            code: 'us3_e2e.url',
            name: 'URL',
            valueType: 'string',
            defaultValue: 'https://default.example',
          },
        ],
      }),
    ]);
  });

  afterAll(async () => {
    const em = h.em();
    for (const s of await em.find(Setting, { ownerModule: 'us3_e2e' })) em.remove(s);
    await em.flush();
    h.settings.cacheRegistration.dispose();
    await teardownBackendServer(h);
  });

  it('returns the manifest default for a channel without an override', async () => {
    const channel = await h.em().findOneOrFail(SalesChannel, { code: 'pl_b2b_vip' });
    // Drop any leftover cache entry so we exercise the cold path.
    await h.redis.del(`settings:v1:us3_e2e.url:${channel.id}`);
    const v = await h.settings.settingsService.get(
      'us3_e2e.url',
      channel.id,
      z.string(),
    );
    expect(v).toBe('https://default.example');
  });

  it('returns the admin-set value after a write through the admin service', async () => {
    const channel = await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' });
    await h.settings.adminService.setValueForSubset(
      'us3_e2e.url',
      ['pl_retail'],
      'https://admin-chosen.example',
      null,
      { actorAdminUserId: null },
    );
    const v = await h.settings.settingsService.get(
      'us3_e2e.url',
      channel.id,
      z.string(),
    );
    expect(v).toBe('https://admin-chosen.example');
  });

  it('throws SettingNotRegistered for an unknown code', async () => {
    const channel = await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' });
    await expect(
      h.settings.settingsService.get('does.not.exist.us3', channel.id, z.string()),
    ).rejects.toBeInstanceOf(SettingNotRegistered);
  });

  it('throws SettingOutOfScopeForChannel for a scoped setting outside its channels', async () => {
    // Register a scoped setting at this point so the test set-up is local.
    await new ManifestReconciler(h.em()).apply([
      defineModuleSettingsManifest({
        moduleCode: 'us3_e2e_scope',
        groups: [],
        settings: [
          {
            code: 'us3_e2e.scoped',
            name: 'Scoped',
            valueType: 'string',
            defaultValue: 'x',
            salesChannelCodes: ['pl_retail'],
          },
        ],
      }),
    ]);
    try {
      const out = await h.em().findOneOrFail(SalesChannel, { code: 'pl_b2b_vip' });
      await expect(
        h.settings.settingsService.get('us3_e2e.scoped', out.id, z.string()),
      ).rejects.toBeInstanceOf(SettingOutOfScopeForChannel);
    } finally {
      const em = h.em();
      for (const s of await em.find(Setting, { ownerModule: 'us3_e2e_scope' })) em.remove(s);
      await em.flush();
    }
  });
});
