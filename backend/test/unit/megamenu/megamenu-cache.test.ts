import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import {
  MegamenuCache,
  MEGAMENU_CACHE_KEY_PREFIX,
} from '../../../src/modules/megamenu/services/megamenu-cache.js';
import type { ResolvedMegamenu } from '@endora-commerce/contracts';

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

const samplePayload: ResolvedMegamenu = {
  megamenuId: '11111111-1111-1111-1111-111111111111',
  name: 'Test menu',
  language: 'en-US',
  items: [],
};

describe('MegamenuCache (T016)', () => {
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  });

  afterAll(async () => {
    redis.disconnect();
  });

  beforeEach(async () => {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${MEGAMENU_CACHE_KEY_PREFIX}*`, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  });

  it('returns null on a miss', async () => {
    const cache = new MegamenuCache(redis);
    expect(await cache.get('default', 'en-US')).toBeNull();
  });

  it('round-trips a payload through set + get', async () => {
    const cache = new MegamenuCache(redis);
    await cache.set('default', 'en-US', samplePayload);
    expect(await cache.get('default', 'en-US')).toEqual(samplePayload);
  });

  it('uses the documented key prefix scheme', async () => {
    const cache = new MegamenuCache(redis);
    await cache.set('default', 'en-US', samplePayload);
    const expectedKey = `${MEGAMENU_CACHE_KEY_PREFIX}default:en-US`;
    expect(await redis.exists(expectedKey)).toBe(1);
  });

  it('invalidateScope drops a single key', async () => {
    const cache = new MegamenuCache(redis);
    await cache.set('default', 'en-US', samplePayload);
    await cache.set('default', 'pl-PL', { ...samplePayload, language: 'pl-PL' });
    await cache.invalidateScope('default', 'en-US');
    expect(await cache.get('default', 'en-US')).toBeNull();
    expect(await cache.get('default', 'pl-PL')).not.toBeNull();
  });

  it('invalidateAll SCAN-deletes the whole namespace', async () => {
    const cache = new MegamenuCache(redis);
    await cache.set('default', 'en-US', samplePayload);
    await cache.set('vip', 'pl-PL', { ...samplePayload, language: 'pl-PL' });
    await cache.invalidateAll();
    expect(await cache.get('default', 'en-US')).toBeNull();
    expect(await cache.get('vip', 'pl-PL')).toBeNull();
  });

  it('disabled cache makes get/set no-ops', async () => {
    const cache = new MegamenuCache(redis, { enabled: false });
    await cache.set('default', 'en-US', samplePayload);
    expect(await cache.get('default', 'en-US')).toBeNull();
  });
});
