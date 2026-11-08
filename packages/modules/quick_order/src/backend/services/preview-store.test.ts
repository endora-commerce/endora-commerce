import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { QUICK_ORDER_PREVIEW_TTL_SECONDS, type QuickOrderPreview } from '@endora-commerce/contracts';
import { QuickOrderPreviewStore, type QuickOrderPreviewOwner } from './preview-store.js';

/**
 * Issue #809 — the buyer's quick-order preview lives in Redis, one per buyer session, scoped to
 * the buyer's Organization. These cases hold the key and the TTL rules against a Redis double;
 * `backend/test/contract/quick_order/preview.test.ts` holds the routes against a real one.
 */

interface Entry {
  value: string;
  ttl: number | null;
}

/** The four commands the store uses, with the TTL each write set, so a test can read it back. */
function fakeRedis(): { redis: Redis; entries: Map<string, Entry>; commands: string[] } {
  const entries = new Map<string, Entry>();
  const commands: string[] = [];
  const redis = {
    async get(key: string) {
      commands.push(`get ${key}`);
      return entries.get(key)?.value ?? null;
    },
    async set(key: string, value: string, mode?: string, seconds?: number) {
      commands.push(`set ${key}`);
      entries.set(key, { value, ttl: mode === 'EX' && typeof seconds === 'number' ? seconds : null });
      return 'OK';
    },
    async del(key: string) {
      commands.push(`del ${key}`);
      return entries.delete(key) ? 1 : 0;
    },
  } as unknown as Redis;
  return { redis, entries, commands };
}

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000ab';
const BUYER = '00000000-0000-4000-8000-0000000000a1';

const owner = (overrides: Partial<QuickOrderPreviewOwner> = {}): QuickOrderPreviewOwner => ({
  organizationId: ORG_A,
  customerAccountId: BUYER,
  sessionToken: 'session-id.raw-secret-token',
  ...overrides,
});

const preview: QuickOrderPreview = {
  recognized: [{ line: 2, sku: 'BOLT-1', productId: '00000000-0000-4000-8000-00000000f001', variantId: null, quantity: 4 }],
  rejected: [{ line: 3, raw: 'NOPE,1', reason: 'product_not_found' }],
  summary: { recognizedCount: 1, rejectedCount: 1, mergedCount: 0, truncated: false },
};

describe('QuickOrderPreviewStore (issue #809)', () => {
  it('reads back what it wrote for the same buyer session', async () => {
    const { redis } = fakeRedis();
    const store = new QuickOrderPreviewStore(redis);
    await store.put(owner(), preview);
    expect(await store.get(owner())).toEqual(preview);
  });

  it('answers null when there is no preview', async () => {
    const { redis } = fakeRedis();
    expect(await new QuickOrderPreviewStore(redis).get(owner())).toBeNull();
  });

  it('keys by organization, buyer and a digest of the session — never the raw session token', async () => {
    const key = QuickOrderPreviewStore.keyFor(owner());
    expect(key.startsWith('b2b:quick_order:preview:')).toBe(true);
    expect(key).toContain(ORG_A);
    expect(key).toContain(BUYER);
    expect(key).not.toContain('raw-secret-token');
    expect(key).not.toContain('session-id');
  });

  it('keeps one preview per session: another session of the same buyer does not see it', async () => {
    const { redis } = fakeRedis();
    const store = new QuickOrderPreviewStore(redis);
    await store.put(owner(), preview);
    expect(await store.get(owner({ sessionToken: 'other-session.other-token' }))).toBeNull();
  });

  it('is tenant-scoped: the same session token under another organization reads nothing', async () => {
    const { redis } = fakeRedis();
    const store = new QuickOrderPreviewStore(redis);
    await store.put(owner(), preview);
    expect(await store.get(owner({ organizationId: ORG_B }))).toBeNull();
  });

  it('refuses a stored value whose recorded owner is not the reader (defence in depth)', async () => {
    const { redis, entries } = fakeRedis();
    const store = new QuickOrderPreviewStore(redis);
    await store.put(owner(), preview);
    // Simulate a value that reached this key without belonging to it.
    const key = QuickOrderPreviewStore.keyFor(owner());
    const stored = JSON.parse(entries.get(key)!.value) as Record<string, unknown>;
    entries.set(key, { value: JSON.stringify({ ...stored, organizationId: ORG_B }), ttl: null });
    expect(await store.get(owner())).toBeNull();
  });

  it('drops a value it cannot read instead of failing the page', async () => {
    const { redis, entries } = fakeRedis();
    const store = new QuickOrderPreviewStore(redis);
    entries.set(QuickOrderPreviewStore.keyFor(owner()), { value: '{not json', ttl: null });
    expect(await store.get(owner())).toBeNull();
    expect(entries.has(QuickOrderPreviewStore.keyFor(owner()))).toBe(false);
  });

  it('sets the TTL on every write, and a read does not touch it', async () => {
    const { redis, entries, commands } = fakeRedis();
    const store = new QuickOrderPreviewStore(redis);
    await store.put(owner(), preview);
    const key = QuickOrderPreviewStore.keyFor(owner());
    expect(entries.get(key)!.ttl).toBe(QUICK_ORDER_PREVIEW_TTL_SECONDS);
    commands.length = 0;
    await store.get(owner());
    expect(commands).toEqual([`get ${key}`]);
  });

  it('deletes the preview of this session only', async () => {
    const { redis } = fakeRedis();
    const store = new QuickOrderPreviewStore(redis);
    const other = owner({ sessionToken: 'other-session.other-token' });
    await store.put(owner(), preview);
    await store.put(other, preview);
    await store.delete(owner());
    expect(await store.get(owner())).toBeNull();
    expect(await store.get(other)).toEqual(preview);
  });
});
