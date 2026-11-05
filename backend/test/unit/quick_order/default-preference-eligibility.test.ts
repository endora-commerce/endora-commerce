import { describe, expect, it } from 'vitest';
import type {
  AddressReadPort,
  CustomerAccountReadPort,
  DeliveryMethodReadPort,
  OrganizationRestrictionPort,
  PaymentMethodReadPort,
} from '@endora-commerce/contracts';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import {
  DefaultPreferenceService,
  type DefaultPreferenceCollaborators,
} from '../../../../packages/modules/quick_order/src/backend/services/default-preference-service.js';

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
 *
 * Issue #769 — `customers` is not consulted at all: a default address comes
 * from the organisation book (`addresses`) only, because the preference table's
 * address columns are foreign keys to that table. A personal-book id is never
 * eligible, whether `customers` is on or off.
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
        addresses: {
          findById: async (_orgId: string, addressId: string) => ({ id: addressId }),
        } as unknown as AddressReadPort,
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

  it('fails closed when `addresses` is off — it does not answer "no such address"', async () => {
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
          findById: () => gateClosed('addresses'),
        } as unknown as AddressReadPort,
      }),
    );

    await expect(service.resolveForCustomer(ACCOUNT_ID)).rejects.toThrow(ModuleDisabledError);
  });

  it('drops a stored address the organisation book does not hold — a personal-book id included (issue #769)', async () => {
    const service = new DefaultPreferenceService(
      emFactoryReturning({
        defaultPaymentMethodId: 'pay-1',
        defaultDeliveryMethodId: null,
        defaultBillingAddressId: 'org-1',
        defaultShippingAddressId: 'personal-1',
      }),
      { record: async () => undefined } as never,
      collaborators({
        addresses: {
          findById: async (_orgId: string, addressId: string) =>
            addressId === 'org-1' ? { id: addressId } : null,
        } as unknown as AddressReadPort,
      }),
    );

    const resolved = await service.resolveForCustomer(ACCOUNT_ID);

    expect(resolved.billingAddressId).toBe('org-1');
    expect(resolved.shippingAddressId).toBeNull();
    expect(resolved.source.shipping).toBeNull();
    expect(resolved.paymentMethodId).toBe('pay-1');
  });
});
