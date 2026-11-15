import { describe, expect, it, vi } from 'vitest';
import { SettingNotRegistered, SettingOutOfScopeForChannel } from '@endora-commerce/platform/kernel';
import { createStorefrontOriginResolver } from './storefront-origin.js';

/**
 * Issue #1279 — where a customer's federated sign-in returns to: the started-on
 * channel's `sales_channels.storefront_url`, else `STOREFRONT_BASE_URL`.
 */
const FALLBACK = 'https://shop.example.com';

describe('createStorefrontOriginResolver', () => {
  it('answers the channel’s storefront URL, without a trailing slash', async () => {
    const resolve = createStorefrontOriginResolver(async () => ' https://trade.example.com/ ', FALLBACK);
    expect(await resolve('channel-1')).toBe('https://trade.example.com');
  });

  it('asks the setting for the channel it was given', async () => {
    const read = vi.fn(async () => 'https://trade.example.com');
    await createStorefrontOriginResolver(read, FALLBACK)('channel-1');
    expect(read).toHaveBeenCalledWith('channel-1');
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['not a URL', 'trade.example.com'],
    ['not http', 'javascript:alert(1)'],
  ])('falls back when the setting is %s', async (_label, value) => {
    expect(await createStorefrontOriginResolver(async () => value, FALLBACK)('channel-1')).toBe(FALLBACK);
  });

  it('falls back without a channel, and does not ask', async () => {
    const read = vi.fn(async () => 'https://trade.example.com');
    expect(await createStorefrontOriginResolver(read, `${FALLBACK}/`)(null)).toBe(FALLBACK);
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    new SettingNotRegistered('sales_channels.storefront_url'),
    new SettingOutOfScopeForChannel('sales_channels.storefront_url', 'channel-1'),
  ])('falls back when the setting is not configured here (%s)', async (error) => {
    const resolve = createStorefrontOriginResolver(async () => {
      throw error;
    }, FALLBACK);
    expect(await resolve('channel-1')).toBe(FALLBACK);
  });

  it('does not swallow any other failure', async () => {
    const resolve = createStorefrontOriginResolver(async () => {
      throw new Error('database down');
    }, FALLBACK);
    await expect(resolve('channel-1')).rejects.toThrow('database down');
  });
});
