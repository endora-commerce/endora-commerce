import type { EntityManager } from '@mikro-orm/postgresql';
import type { CustomerDefaults } from '@b2b/contracts';
import type { DefaultPreferenceService } from '../../quick_order/services/default-preference-service.js';
import type { PreferenceAuditContext } from '../../quick_order/services/default-preference-service.js';
import type { CustomerAddressService } from './customer-address-service.js';
import { CustomerAddress } from '../entities/customer-address.entity.js';

/**
 * CustomerDefaultsService — the customer's checkout defaults (feature 040, US2).
 *
 * Split source of truth (research §R5, reconciled with the existing schema):
 *   - default **payment / delivery method** → the quick_order
 *     `QuickOrderDefaultPreference` (scope `customer`), which checkout already
 *     consumes.
 *   - default **billing / shipping address** → the `isDefault` flag on the
 *     customer's personal `customer_addresses` rows. (The preference table's
 *     address columns FK to the org `addresses` table, so personal addresses
 *     cannot be stored there.)
 */
export interface CustomerDefaultsPatch {
  paymentMethodId?: string | null | undefined;
  deliveryMethodId?: string | null | undefined;
  billingAddressId?: string | null | undefined;
  shippingAddressId?: string | null | undefined;
}

export class CustomerDefaultsService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly preferences: DefaultPreferenceService,
    private readonly addresses: CustomerAddressService,
  ) {}

  async getForCustomer(customerAccountId: string): Promise<CustomerDefaults> {
    const methods = await this.preferences.resolveForCustomer(customerAccountId);
    const [billingAddressId, shippingAddressId] = await Promise.all([
      this.defaultAddressId(customerAccountId, 'billing'),
      this.defaultAddressId(customerAccountId, 'delivery'),
    ]);
    return {
      paymentMethodId: methods.paymentMethodId,
      deliveryMethodId: methods.deliveryMethodId,
      billingAddressId,
      shippingAddressId,
    };
  }

  /** Self-service update — the customer manages their own customer-scoped defaults. */
  async setForCustomer(
    customerAccountId: string,
    patch: CustomerDefaultsPatch,
    audit: PreferenceAuditContext,
  ): Promise<CustomerDefaults> {
    // Default payment / delivery method → preference store.
    if (patch.paymentMethodId !== undefined || patch.deliveryMethodId !== undefined) {
      await this.preferences.upsert(
        { kind: 'customer', customerAccountId },
        {
          scope: 'customer',
          scopeId: customerAccountId,
          ...(patch.paymentMethodId !== undefined
            ? { defaultPaymentMethodId: patch.paymentMethodId }
            : {}),
          ...(patch.deliveryMethodId !== undefined
            ? { defaultDeliveryMethodId: patch.deliveryMethodId }
            : {}),
        },
        audit,
      );
    }
    // Default billing / shipping address → the personal address book.
    if (patch.billingAddressId != null) {
      await this.addresses.setDefault(customerAccountId, patch.billingAddressId);
    }
    if (patch.shippingAddressId != null) {
      await this.addresses.setDefault(customerAccountId, patch.shippingAddressId);
    }
    return this.getForCustomer(customerAccountId);
  }

  private async defaultAddressId(
    customerAccountId: string,
    kind: 'delivery' | 'billing',
  ): Promise<string | null> {
    const em = this.emFactory();
    const row = await em.findOne(CustomerAddress, {
      customerAccountId,
      kind,
      isDefault: true,
      deletedAt: null,
    });
    return row?.id ?? null;
  }
}
