import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachPlatformLogger } from '../kernel/logging.js';
import { StorefrontRevalidator, resetRevalidationWarnings } from './storefront-revalidator.js';

describe('StorefrontRevalidator', () => {
  beforeEach(() => resetRevalidationWarnings());
  it('is disabled (no-op) without a base URL or secret', async () => {
    const fetchFn = vi.fn();
    await new StorefrontRevalidator({ baseUrl: undefined, secret: 's', fetchFn }).revalidate(['ga:config']);
    await new StorefrontRevalidator({ baseUrl: 'http://x', secret: undefined, fetchFn }).revalidate(['ga:config']);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('POSTs the tags with the shared secret header when configured', async () => {
    // `Parameters<typeof fetch>` rather than `RequestInfo`/`RequestInit` by name: the
    // option this stands in for is declared `typeof fetch`, and the two DOM aliases were
    // ambient in `backend`'s program by accident rather than by a `lib` this package sets.
    type FetchArgs = Parameters<typeof fetch>;
    const fetchFn = vi.fn(async (_u: FetchArgs[0], _i?: FetchArgs[1]) => new Response(null, { status: 200 }));
    await new StorefrontRevalidator({
      baseUrl: 'http://storefront:3010',
      secret: 'sekret',
      fetchFn: fetchFn as unknown as typeof fetch,
    }).revalidate(['ga:config']);
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe('http://storefront:3010/api/revalidate');
    expect(init?.method).toBe('POST');
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

  // R19C (T271): a refused call (a secret the storefront does not share answers 401) was silent,
  // and every publish then waited out the storefront's time window. It is logged now.
  it('logs a refused call with its status', async () => {
    const warn = vi.fn();
    const fetchFn = vi.fn(async () => new Response('{"error":"unauthorized"}', { status: 401 }));
    await new StorefrontRevalidator({
      baseUrl: 'http://x',
      secret: 's',
      fetchFn: fetchFn as unknown as typeof fetch,
      logger: { warn },
    }).revalidate(['cms:page:about']);
    expect(warn).toHaveBeenCalledOnce();
    const [obj, msg] = warn.mock.calls[0]!;
    expect(obj).toMatchObject({ status: 401, tags: ['cms:page:about'] });
    expect(String(msg)).toContain('[storefront-revalidate]');
  });

  it('gives up on a storefront that does not answer within the timeout, and logs it', async () => {
    const warn = vi.fn();
    const fetchFn = vi.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );
    const started = Date.now();
    await new StorefrontRevalidator({
      baseUrl: 'http://x',
      secret: 's',
      fetchFn: fetchFn as unknown as typeof fetch,
      logger: { warn },
      timeoutMs: 30,
    }).revalidate(['cms:page:about']);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('does nothing for an empty tag list', async () => {
    const fetchFn = vi.fn();
    await new StorefrontRevalidator({ baseUrl: 'http://x', secret: 's', fetchFn }).revalidate([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('logs a non-2xx answer as a failure, naming the status and never the secret (security M2)', async () => {
    const warn = vi.fn();
    const fetchFn = vi.fn(async () => new Response('{"error":"unauthorized"}', { status: 401 }));
    await expect(
      new StorefrontRevalidator({
        baseUrl: 'http://x',
        secret: 'sekret',
        fetchFn: fetchFn as unknown as typeof fetch,
        logger: { warn },
      }).revalidate(['ga:config']),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    const [obj, msg] = warn.mock.calls[0]!;
    expect(obj).toMatchObject({ status: 401 });
    expect(JSON.stringify([obj, msg])).not.toContain('sekret');
  });

  it('bounds the call with a timeout signal, and logs a transport failure', async () => {
    const warn = vi.fn();
    type FetchArgs = Parameters<typeof fetch>;
    const fetchFn = vi.fn(async (_u: FetchArgs[0], _i?: FetchArgs[1]) => {
      throw new Error('aborted');
    });
    await new StorefrontRevalidator({
      baseUrl: 'http://x',
      secret: 's',
      fetchFn: fetchFn as unknown as typeof fetch,
      logger: { warn },
    }).revalidate(['ga:config']);
    expect(fetchFn.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  // Issue #112 — every write revalidates, so a storefront that refuses them all
  // would otherwise put one warning per write into the log.
  describe('identical warnings are rate-limited', () => {
    type Clock = { now: number };
    const refusing = (status: number) =>
      vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch;
    const revalidator = (
      clock: Clock,
      warn: (obj: unknown, msg: string) => void,
      fetchFn: typeof fetch,
      baseUrl = 'http://shop',
    ) =>
      new StorefrontRevalidator({
        baseUrl,
        secret: 'sekret',
        fetchFn,
        logger: { warn },
        now: () => clock.now,
      });

    it('logs the first refusal, holds the repeats for a minute, then reports how many it held', async () => {
      const clock = { now: 0 };
      const warn = vi.fn();
      const subject = revalidator(clock, warn, refusing(401));
      await subject.revalidate(['a']);
      clock.now = 1_000;
      await subject.revalidate(['b']);
      clock.now = 59_999;
      await subject.revalidate(['c']);
      expect(warn).toHaveBeenCalledOnce();
      clock.now = 60_000;
      await subject.revalidate(['d']);
      expect(warn).toHaveBeenCalledTimes(2);
      const [obj] = warn.mock.calls[1]!;
      expect(obj).toMatchObject({ status: 401, tags: ['d'], suppressed: 2 });
      expect(JSON.stringify(warn.mock.calls)).not.toContain('sekret');
    });

    it('holds repeats across instances: a composition that builds one per call is still bounded', async () => {
      const clock = { now: 0 };
      const warn = vi.fn();
      await revalidator(clock, warn, refusing(401)).revalidate(['a']);
      await revalidator(clock, warn, refusing(401)).revalidate(['b']);
      expect(warn).toHaveBeenCalledOnce();
    });

    it('a different status, a transport failure or another storefront is not a repeat', async () => {
      const clock = { now: 0 };
      const warn = vi.fn();
      await revalidator(clock, warn, refusing(401)).revalidate(['a']);
      await revalidator(clock, warn, refusing(500)).revalidate(['a']);
      await revalidator(clock, warn, refusing(401), 'http://other-shop').revalidate(['a']);
      const unreachable = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch;
      await revalidator(clock, warn, unreachable).revalidate(['a']);
      await revalidator(clock, warn, unreachable).revalidate(['a']);
      expect(warn).toHaveBeenCalledTimes(4);
    });

    it('a success ends the run of failures, so the next refusal is logged at once', async () => {
      const clock = { now: 0 };
      const warn = vi.fn();
      await revalidator(clock, warn, refusing(401)).revalidate(['a']);
      await revalidator(clock, warn, refusing(200)).revalidate(['a']);
      clock.now = 1_000;
      await revalidator(clock, warn, refusing(401)).revalidate(['a']);
      expect(warn).toHaveBeenCalledTimes(2);
    });
  });

  // Issue #112 — two compositions build a revalidator per call with no logger, and a
  // refusal through them was silent. Without one it reports to the platform logger.
  describe('without a logger of its own', () => {
    let detach: (() => void) | undefined;
    afterEach(() => detach?.());

    it('warns through the platform logger', async () => {
      const warn = vi.fn();
      detach = attachPlatformLogger({ info: vi.fn(), warn, error: vi.fn() });
      await new StorefrontRevalidator({
        baseUrl: 'http://x',
        secret: 'sekret',
        fetchFn: vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof fetch,
      }).revalidate(['catalog:categories']);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]![0]).toMatchObject({ status: 401 });
    });
  });
});
