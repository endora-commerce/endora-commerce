import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import { EventBus } from '../../../src/events/bus.js';
import { HttpError } from '../../../src/http/error-envelope.js';
import { composeModules } from '../../../src/kernel/compose.js';
import { createRootContainer } from '../../../src/kernel/container.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import type { RequireCustomerGuard } from '../../../src/kernel/ports/require-customer.js';
import { registerModule as registerAuth } from '../../../src/modules/auth/backend.js';
import { createRequireCustomer } from '../../../src/modules/auth/require-customer.js';

/**
 * The customer guard — **one implementation**, shared by production and the
 * test harness (issue #43).
 *
 * There were two, and they disagreed on all three request shapes that exist:
 *
 * | request carries | `composition.ts`'s inline copy | the harness's `requireTestCustomer()` |
 * | --- | --- | --- |
 * | `actor` only | allowed | refused 401 |
 * | `testActor` only | crashed (`TypeError` → 500) | allowed |
 * | neither | crashed (`TypeError` → 500) | refused 401 |
 *
 * Two decisions are pinned below, and they are the ones that closed the gap:
 *
 *  1. **The guard reads `request.actor`.** That is the decoration `auth`'s
 *     plugin sets and the only one a deployment has; `testActor` is a harness
 *     decoration, and the harness mirrors every resolved actor onto both, so
 *     production's read is the one that works in either root.
 *  2. **A request with no resolved actor is refused, not crashed.** The
 *     harness's answer wins here, and it is the same call `createRequireAdmin`
 *     already made for the admin guard: a composition that mounts a route
 *     without an actor resolver should get a 401, not a 500 out of a
 *     `TypeError` on `undefined.kind`.
 *
 * This is the divergence T011/T012 fixed for `requireAdmin` and left open for
 * its customer-side twin.
 */

const requireCustomer: RequireCustomerGuard = createRequireCustomer();

/** What the guard did, flattened so a refusal and a crash cannot read alike. */
async function outcome(request: unknown): Promise<string> {
  try {
    await requireCustomer(request as FastifyRequest);
    return 'allowed';
  } catch (error) {
    if (error instanceof HttpError) return `refused ${error.statusCode} ${error.code}`;
    return `crashed ${(error as Error).constructor.name}`;
  }
}

describe('the customer guard reads the production actor', () => {
  it('admits a customer session', async () => {
    expect(
      await outcome({ actor: { kind: 'customer', customerAccountId: 'c1', organizationId: null } }),
    ).toBe('allowed');
  });

  it('refuses every other actor kind with 401', async () => {
    for (const actor of [
      { kind: 'anonymous' },
      { kind: 'admin', adminUserId: 'a1' },
      // An API key bound to a customer account is still not a customer session:
      // the binding scopes what the key may read, it does not sign anyone in.
      { kind: 'api_key', apiKeyId: 'k1', scopes: [], customerAccountId: 'c1' },
    ]) {
      expect(await outcome({ actor })).toBe(`refused 401 ${ERROR_CODES.UNAUTHORIZED}`);
    }
  });

  it('refuses rather than crashing when no actor was resolved at all', async () => {
    // The inline copy in `composition.ts` read `request.actor.kind` unguarded
    // and turned this into a 500. Same reasoning as `createRequireAdmin`.
    expect(await outcome({})).toBe(`refused 401 ${ERROR_CODES.UNAUTHORIZED}`);
  });

  it('does not read the harness-only `testActor` decoration', async () => {
    // The other half of decision 1: were the guard still reading `testActor`,
    // this request would be admitted and every production request refused.
    expect(await outcome({ testActor: { kind: 'customer', customerAccountId: 'c1' } })).toBe(
      `refused 401 ${ERROR_CODES.UNAUTHORIZED}`,
    );
  });
});

describe('`auth` publishes the guard as a port', () => {
  // D-38 — presence is loaded by a composition, and this file composes a bare
  // container, so run alone nothing has loaded it.
  const seeded = registryCache.isLoaded() ? registryCache.enabledIds() : [];

  afterEach(() => {
    registryCache.__setEnabledForTesting(seeded);
  });

  it('registers `requireCustomer`, so neither composition root declares one', () => {
    registryCache.__setEnabledForTesting([...seeded, 'auth']);
    const container = createRootContainer();
    composeModules([{ id: 'auth', version: '1.0.0', registerModule: registerAuth }], {
      container,
      eventBus: new EventBus(),
      log: { info: (): void => {}, warn: (): void => {}, error: (): void => {} },
    });

    const resolved = container.cradle['requireCustomer'] as RequireCustomerGuard;
    expect(typeof resolved).toBe('function');
  });
});
