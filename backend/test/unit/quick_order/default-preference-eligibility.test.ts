import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type {
  AddressReadPort,
  CustomerAccountReadPort,
  CustomerAddressReadPort,
  DeliveryMethodReadPort,
  OrganizationRestrictionPort,
  PaymentMethodReadPort,
} from '@b2b/contracts';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { customerAddressesOrAbsent } from '../../../src/modules/quick_order/backend.js';
import {
  DefaultPreferenceService,
  type DefaultPreferenceCollaborators,
} from '../../../src/modules/quick_order/services/default-preference-service.js';

/**
 * Issue #216 — what a stored ordering default resolves to when the module that
 * owns the referenced row is switched off.
 *
 * Until this cut every one of these lookups was an `em.findOne` against another
 * module's entity. Deactivation drops no tables, so a switched-off
 * `payment_methods` still answered "yes, active" and one-click buy went on
 * offering a method the platform had stopped serving. Two different answers are
 * correct here and the difference is declared in `quick_order`'s manifest:
 *
 *   - `payment_methods` / `delivery_methods` / `addresses` / `customer_accounts`
 *     / `organizations` are **binding** dependencies, so their gates fail closed
 *     and the whole resolution refuses.
 *   - `customers` is a **`degrades-without`** dependency, so a personal address
 *     simply stops being eligible — which is what an ineligible default has
 *     always done (FR-020) and what a platform that never installed `customers`
 *     would answer.
 */

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';

function gateClosed(moduleId: string): never {
  throw new ModuleDisabledError(moduleId);
}

/** A method row the platform is serving. */
function activeMethod(id: string): { id: string; status: 'active' } {
  return { id, status: 'active' };
}

function collaborators(
  overrides: Partial<DefaultPreferenceCollaborators> = {},
): DefaultPreferenceCollaborators {
  return {
    customerAccounts: {
      findById: async () => ({ id: ACCOUNT_ID, organizationId: ORG_ID }),
    } as unknown as CustomerAccountReadPort,
    paymentMethods: {
      findById: async (id: string) => activeMethod(id),
    } as unknown as PaymentMethodReadPort,
    deliveryMethods: {
      findById: async (id: string) => activeMethod(id),
    } as unknown as DeliveryMethodReadPort,
    addresses: {
      findById: async () => null,
    } as unknown as AddressReadPort,
    customerAddresses: {
      findById: async (_accountId: string, addressId: string) => ({ id: addressId }),
      listForCustomer: async () => [],
    } as unknown as CustomerAddressReadPort,
    restriction: {
      allowedIdsFor: async () => null,
    } as unknown as OrganizationRestrictionPort,
    ...overrides,
  };
}

/**
 * The stored row, returned by the only `em` reads the service still makes —
 * its own table. `readRaw`/`upsert` are not exercised here.
 */
function emFactoryReturning(row: Record<string, unknown> | null): () => never {
  const em = {
    findOne: async (_entity: unknown, where: { scope?: string }) =>
      where.scope === 'customer' ? row : null,
  };
  return (() => em) as unknown as () => never;
}

