import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { BrandingService } from '../../../../packages/modules/transactional_emails/src/backend/services/branding.service.js';
import {
  SettingNotRegistered,
  SettingOutOfScopeForChannel,
  type SettingsService,
} from '../../../src/kernel/settings/settings.service.js';

/**
 * D-48 / L3 — the branding reader's scope argument.
 *
 * `BrandingService` used to translate "no channel" into the nil UUID
 * `00000000-0000-0000-0000-000000000000`. That is well-formed, so it passed the
 * settings seam guard, matched no `setting_values` row and fell through to
 * `global_value ?? default_value` — the right answer, reached by accident. Two
 * costs came with it: a setting scoped to a channel subset threw
 * `SettingOutOfScopeForChannel` rather than answering, and the settings cache
 * wrote under a fake channel key instead of the reserved `__global__` segment,
 * which no invalidation targets.
 *
 * `SettingsService.get` has taken `salesChannelId: string | null` since D-41,
 * and `null` is the sanctioned platform-wide read.
 */
describe('BrandingService scope argument', () => {
  const CHANNEL_ID = '4b1f0a2c-8e3d-4a7b-9c11-2f6d5e8a0b34';
  const NIL_UUID = '00000000-0000-0000-0000-000000000000';

  function settingsStub(get: SettingsService['get']): SettingsService {
    return { get } as unknown as SettingsService;
  }

  it('reads platform-wide with null when there is no channel, never the nil uuid', async () => {
    const get = vi.fn(async (_code: string, _channelId: string | null, _schema: z.ZodType) => 'x');
    const svc = new BrandingService(settingsStub(get as unknown as SettingsService['get']));

    const resolved = await svc.resolve(null);

    expect(resolved.source).toBe('global');
    expect(get).toHaveBeenCalled();
    for (const call of get.mock.calls) {
      expect(call[1]).toBeNull();
    }
    expect(JSON.stringify(get.mock.calls)).not.toContain(NIL_UUID);
  });

  it('passes a channel id straight through when there is one', async () => {
    const get = vi.fn(async (_code: string, _channelId: string | null, _schema: z.ZodType) => 'x');
    const svc = new BrandingService(settingsStub(get as unknown as SettingsService['get']));

    await svc.resolve(CHANNEL_ID);

    for (const call of get.mock.calls) {
      expect(call[1]).toBe(CHANNEL_ID);
    }
  });

  it('degrades to the compiled-in defaults for an unregistered setting', async () => {
    const get = vi.fn(async (code: string) => {
      throw new SettingNotRegistered(code);
    });
    const svc = new BrandingService(settingsStub(get as unknown as SettingsService['get']));

    const resolved = await svc.resolve(null);

    expect(resolved.logoAssetId).toBe('');
    expect(resolved.accentColor).toBe('#1f2937');
    expect(resolved.headerBlockCode).toBe('default_email_header');
    expect(resolved.footerBlockCode).toBe('default_email_footer');
  });

  it('degrades for a subset-scoped setting that has no platform-wide value', async () => {
    const get = vi.fn(async (code: string, channelId: string | null) => {
      throw new SettingOutOfScopeForChannel(code, channelId);
    });
    const svc = new BrandingService(settingsStub(get as unknown as SettingsService['get']));

    await expect(svc.resolve(null)).resolves.toMatchObject({ accentColor: '#1f2937' });
  });

  /**
   * The bare `catch` this replaces would have swallowed a `MODULE_DISABLED`
   * envelope too, turning fail-closed into fail-open (composition rule 7).
   */
  it('propagates anything that is not a settings-resolution condition', async () => {
    const get = vi.fn(async () => {
      throw new Error('module "settings" is disabled');
    });
    const svc = new BrandingService(settingsStub(get as unknown as SettingsService['get']));

    await expect(svc.resolve(null)).rejects.toThrow('module "settings" is disabled');
  });
});
