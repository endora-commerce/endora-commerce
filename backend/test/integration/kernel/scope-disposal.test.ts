import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { openPlatformScopeCount } from '../../../src/kernel/scope.js';

/**
 * Feature 072 (T032) — no scope survives its request.
 *
 * FR-015 requires disposal on success, on **error** and on **client abort**.
 * The request-scope hook gets all three from one mechanism: the scope's work is
 * a promise that settles when `reply.raw` emits `close`, and that event fires
 * for a completed response, a failed one and a socket the client hung up on.
 *
 * Two things this test deliberately does NOT assert:
 *
 *  - that an aborted handler stops running. Node has no cancellation; the
 *    handler's continuation carries on against a dead socket. That is precisely
 *    why the scope's lifetime is tied to the response rather than to the
 *    handler — otherwise an abandoned request would hold its scope open for as
 *    long as the handler happened to take.
 *  - anything about the tenant store, which is covered by the tenancy suite.
 *    Here the subject is the awilix scope's lifetime.
 *
 * The counter is read rather than a disposer spy because the leak being guarded
 * against is a scope that is never disposed at all — an unresolved registration
 * has no disposer to fire, so counting entries against exits is the only
 * measurement that fails when nothing happens.
 */

/** Poll until `openPlatformScopeCount()` drops back to `expected`, or give up. */
async function waitForScopeCount(expected: number, timeoutMs = 5_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let seen = openPlatformScopeCount();
  while (seen !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    seen = openPlatformScopeCount();
  }
  return seen;
}

describe('Request scope disposal (feature 072, FR-015)', () => {
  let h: BackendServerHandle;
  let slowRequestStarted: Promise<void>;
  let releaseSlowRequest: () => void = () => {};

  beforeAll(async () => {
    let signalStarted: () => void = () => {};
    slowRequestStarted = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });

    h = await setupBackendServer({
      seed: 'none',
      extraModules: [
        async (app) => {
          app.get('/api/v1/_test/scope/ok', async () => ({ data: { ok: true } }));
          app.get('/api/v1/_test/scope/boom', async () => {
            throw new Error('handler exploded');
          });
          app.get('/api/v1/_test/scope/slow', async () => {
            signalStarted();
            await new Promise<void>((resolve) => {
              releaseSlowRequest = resolve;
            });
            return { data: { ok: true } };
          });
        },
      ],
    });
  });

  afterAll(async () => {
    releaseSlowRequest();
    await teardownBackendServer(h);
  });

  it('disposes the scope when the response completes', async () => {
    const baseline = openPlatformScopeCount();

    const res = await h.app.inject({ method: 'GET', url: '/api/v1/_test/scope/ok' });
    expect(res.statusCode).toBe(200);

    expect(await waitForScopeCount(baseline)).toBe(baseline);
  });

  it('disposes the scope when the handler throws', async () => {
    const baseline = openPlatformScopeCount();

    const res = await h.app.inject({ method: 'GET', url: '/api/v1/_test/scope/boom' });
    expect(res.statusCode).toBe(500);

    expect(await waitForScopeCount(baseline)).toBe(baseline);
  });

  it('disposes the scope when the client aborts mid-request', async () => {
    // A real socket, because an abort is a transport event: `inject` never opens
    // one, so the case it has to cover cannot be simulated through it.
    await h.app.listen({ port: 0, host: '127.0.0.1' });
    const address = h.app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected a TCP address from the test listener');
    }

    const baseline = openPlatformScopeCount();
    const abort = new AbortController();
    const inFlight = fetch(`http://127.0.0.1:${address.port}/api/v1/_test/scope/slow`, {
      signal: abort.signal,
    });

    await slowRequestStarted;
    expect(openPlatformScopeCount()).toBe(baseline + 1);

    abort.abort();
    await expect(inFlight).rejects.toThrow();

    expect(await waitForScopeCount(baseline)).toBe(baseline);

    // The handler is still parked; releasing it must not dispose a second time.
    releaseSlowRequest();
    expect(await waitForScopeCount(baseline)).toBe(baseline);
  });

  it('gives concurrent requests one scope each', async () => {
    const baseline = openPlatformScopeCount();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        h.app.inject({ method: 'GET', url: '/api/v1/_test/scope/ok' }),
      ),
    );
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);

    expect(await waitForScopeCount(baseline)).toBe(baseline);
  });
});
