import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleManifest } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';

/**
 * D-179.1 — a re-classified edge gives the owner's activation control back.
 *
 * `credit_limits.enabled` was a dead switch: an operator flipped it and got a
 * 409 naming `orders` and `organizations`, both of which declare themselves
 * non-deactivatable, so the refusal named modules that will never go away.
 * Both edges are `refuses-without` now, which withdraws the bind and keeps the
 * fail-closed behaviour that was always there.
 *
 * The point of the change is operator-visible, so it is asserted rather than
 * inferred, at the door an operator actually reaches: the real endpoint, the
 * real presence projection, and the real container seam `lazyPort` resolves
 * through on every cross-module call. Nothing here stubs the gating graph.
 *
 * The second half is Constitution XVII's: off is non-destructive and
 * reversible. The choice persists as the Setting's global value, and switching
 * back on returns the capability.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const MANIFESTS: readonly ModuleManifest[] = REGISTERED_MANIFESTS.map((entry) => entry.manifest);
const ALL_IDS = MANIFESTS.map((manifest) => manifest.id);

/** The two names `orders` and `organizations` reach `credit_limits` through. */
const CREDIT_LIMIT_PORTS = ['creditLimitService', 'creditLimitReadPort'] as const;

const ACTIVATION_CODES = ['credit_limits.enabled'];

/**
 * Every module the flip-time refusal would name, derived from the manifests the
 * endpoint itself reads rather than copied (D-100).
 */
function bindersOf(owner: string): string[] {
  return MANIFESTS.filter(
    (manifest) =>
      (manifest.dependencies ?? []).includes(owner) ||
      (manifest.acknowledgedDependencies ?? []).some((edge) => edge.moduleId === owner),
  )
    .map((manifest) => manifest.id)
    .sort();
}

/**
 * The container read `lazyPort` performs on every method call — `ctx.cradle()`
 * indexed by the port name. Written out rather than helper-wrapped because it
 * *is* the seam under test: a gated registration is a transient whose factory
 * asks the owner's effective state, so the throw lands here, before any
 * implementation runs.
 */
function resolvePort(h: BackendServerHandle, name: string): unknown {
  return (h.container.cradle as unknown as Record<string, unknown>)[name];
}

describe('a re-classified edge makes the owner\'s activation control work [contract]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCartForStubCustomer(h.em());
  }, 60_000);

  afterAll(async () => {
    registryCache.__setEnabledForTesting(ALL_IDS);
    await teardownBackendServer(h);
  });

  afterEach(async () => {
    await h.em().nativeUpdate(Setting, { code: { $in: ACTIVATION_CODES } }, { globalValue: null });
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  async function flip(moduleId: string, active: boolean) {
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/modules/${moduleId}/activation`,
      cookies: ADMIN,
      payload: { active },
    });
  }

  async function presenceOf(moduleId: string) {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/module-presence',
      cookies: ADMIN,
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { modules: Array<{ id: string }> }).modules.find(
      (module) => module.id === moduleId,
    );
  }

  it('resolves both credit-limit ports while the module is on (the positive control)', () => {
    // Without this, every assertion below would pass against a name nothing
    // registers — the throw would be the wrong one and read the same.
    for (const name of CREDIT_LIMIT_PORTS) expect(resolvePort(h, name)).toBeDefined();
  });

  it('switches credit_limits off where it used to answer 409', async () => {
    const res = await flip('credit_limits', false);
    expect(res.statusCode).toBe(200);
    expect(res.json().module).toMatchObject({
      id: 'credit_limits',
      activated: false,
      present: false,
      deactivatable: true,
    });
  });

  it('takes the module out of the presence projection', async () => {
    expect((await flip('credit_limits', false)).statusCode).toBe(200);
    expect(await presenceOf('credit_limits')).toMatchObject({
      present: false,
      activated: false,
    });
  });

  it('refuses at the port seam instead of half-executing', async () => {
    expect((await flip('credit_limits', false)).statusCode).toBe(200);
    for (const name of CREDIT_LIMIT_PORTS) {
      expect(() => resolvePort(h, name)).toThrow(ModuleDisabledError);
    }
  });

  it('leaves the rest of both dependents serving', async () => {
    // What `refuses-without` claims, and the reason it is not `dependencies`:
    // the operation that touches the owner refuses, the declaring module keeps
    // working. `orders` and `organizations` are non-deactivatable, so a bind
    // here would have been the platform refusing the flip on their behalf.
    expect((await flip('credit_limits', false)).statusCode).toBe(200);
    for (const url of ['/api/v1/admin/orders?limit=1', '/api/v1/admin/organizations?limit=1']) {
      const res = await h.app.inject({ method: 'GET', url, cookies: ADMIN });
      expect(res.statusCode, url).toBe(200);
    }
  });

  it('persists the operator choice and gives the capability back', async () => {
    expect((await flip('credit_limits', false)).statusCode).toBe(200);

    const em = h.em();
    em.clear();
    expect(
      (await em.findOne(Setting, { code: 'credit_limits.enabled' }))?.globalValue,
      'the choice lives in the settings store, not in module_registrations',
    ).toBe(false);
    // The platform axis is untouched: switching off is not uninstalling.
    expect(registryCache.isEnabled('credit_limits')).toBe(true);
    expect(registryCache.platformStateOf('credit_limits')).toBe('installed');

    const on = await flip('credit_limits', true);
    expect(on.statusCode).toBe(200);
    expect(on.json().module).toMatchObject({ activated: true, present: true });
    for (const name of CREDIT_LIMIT_PORTS) expect(resolvePort(h, name)).toBeDefined();
  });

  it('refuses the placement preview with promotions off, rather than pricing without it', async () => {
    // The same conversion, over HTTP and on a path an operator can see. The
    // discount total is recomputed through `promotionService` on **every**
    // checkout, not only a discounted one, so the whole preview refuses.
    //
    // Driven on the operator axis with the harness rather than through the
    // endpoint, because `promotions.enabled` is still a dead switch: `carts`
    // acknowledges the same port and `carts` is non-deactivatable. That is the
    // remaining half of D-179.1 and the case below says so at the door.
    await withModuleOff('promotions', 'deactivated', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orders/preview-total',
        cookies: { b2b_session: 'stub-customer-session' },
        payload: {
          deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
          billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        },
      });
      expect(res.statusCode).toBe(503);
      expect((res.json() as { error: { code: string } }).error.code).toBe('MODULE_DISABLED');
    });

    const restored = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders/preview-total',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
      },
    });
    expect(restored.statusCode).toBe(200);
  });

  it.each(['promotions', 'quote_requests'])(
    '%s is still refused, and the refusal names only the binds this MR left standing',
    async (owner) => {
      // The honest other half. `orders` gave up its bind over both, so a green
      // here that named `orders` would mean the conversion had not taken; a
      // green with an *empty* `blockedBy` would mean the switch had come alive
      // and this case is the one that says so.
      const res = await flip(owner, false);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('MODULE_DEPENDENTS_PRESENT');
      const blockedBy = res.json().error.details.blockedBy as string[];
      expect(blockedBy).not.toContain('orders');
      expect([...blockedBy].sort()).toEqual(bindersOf(owner));
    },
  );
});
