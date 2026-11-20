import { describe, expect, it, vi } from 'vitest';
import { RELATED_PAYERS_DEFAULT_TIME_ZONE, RELATED_PAYERS_SETTING_CODES } from '@endora-commerce/contracts';
import { storeTimeZoneOf } from './store-time-zone.js';

/**
 * `specs/182-related-payers/` RP-20 (a) — the day of the daily limit starts at midnight in the
 * **default store's** time zone: `related_payers.time_zone` read for the system-default channel,
 * whatever channel the request came from; a zone the runtime does not know falls back to the default.
 */
describe('storeTimeZoneOf', () => {
  it('reads the time zone for the system-default channel', async () => {
    const read = vi.fn(async () => 'America/New_York');
    const zone = storeTimeZoneOf({ defaultChannelId: async () => 'default-channel', read });
    expect(await zone()).toBe('America/New_York');
    expect(read).toHaveBeenCalledWith(RELATED_PAYERS_SETTING_CODES.TIME_ZONE, 'default-channel');
  });

  it('falls back to Europe/Warsaw for a zone the runtime does not know', async () => {
    const zone = storeTimeZoneOf({ defaultChannelId: async () => 'c', read: async () => 'Mars/Olympus_Mons' });
    expect(await zone()).toBe(RELATED_PAYERS_DEFAULT_TIME_ZONE);
  });
});
