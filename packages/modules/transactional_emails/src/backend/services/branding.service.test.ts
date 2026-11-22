import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { SettingsAdminPort } from '@endora-commerce/contracts';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import { HttpError } from '@endora-commerce/platform/http';
import { TRANSACTIONAL_EMAILS_SETTING_CODES as C } from '../../manifest.js';
import { BrandingService } from './branding.service.js';

/**
 * Issue #1588 — a sales channel's branding override can be removed again, so
 * the channel inherits the all-channels value. The service names the setting
 * codes behind the fields and asks `settings` to drop that channel's own value;
 * it never writes the all-channels value back as a copy.
 */
describe('BrandingService.reset', () => {
  const CHANNEL_ID = '4b1f0a2c-8e3d-4a7b-9c11-2f6d5e8a0b34';
  const ACTOR = { actorAdminUserId: 'admin-1' };

  function serviceWith(channel: { code: string } | null) {
    const admin = {
      setValueForAllChannels: vi.fn(),
      setValueForSubset: vi.fn(),
      resetValuesForSubset: vi.fn(async () => ({ resetChannelIds: [CHANNEL_ID], newVersion: 'v2' })),
    } satisfies SettingsAdminPort;
    const em = { findOne: vi.fn(async () => channel) } as unknown as EntityManager;
    const settings = { get: vi.fn(async () => 'x'), getMany: vi.fn() } as unknown as SettingsReadPort;
    const service = new BrandingService(settings, undefined, { admin, emFactory: () => em });
    return { service, admin };
  }

  it("removes the channel's own value for each named field, and nothing else", async () => {
    const { service, admin } = serviceWith({ code: 'b2b-pl' });

    const resolved = await service.reset(CHANNEL_ID, ['accentColor', 'logoAssetId'], ACTOR);

    expect(admin.resetValuesForSubset.mock.calls).toEqual([
      [C.ACCENT_COLOR, ['b2b-pl'], ACTOR],
      [C.LOGO_ASSET_ID, ['b2b-pl'], ACTOR],
    ]);
    expect(admin.setValueForSubset).not.toHaveBeenCalled();
    expect(admin.setValueForAllChannels).not.toHaveBeenCalled();
    expect(resolved.salesChannelId).toBe(CHANNEL_ID);
  });

  it('refuses an unknown sales channel with a 404 and writes nothing', async () => {
    const { service, admin } = serviceWith(null);

    const error = await service.reset(CHANNEL_ID, ['accentColor'], ACTOR).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).statusCode).toBe(404);
    expect(admin.resetValuesForSubset).not.toHaveBeenCalled();
  });

  it('refuses when no write path is configured', async () => {
    const settings = { get: vi.fn(async () => 'x'), getMany: vi.fn() } as unknown as SettingsReadPort;
    const service = new BrandingService(settings);

    await expect(service.reset(CHANNEL_ID, ['accentColor'], ACTOR)).rejects.toThrow(
      'Branding write is not configured.',
    );
  });
});
