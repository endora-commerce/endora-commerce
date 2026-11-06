import type {
  AddressReadPort,
  CustomerDefaults,
  DefaultPreferencePort,
  PreferenceAuditContext,
} from '@endora-commerce/contracts';

/**
 * CustomerDefaultsService — the customer's checkout defaults (feature 040, US2).
 *
 * Two owners, read side by side:
 *   - default **payment / delivery method** → the quick_order
 *     `QuickOrderDefaultPreference` (scope `customer`), which checkout already
 *     consumes. Reached through `defaultPreferencePort` (issue #216).
 *   - default **billing / shipping address** → the default of each kind in the
 *     customer's **Organization** book, through `addresses`' read port. Since
 *     `specs/173-b2c-address-book-merge/` release 1 that is every customer's one
 *     address book (OD-1); the personal book is retired, so setting an address
 *     default here is refused by the route (FR-010) and is done on the
 *     Organization book instead.
 */
export interface CustomerDefaultsPatch {
  paymentMethodId?: string | null | undefined;
  deliveryMethodId?: string | null | undefined;
}

export class CustomerDefaultsService {
  constructor(
    private readonly preferences: DefaultPreferencePort,
    private readonly addresses: Pick<AddressReadPort, 'findDefault'>,
  ) {}

  /**
   * `organizationId` is the account's own Organization: both callers have
   * resolved it already — the self route from the session, the admin detail
   * screen from `customer_accounts`' `@OrgScoped` read of the account.
   */
  async getForCustomer(customerAccountId: string, organizationId: string): Promise<CustomerDefaults> {
    const [methods, billing, shipping] = await Promise.all([
      this.preferences.resolveForCustomer(customerAccountId),
      this.addresses.findDefault(organizationId, 'billing'),
      this.addresses.findDefault(organizationId, 'delivery'),
    ]);
    return {
      paymentMethodId: methods.paymentMethodId,
      deliveryMethodId: methods.deliveryMethodId,
      billingAddressId: billing?.id ?? null,
      shippingAddressId: shipping?.id ?? null,
    };
  }

  /** Self-service update of the customer-scoped default payment / delivery method. */
  async setForCustomer(
    customerAccountId: string,
    organizationId: string,
    patch: CustomerDefaultsPatch,
    audit: PreferenceAuditContext,
  ): Promise<CustomerDefaults> {
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
    return this.getForCustomer(customerAccountId, organizationId);
  }
}