describe('DefaultPreferenceService eligibility, with an owner switched off', () => {
  beforeEach(() => {
    registryCache.__setEnabledForTesting(['quick_order', 'customers']);
  });

  afterEach(() => {
    registryCache.__setEnabledForTesting(['quick_order', 'customers']);
  });

  it('resolves a stored default while every owner is present', async () => {
    const service = new DefaultPreferenceService(
      emFactoryReturning({
        defaultPaymentMethodId: 'pay-1',
        defaultDeliveryMethodId: 'del-1',
        defaultBillingAddressId: null,
        defaultShippingAddressId: 'ship-1',
      }),
      { record: async () => undefined } as never,
      collaborators({
        customerAddresses: customerAddressesOrAbsent({
          findById: async (_accountId: string, addressId: string) =>
            ({ id: addressId }) as never,
          listForCustomer: async () => [],
        }),
      }),
    );

    const resolved = await service.resolveForCustomer(ACCOUNT_ID);

    expect(resolved.paymentMethodId).toBe('pay-1');
    expect(resolved.deliveryMethodId).toBe('del-1');
    expect(resolved.shippingAddressId).toBe('ship-1');
  });

  it('treats an empty organisation allow-list as unrestricted, not as "nothing allowed"', () => {
    // Both `null` and `[]` mean allow-everything: `null` is an organisation
    // `organizations` cannot find, `[]` is one with no link rows, which is the
    // ordinary case. Reading `[]` as a restriction drops every stored default
    // silently — it did, and four contract tests caught it.
    return (async () => {
      for (const allowed of [null, [] as string[]]) {
        const service = new DefaultPreferenceService(
          emFactoryReturning({
            defaultPaymentMethodId: 'pay-1',
            defaultDeliveryMethodId: 'del-1',
            defaultBillingAddressId: null,
            defaultShippingAddressId: null,
          }),
          { record: async () => undefined } as never,
          collaborators({
            restriction: {
              allowedIdsFor: async () => allowed,
            } as unknown as OrganizationRestrictionPort,
          }),
        );
        const resolved = await service.resolveForCustomer(ACCOUNT_ID);
        expect(resolved.paymentMethodId).toBe('pay-1');
        expect(resolved.deliveryMethodId).toBe('del-1');
      }
    })();
  });

  it('honours a non-empty allow-list that excludes the stored default', async () => {
    const service = new DefaultPreferenceService(
      emFactoryReturning({
        defaultPaymentMethodId: 'pay-1',
        defaultDeliveryMethodId: null,
        defaultBillingAddressId: null,
        defaultShippingAddressId: null,
      }),
      { record: async () => undefined } as never,
      collaborators({
        restriction: {
          allowedIdsFor: async () => ['pay-2'],
        } as unknown as OrganizationRestrictionPort,
      }),
    );

    expect((await service.resolveForCustomer(ACCOUNT_ID)).paymentMethodId).toBeNull();
  });

  it('fails closed when `payment_methods` is off — it does not answer "no such method"', async () => {
    const service = new DefaultPreferenceService(
      emFactoryReturning({
        defaultPaymentMethodId: 'pay-1',
        defaultDeliveryMethodId: null,
        defaultBillingAddressId: null,
        defaultShippingAddressId: null,
      }),
      { record: async () => undefined } as never,
      collaborators({
        paymentMethods: {
          findById: () => gateClosed('payment_methods'),
        } as unknown as PaymentMethodReadPort,
      }),
    );

    await expect(service.resolveForCustomer(ACCOUNT_ID)).rejects.toThrow(ModuleDisabledError);
  });

  it('fails closed when `delivery_methods` is off', async () => {
    const service = new DefaultPreferenceService(
      emFactoryReturning({
        defaultPaymentMethodId: null,
        defaultDeliveryMethodId: 'del-1',
        defaultBillingAddressId: null,
        defaultShippingAddressId: null,
      }),
      { record: async () => undefined } as never,
      collaborators({
        deliveryMethods: {
          findById: () => gateClosed('delivery_methods'),
        } as unknown as DeliveryMethodReadPort,
      }),
    );

    await expect(service.resolveForCustomer(ACCOUNT_ID)).rejects.toThrow(ModuleDisabledError);
  });

  it('degrades — not 503 — when `customers` is off: a personal address stops being eligible', async () => {
    registryCache.__setEnabledForTesting(['quick_order', 'customers'], {
      deactivated: ['customers'],
    });

    const service = new DefaultPreferenceService(
      emFactoryReturning({
        defaultPaymentMethodId: 'pay-1',
        defaultDeliveryMethodId: null,
        defaultBillingAddressId: null,
        defaultShippingAddressId: 'personal-1',
      }),
      { record: async () => undefined } as never,
      collaborators({
        // The gate a closed `customers` really puts up: resolving the port
        // throws. The wrapper must decide presence *before* it resolves.
        customerAddresses: customerAddressesOrAbsent({
          findById: () => gateClosed('customers'),
          listForCustomer: () => gateClosed('customers'),
        }),
      }),
    );

    const resolved = await service.resolveForCustomer(ACCOUNT_ID);

    expect(resolved.shippingAddressId).toBeNull();
    expect(resolved.source.shipping).toBeNull();
    // The rest of the resolution is untouched: switching a CRM surface off must
    // not take one-click buy down for buyers whose defaults are org addresses.
    expect(resolved.paymentMethodId).toBe('pay-1');
  });

  it('keeps an org-shared address eligible while `customers` is off', async () => {
    registryCache.__setEnabledForTesting(['quick_order', 'customers'], {
      deactivated: ['customers'],
    });

    const service = new DefaultPreferenceService(
      emFactoryReturning({
        defaultPaymentMethodId: null,
        defaultDeliveryMethodId: null,
        defaultBillingAddressId: 'org-1',
        defaultShippingAddressId: null,
      }),
      { record: async () => undefined } as never,
      collaborators({
        addresses: {
          findById: async (_orgId: string, addressId: string) => ({ id: addressId }),
        } as unknown as AddressReadPort,
        customerAddresses: customerAddressesOrAbsent({
          findById: () => gateClosed('customers'),
          listForCustomer: () => gateClosed('customers'),
        }),
      }),
    );

    const resolved = await service.resolveForCustomer(ACCOUNT_ID);

    expect(resolved.billingAddressId).toBe('org-1');
  });

  it('resolves the personal address again the moment `customers` is switched back on', async () => {
    const build = (): DefaultPreferenceService =>
      new DefaultPreferenceService(
        emFactoryReturning({
          defaultPaymentMethodId: null,
          defaultDeliveryMethodId: null,
          defaultBillingAddressId: null,
          defaultShippingAddressId: 'personal-1',
        }),
        { record: async () => undefined } as never,
        collaborators({
          customerAddresses: customerAddressesOrAbsent({
            findById: async (_accountId: string, addressId: string) =>
              ({ id: addressId }) as never,
            listForCustomer: async () => [],
          }),
        }),
      );

    registryCache.__setEnabledForTesting(['quick_order', 'customers'], {
      deactivated: ['customers'],
    });
    // The same instance across the flip: the probe is per call, so an operator
    // switching the module back on must not need a restart.
    const service = build();
    expect((await service.resolveForCustomer(ACCOUNT_ID)).shippingAddressId).toBeNull();

    registryCache.__setEnabledForTesting(['quick_order', 'customers']);
    expect((await service.resolveForCustomer(ACCOUNT_ID)).shippingAddressId).toBe('personal-1');
  });
});
