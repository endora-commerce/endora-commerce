import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { symbols as pinoSymbols } from 'pino';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';

/**
 * D-70 — the login hook's comparison adoption is **decided**, not caught.
 *
 * `POST /api/v1/auth/customer/login` invokes `organizationsLoginHook` inside a
 * bare `catch` (`organizations/routes.public.ts:177`) which feature 037
 * FR-007/FR-008 and SC-004 require: a merge failure must not break a login that
 * has already written its session cookie. That `catch` stays, and stays bare.
 *
 * What this file pins is the other half. The root contribution asks
 * `effectiveState.isPresent('comparisons')` **before** resolving the gated
 * `comparisonService`, so an operator who switched the module off produces a
 * skipped adoption rather than a swallowed `ModuleDisabledError`.
 *
 * Three assertions, and only the third can tell those two apart:
 *
 *   1. the login still answers 200 — true with or without the probe, because
 *      the `catch` would absorb the gate's throw either way;
 *   2. `adoptAnonymousComparison` is never called — also true either way, since
 *      a closed gate throws before the method is reached;
 *   3. **no `cart_merge_on_login_failed` line is logged** — true only with the
 *      probe. Delete it and this is the assertion that goes red.
 *
 * The companion pin lives in
 * `test/contract/auth/customer-login-cart-merge.contract.test.ts:203`, which
 * goes red if the route's `catch` is deleted. Both are named in this site's
 * `PORT_CATCHES_TO_DRAIN` reason, so a sweep meets them before editing anything.
 */

/**
 * Capture what the request logger writes, for the length of `body`.
 *
 * Fastify builds `request.log` as a child of `app.log` per request, and pino's
 * `child()` copies the parent's destination at creation time — so swapping the
 * destination on `app.log` here is seen by every child created afterwards,
 * which is every request this helper wraps. Nothing about the logger's level or
 * serializers changes, so an `error` line still reaches it.
 */
async function captureLogLines<T>(
  app: BackendServerHandle['app'],
  body: () => Promise<T>,
): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const logger = app.log as unknown as Record<symbol, { write(chunk: string): void }>;
  const original = logger[pinoSymbols.streamSym];
  logger[pinoSymbols.streamSym] = {
    write: (chunk: string) => {
      lines.push(chunk);
    },
  };
  try {
    const result = await body();
    return { result, lines };
  } finally {
    if (original === undefined) delete logger[pinoSymbols.streamSym];
    else logger[pinoSymbols.streamSym] = original;
  }
}

describe('POST /api/v1/auth/customer/login — comparisons switched off (D-70)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('logs in, adopts nothing, and records no hook failure', async () => {
    const service = h.comparisons.comparisonService;
    const adopt = vi.spyOn(service, 'adoptAnonymousComparison');

    try {
      const { result: res, lines } = await withModuleOff('comparisons', 'deactivated', () =>
        captureLogLines(h.app, () =>
          h.app.inject({
            method: 'POST',
            url: '/api/v1/auth/customer/login',
            payload: {
              email: 'stub-customer-empty@example.com',
              password: STUB_CUSTOMER_PASSWORD,
            },
            cookies: { compare_token: `compare-anon-${Date.now()}` },
          }),
        ),
      );

      // 1 — the login is unaffected. A switched-off comparison list is not a
      // reason to refuse an authentication.
      expect(res.statusCode).toBe(200);

      // 2 — nothing was adopted. A closed gate throws before the method is
      // reached, so this holds with or without the probe; it is here to prove
      // the anonymous list really is left alone, not to prove the probe.
      expect(adopt).not.toHaveBeenCalled();

      // 3 — the probe itself. With the adoption attempted instead of decided,
      // the gate's `ModuleDisabledError` lands in the route's `catch` and this
      // line appears. It is the only one of the three that can tell a decided
      // adoption from a caught one.
      const failures = lines.filter((line) => line.includes('cart_merge_on_login_failed'));
      expect(
        failures,
        'the login hook reported a failure for a module the operator switched off — ' +
          'the presence probe in the root contribution is missing or ineffective',
      ).toEqual([]);
    } finally {
      adopt.mockRestore();
    }
  });

  it('adopts again once the module is switched back on', async () => {
    const service = h.comparisons.comparisonService;
    const adopt = vi
      .spyOn(service, 'adoptAnonymousComparison')
      .mockResolvedValue(undefined as unknown as Awaited<
        ReturnType<typeof service.adoptAnonymousComparison>
      >);

    try {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/customer/login',
        payload: {
          email: 'stub-customer-empty@example.com',
          password: STUB_CUSTOMER_PASSWORD,
        },
        cookies: { compare_token: `compare-anon-on-${Date.now()}` },
      });

      // Constitution XVII item 6 — restoration. Without this the first test
      // would pass over a seam that never adopts at all.
      expect(res.statusCode).toBe(200);
      expect(adopt).toHaveBeenCalledOnce();
    } finally {
      adopt.mockRestore();
    }
  });
});
