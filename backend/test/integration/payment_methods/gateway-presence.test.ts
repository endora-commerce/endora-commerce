import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { PaymentMethod } from '../../../src/modules/payment_methods/entities/payment-method.entity.js';
import { PaymentMethodReconciler } from '../../../src/modules/payment_methods/services/payment-method-reconciler.js';
import { paymentAdapterRegistry } from '../../../src/modules/payment_methods/services/registry-singleton.js';

/**
 * Issue #96 — a payment method whose gateway module is absent must disappear
 * from every buyer-facing surface.
 *
 * The product ruling of 2026-08-15: when a gateway module is absent or switched
 * off, its payment method disappears entirely from cart and checkout. The buyer
 * never sees a method that cannot be used — both axes alike, no per-axis
 * distinction. The admin surface is deliberately excluded: an administrator
 * still sees the method, and sees why it is unavailable.
 *
 * The defect this file reproduces was measured on 2026-08-15 and recorded in
 * `off-state.test.ts`: `PaymentMethodEligibilityService` keeps a method while
 * its adapter sits in `paymentAdapterRegistry`, and nothing withdrew an adapter
 * when its owner was switched off — so with `payments` deactivated,
 * `GET /api/v1/payment-methods` answered 200 and still listed the
 * `bank_transfer`-backed methods.
 *
 * `payments` is the module under the microscope here rather than one of the
 * four vendor gateways, because it owns the four built-in adapters and their
 * validators answer `true` unconditionally — so an offered method that
 * disappears can only have disappeared for the reason under test. The vendor
 * gateways are covered by the ownership assertion below, which is the same fact
 * one seam earlier.
 */

const ALL_IDS = REGISTERED_MANIFESTS.map((e) => e.manifest.id);
const ADMIN = { b2b_session: 'stub-admin-session' };

interface PublicMethod {
  code: string;
}

interface AdminMethod {
  code: string;
  availability: {
    ownerModule: string | null;
    available: boolean;
    ownerPresence: { id: string; present: boolean; activated: boolean } | null;
  };
}

