import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ADMIN, scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 022 (T021), on feature 170's three levels (FR-010, FR-013, FR-014) — the `resolved` block of
 * `GET /api/v1/admin/catalog/products/:id?channelId=…&languageCode=…`.
 *
 * - the product's `name` / `description` are one Global string each;
 * - with a channel and a language the block resolves C×L → C → G and names the source;
 * - a language without a channel names no scope (there is no Language level): the Global value;
 * - without either parameter there is no `resolved` block.
 *
 * Replaces 163's per-language baseline cases (`global+language`, the primary-language fallback).
 */
describe('GET /api/v1/admin/catalog/products/:id?channelId&languageCode (resolver, feature 170)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let channel: string;
  let productId: string;

  type Resolved = {
    context: { channelId: string | null; languageCode: string | null };
    name: unknown;
    description: unknown;
    sources: Record<string, string>;
  };

  async function get(query: string): Promise<{ resolved?: Resolved } & Record<string, unknown>> {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/catalog/products/${productId}${query}`, ...ADMIN });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { resolved?: Resolved } & Record<string, unknown> }).data;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    channel = await fx.channel(['pl-PL', 'en-US']);
    productId = await fx.product({ channels: [channel], name: 'Resolved', description: 'Description' });
    await fx.save(productId, { channelId: channel, languageCode: 'pl-PL' }, { name: 'Rozwiązany', description: null });
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  it('resolves C×L → C → G with its source; an empty description override resolves to none', async () => {
    const pl = (await get(`?channelId=${channel}&languageCode=pl-PL`)).resolved!;
    expect(pl.context).toEqual({ channelId: channel, languageCode: 'pl-PL' });
    expect(pl.name).toBe('Rozwiązany');
    expect(pl.description).toBeNull();
    expect(pl.sources['name']).toBe('set');
    const en = (await get(`?channelId=${channel}&languageCode=en-US`)).resolved!;
    expect(en.name).toBe('Resolved');
    expect(en.sources['name']).toBe('inherited_global');
  });

  it('a language without a channel names no scope: the Global value', async () => {
    const resolved = (await get('?languageCode=pl-PL')).resolved!;
    expect(resolved.name).toBe('Resolved');
    expect(resolved.description).toBe('Description');
    expect(resolved.sources['name']).toBe('set');
  });

  it('without either parameter there is no resolved block, and name is the Global string', async () => {
    const data = await get('');
    expect(data['resolved']).toBeUndefined();
    expect(data['name']).toBe('Resolved');
  });
});
