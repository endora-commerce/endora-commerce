import { describe, expect, it, vi } from 'vitest';
import { StorefrontRevalidator } from '../../../src/http/storefront-revalidator.js';

describe('StorefrontRevalidator', () => {
  it('is disabled (no-op) without a base URL or secret', async () => {
    const fetchFn = vi.fn();
    await new StorefrontRevalidator({ baseUrl: undefined, secret: 's', fetchFn }).revalidate(['ga:config']);
    await new StorefrontRevalidator({ baseUrl: 'http://x', secret: undefined, fetchFn }).revalidate(['ga:config']);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('POSTs the tags with the shared secret header when configured', async () => {
    const fetchFn = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => new Response(null, { status: 200 }));
    await new StorefrontRevalidator({
      baseUrl: 'http://storefront:3010',
      secret: 'sekret',
      fetchFn: fetchFn as unknown as typeof fetch,
    }).revalidate(['ga:config']);
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe('http://storefront:3010/api/revalidate');
    expect((init as RequestInit).method).toBe('POST');
    expect((init!.headers as Record<string, string>)['x-revalidate-secret']).toBe('sekret');
    expect(JSON.parse((init!).body as string)).toEqual({ tags: ['ga:config'] });
  });

  it('swallows transport errors (best-effort)', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('unreachable');
    });
    await expect(
      new StorefrontRevalidator({
        baseUrl: 'http://x',
        secret: 's',
        fetchFn: fetchFn as unknown as typeof fetch,
      }).revalidate(['ga:config']),
    ).resolves.toBeUndefined();
  });

  it('does nothing for an empty tag list', async () => {
    const fetchFn = vi.fn();
    await new StorefrontRevalidator({ baseUrl: 'http://x', secret: 's', fetchFn }).revalidate([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