describe('payment methods of an absent gateway [integration]', () => {
  let h: BackendServerHandle;
  let code: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    code = `builtin_probe_${randomUUID().slice(0, 8)}`;
    const em = h.em();
    em.create(PaymentMethod, {
      code,
      name: { default: 'Bank transfer probe' },
      kind: 'bank_transfer',
      adapter: 'bank_transfer',
      status: 'active',
      statusOnPending: 'new',
      statusOnSuccess: 'paid',
      statusOnFailure: 'cancelled',
    });
    await em.flush();
  }, 60_000);

  afterAll(async () => {
    registryCache.__setEnabledForTesting(ALL_IDS);
    await teardownBackendServer(h);
  });

  async function listedCodes(): Promise<string[]> {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/payment-methods' });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: PublicMethod[] }).data.map((m) => m.code);
  }

  it('drops the method while the operator has the gateway switched off', async () => {
    expect(await listedCodes()).toContain(code);

    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['payments'] });
    try {
      expect(await listedCodes()).not.toContain(code);
    } finally {
      registryCache.__setEnabledForTesting(ALL_IDS);
    }

    // Off is reversible on this surface too.
    expect(await listedCodes()).toContain(code);
  });

  it('drops the method while the platform does not offer the gateway', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => id !== 'payments'));
    try {
      expect(await listedCodes()).not.toContain(code);
    } finally {
      registryCache.__setEnabledForTesting(ALL_IDS);
    }

    expect(await listedCodes()).toContain(code);
  });

  it('keeps the method on the admin list, with the reason it is unavailable', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['payments'] });
    try {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/payment-methods',
        cookies: ADMIN,
      });
      expect(res.statusCode).toBe(200);
      const row = (res.json() as { data: AdminMethod[] }).data.find((m) => m.code === code);
      expect(row, 'the admin must keep seeing a method whose gateway is off').toBeDefined();
      expect(row!.availability.ownerModule).toBe('payments');
      expect(row!.availability.available).toBe(false);
      // The reason is the presence projection's own vocabulary, not a second one.
      expect(row!.availability.ownerPresence).toMatchObject({
        id: 'payments',
        present: false,
        activated: false,
      });
    } finally {
      registryCache.__setEnabledForTesting(ALL_IDS);
    }

    const back = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/payment-methods',
      cookies: ADMIN,
    });
    const restored = (back.json() as { data: AdminMethod[] }).data.find((m) => m.code === code);
    expect(restored!.availability.available).toBe(true);
  });

  it('records the contributing module on every registered adapter', () => {
    // Every adapter in the process registry names its owner: without that the
    // enumeration has nothing to filter on (D-39).
    for (const key of paymentAdapterRegistry.listAll()) {
      expect(paymentAdapterRegistry.ownerOf(key), `adapter "${key}" has no owner`).toBeTruthy();
    }
    expect(paymentAdapterRegistry.ownerOf('bank_transfer')).toBe('payments');
    expect(paymentAdapterRegistry.ownerOf('stripe')).toBe('stripe');
    expect(paymentAdapterRegistry.ownerOf('payu')).toBe('payu');
    expect(paymentAdapterRegistry.ownerOf('tpay')).toBe('tpay');
    expect(paymentAdapterRegistry.ownerOf('autopay')).toBe('autopay');
  });

  it('hides a vendor gateway adapter from enumeration while its module is off', () => {
    expect(paymentAdapterRegistry.get('stripe')).toBeDefined();
    expect(paymentAdapterRegistry.list()).toContain('stripe');

    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['stripe'] });
    try {
      expect(paymentAdapterRegistry.get('stripe')).toBeUndefined();
      expect(paymentAdapterRegistry.list()).not.toContain('stripe');
      // Registration is untouched — off is not uninstall.
      expect(paymentAdapterRegistry.listAll()).toContain('stripe');
    } finally {
      registryCache.__setEnabledForTesting(ALL_IDS);
    }

    expect(paymentAdapterRegistry.get('stripe')).toBeDefined();
  });

  it('refuses a direct order submission naming an absent gateway method', async () => {
    // The lists no longer offer it, so reaching placement means an API client
    // sent the id straight in. Opening a payment nothing can settle is the
    // blind alley one layer down from the one the ruling names.
    await seedCartForStubCustomer(h.em());
    const submit = async (): Promise<{ statusCode: number; code: string | undefined }> => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        payload: {
          deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
          billingAddressId: '00000000-0000-4000-8000-0000000000d2',
          deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
        },
        cookies: { b2b_session: 'stub-customer-session' },
      });
      const body = res.json() as { error?: { code?: string } };
      return { statusCode: res.statusCode, code: body.error?.code };
    };

    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['payments'] });
    try {
      const refused = await submit();
      expect(refused.statusCode).toBe(503);
      expect(refused.code).toBe('MODULE_DISABLED');
    } finally {
      registryCache.__setEnabledForTesting(ALL_IDS);
    }
  });

  it('never re-binds a method the operator unbound from every sales channel', async () => {
    // The boot-time reconcile is what used to undo the operator's choice: a
    // gateway's `ensureAll()` ran from its plugin body on every composition and
    // `bindToDefaultIfEmpty` re-bound any row that had no membership left.
    // Seeding is a migration now and this call — the one the boot used to make
    // per method code — must leave the operator's unbind alone.
    const unboundCode = `unbound_probe_${randomUUID().slice(0, 8)}`;
    const reconciler = new PaymentMethodReconciler(h.em);
    const row = await reconciler.ensureMethodForAdapter('bank_transfer', {
      code: unboundCode,
      type: 'bank_transfer',
      name: { default: 'Unbound probe' },
    });

    expect(await channelCount(h, row.id)).toBe(0);

    await reconciler.ensureMethodForAdapter('bank_transfer', {
      code: unboundCode,
      type: 'bank_transfer',
      name: { default: 'Unbound probe' },
    });
    expect(await channelCount(h, row.id)).toBe(0);
  });
});

async function channelCount(h: BackendServerHandle, paymentMethodId: string): Promise<number> {
  const em = h.em();
  const rows = await em
    .getConnection()
    .execute<Array<{ count: string }>>(
      `select count(*)::text as count from "sales_channel_payment_methods" where "payment_method_id" = ?`,
      [paymentMethodId],
      'all',
      em.getTransactionContext(),
    );
  return Number(rows[0]?.count ?? '0');
}
