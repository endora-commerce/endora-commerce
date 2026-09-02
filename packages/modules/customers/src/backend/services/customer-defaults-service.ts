import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CustomerDefaults,
  DefaultPreferencePort,
  PreferenceAuditContext,
} from '@endora-commerce/contracts';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import type { CustomerAddressService } from './customer-address-service.js';
import { CustomerAddress } from '../entities/customer-address.entity.js';

/**
 * CustomerDefaultsService — the customer's checkout defaults (feature 040, US2).
 *
 * Split source of truth (research §R5, reconciled with the existing schema):
 *   - default **payment / delivery method** → the quick_order
 *     `QuickOrderDefaultPreference` (scope `customer`), which checkout already
 *     consumes. Reached through `defaultPreferencePort` (issue #216). This
 *     module used to build a **second instance** of `quick_order`'s
 *     `DefaultPreferenceService` out of an import of that module's directory,
 *     which is what kept the port — published for exactly this consumer —
 *     unreached, and what blocked converting that service's own entity reads
 *     to ports.
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
    private readonly preferences: DefaultPreferencePort,
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

  /**
   * The widening is `CustomerAddressService`'s, for the same reason and on the
   * same terms — see `#forAuthorisedCustomer` there. This method has two
   * callers and both establish the authority before reaching it: the self route
   * passes the caller's **own** account id, and the admin detail screen
   * (`CustomerAdminQueryService.getDetail`) has already resolved the account
   * through `customer_accounts`' `@OrgScoped` read model and returned `null` if
   * it was out of scope. The statement pins `customerAccountId`, so widening
   * the filter widens the authority by nothing. It goes when feature 087 gives
   * `customer_addresses` an `organization_id` of its own.
   */
  private async defaultAddressId(
    customerAccountId: string,
    kind: 'delivery' | 'billing',
  ): Promise<string | null> {
    const em = this.emFactory();
    const row = await withSystemScope(
      `customers: default ${kind} address of customer account ${customerAccountId}, authorised by its own @OrgScoped account read`,
      () =>
        em.findOne(CustomerAddress, {
          customerAccountId,
          kind,
          isDefault: true,
          deletedAt: null,
        }),
    );
    return row?.id ?? null;
  }
}
