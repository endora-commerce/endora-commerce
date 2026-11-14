import { describe, expect, it, vi } from 'vitest';
import { SettingNotRegistered, SettingOutOfScopeForChannel } from '@endora-commerce/platform/kernel';
import { resolveCustomerStorefrontUrl } from './storefront-url.js';

/**
 * The customer e-mail's storefront address: the channel's
 * `sales_channels.storefront_url`, then `STOREFRONT_BASE_URL` — the setting's
 * own definition (`sales_channels/src/manifest.ts`) — and never a third rung.
 */
describe('resolveCustomerStorefrontUrl', () => {
  const channelId = '00000000-0000-4000-8000-000000000001';

  it('answers the channel setting, trimmed, when it is set', async () => {
    const read = vi.fn(async () => '  https://shop.example.com  ');
    await expect(
      resolveCustomerStorefrontUrl(read, channelId, { STOREFRONT_BASE_URL: 'https://env.example.com' }),
    ).resolves.toBe('https://shop.example.com');
    expect(read).toHaveBeenCalledWith(channelId);
  });

  it('falls back to STOREFRONT_BASE_URL when the setting is null', async () => {
    await expect(
      resolveCustomerStorefrontUrl(async () => null, channelId, { STOREFRONT_BASE_URL: ' https://env.example.com ' }),
    ).resolves.toBe('https://env.example.com');
  });

  it('falls back to STOREFRONT_BASE_URL when the setting is blank after trim', async () => {
    await expect(
      resolveCustomerStorefrontUrl(async () => '   ', channelId, { STOREFRONT_BASE_URL: 'https://env.example.com' }),
    ).resolves.toBe('https://env.example.com');
  });

  it.each([
    ['SettingNotRegistered', () => new SettingNotRegistered('sales_channels.storefront_url')],
    ['SettingOutOfScopeForChannel', () => new SettingOutOfScopeForChannel('sales_channels.storefront_url', channelId)],
  ])('falls back to STOREFRONT_BASE_URL on %s', async (_name, make) => {
    const read = async (): Promise<string | null> => {
      throw make();
    };
    await expect(
      resolveCustomerStorefrontUrl(read, channelId, { STOREFRONT_BASE_URL: 'https://env.example.com' }),
    ).resolves.toBe('https://env.example.com');
  });

  it('answers null when both the setting and the env are empty — no localhost rung', async () => {
    await expect(resolveCustomerStorefrontUrl(async () => '', channelId, { STOREFRONT_BASE_URL: '  ' })).resolves.toBeNull();
    await expect(resolveCustomerStorefrontUrl(async () => null, channelId, {})).resolves.toBeNull();
  });

  it('rethrows any other failure of the settings read', async () => {
    const read = async (): Promise<string | null> => {
      throw new Error('database down');
    };
    await expect(
      resolveCustomerStorefrontUrl(read, channelId, { STOREFRONT_BASE_URL: 'https://env.example.com' }),
    ).rejects.toThrow('database down');
  });
});
