import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { readChannelSetting, type ChannelSettingReaderDeps } from './channel-setting.js';

/**
 * Issue #773 — the B2C registration gate reads its setting for the request's
 * channel, and outside a request (no resolved channel) it fails closed: it
 * answers the fallback rather than the system-default channel's value. The
 * admin-side settings keep reading the system-default channel.
 */

const CODE = 'customers.allow_registration_without_organization';
const DEFAULT_ID = 'channel-default';

function deps(currentChannelId: string | null): ChannelSettingReaderDeps & {
  get: ReturnType<typeof vi.fn>;
} {
  // The system-default channel allows it; any other channel does not say.
  const get = vi.fn(async (_code: string, channelId: string | null) => channelId === DEFAULT_ID);
  return {
    get,
    settingsReadPort: { get } as unknown as ChannelSettingReaderDeps['settingsReadPort'],
    salesChannelResolutionPort: {
      getSystemDefault: async () => ({ id: DEFAULT_ID }),
    } as unknown as ChannelSettingReaderDeps['salesChannelResolutionPort'],
    currentChannelId: () => currentChannelId,
  };
}

describe('readChannelSetting (issue #773)', () => {
  it("reads the request's channel when one is resolved", async () => {
    const d = deps('channel-b');
    await expect(readChannelSetting(d, CODE, z.boolean(), false, 'request')).resolves.toBe(false);
    expect(d.get).toHaveBeenCalledWith(CODE, 'channel-b', expect.anything());
  });

  it('fails closed outside a request instead of reading the system-default channel', async () => {
    const d = deps(null);
    await expect(readChannelSetting(d, CODE, z.boolean(), false, 'request')).resolves.toBe(false);
    expect(d.get).not.toHaveBeenCalled();
  });

  it('keeps the admin-side reads on the system-default channel', async () => {
    const d = deps('channel-b');
    await expect(readChannelSetting(d, CODE, z.boolean(), false)).resolves.toBe(true);
    expect(d.get).toHaveBeenCalledWith(CODE, DEFAULT_ID, expect.anything());
  });

  it('degrades to the fallback when the read throws', async () => {
    const d = deps('channel-b');
    d.get.mockRejectedValueOnce(new Error('SettingNotRegistered'));
    await expect(readChannelSetting(d, 'x', z.number(), 365, 'request')).resolves.toBe(365);
  });
});
