import { describe, expect, it } from 'vitest';
import { MegamenuInvalidator, type MegamenuCacheInvalidation } from './megamenu-invalidator.js';

/**
 * A menu write drops the Redis entry and *then* tells the storefront — in that
 * order, because the notice provokes a refetch and a refetch that finds the old
 * entry still there caches it again.
 */
function recorder(): { log: string[]; cache: MegamenuCacheInvalidation; notify: () => void } {
  const log: string[] = [];
  return {
    log,
    cache: {
      invalidateAll: async () => {
        log.push('redis:all');
      },
      invalidateScope: async (channelCode, language) => {
        log.push(`redis:${channelCode}:${language}`);
      },
    },
    notify: () => {
      log.push('notify');
    },
  };
}

describe('MegamenuInvalidator', () => {
  it('drops every entry, then notifies', async () => {
    const r = recorder();
    await new MegamenuInvalidator(r.cache, r.notify).invalidateAll();
    expect(r.log).toEqual(['redis:all', 'notify']);
  });

  it('drops one scope, then notifies', async () => {
    const r = recorder();
    await new MegamenuInvalidator(r.cache, r.notify).invalidateScope('pl_retail', 'pl-PL');
    expect(r.log).toEqual(['redis:pl_retail:pl-PL', 'notify']);
  });

  it('still notifies in a composition with no Redis', async () => {
    const r = recorder();
    await new MegamenuInvalidator(undefined, r.notify).invalidateAll();
    expect(r.log).toEqual(['notify']);
  });
});
