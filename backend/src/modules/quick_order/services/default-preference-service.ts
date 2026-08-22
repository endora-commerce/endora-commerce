import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AddressReadPort,
  type CustomerAccountReadPort,
  type CustomerAddressReadPort,
  type DeliveryMethodReadPort,
  type OrganizationRestrictionPort,
  type PaymentMethodReadPort,
  type QuickOrderPreference,
  type QuickOrderPreferenceScope,
  type QuickOrderPreferenceUpsert,
  type QuickOrderResolvedDefaults,
} from '@endora-commerce/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { AuditPort } from '../../../kernel/ports/audit.js';
import { QuickOrderDefaultPreference } from '../entities/quick-order-default-preference.entity.js';
import type { PreferenceAuditContext } from '@endora-commerce/contracts';
import { canManagePreference, type PreferenceActor } from './default-preference-authz.js';
import {
  resolvePreferenceFields,
  type PreferenceRow,
  type ResolvedField,
} from './default-preference-resolver.js';

/**
 * Moved to `@endora-commerce/contracts` in feature 075's Phase P — `customers` passes it
 * when it writes a buyer's defaults. Re-exported here for the length of
 * Phase P, which cuts no consumer.
 */
export type { PreferenceAuditContext };

/** No allow-list at all, or an empty one: both mean every method is allowed. */
function unrestricted(allowed: string[] | null): allowed is null {
  return allowed === null || allowed.length === 0;
}

const FIELDS = [
  'defaultPaymentMethodId',
  'defaultDeliveryMethodId',
  'defaultBillingAddressId',
  'defaultShippingAddressId',
] as const;

/**
 * DefaultPreferenceService (feature 039, US2). Role-scoped CRUD over
 * `quick_order_default_preferences`, plus the effective-defaults resolver
 * (customer-over-org with use-time eligibility re-check). Every write is
 * audited (FR-021).
 */
export interface DefaultPreferenceCollaborators {
  /** `customer_accounts` — whose defaults these are. */
  readonly customerAccounts: CustomerAccountReadPort;
  /** `payment_methods` — is the stored default still a live method? */
  readonly paymentMethods: PaymentMethodReadPort;
  /** `delivery_methods` — the same question, delivery side. */
  readonly deliveryMethods: DeliveryMethodReadPort;
  /** `addresses` — the organisation's shared addresses. */
  readonly addresses: AddressReadPort;
  /**
   * `customers` — the buyer's personal addresses (feature 040).
   *
   * The one collaborator whose owner may be absent without this service
   * failing: see the null object in `backend.ts` and the module's
   * `nonBindingDependencies` entry.
   */
  readonly customerAddresses: CustomerAddressReadPort;
  /** `organizations` — the buyer organisation's method allow-lists. */
  readonly restriction: OrganizationRestrictionPort;
}

export class DefaultPreferenceService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog: AuditPort,
    private readonly ports: DefaultPreferenceCollaborators,
  ) {}

  /** Raw stored row for a scope (null if unset). */
  async readRaw(
    scope: QuickOrderPreferenceScope,
    scopeId: string,
  ): Promise<QuickOrderPreference | null> {
    const em = this.emFactory();
    const row = await em.findOne(QuickOrderDefaultPreference, { scope, scopeId });
    return row ? this.toContract(row) : null;
  }

  /**
   * Upsert a scope's defaults. Each field: `undefined` = leave unchanged;
   * explicit `null` = clear. Authorization per FR-018.
   */
  async upsert(
    actor: PreferenceActor,
    input: QuickOrderPreferenceUpsert,
    audit: PreferenceAuditContext,
  ): Promise<QuickOrderPreference> {
    const em = this.emFactory();

    const targetCustomerOrgId =
      input.scope === 'customer' ? await this.customerOrganizationId(input.scopeId) : null;
    if (!canManagePreference(actor, { scope: input.scope, scopeId: input.scopeId }, targetCustomerOrgId)) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Not allowed to manage these defaults.');
    }

    let row = await em.findOne(QuickOrderDefaultPreference, {
      scope: input.scope,
      scopeId: input.scopeId,
    });
    const before = row ? this.toContract(row) : null;
    if (!row) {
      row = em.create(QuickOrderDefaultPreference, { scope: input.scope, scopeId: input.scopeId });
    }

    for (const field of FIELDS) {
      if (field in input && input[field] !== undefined) {
        row[field] = input[field] ?? null;
      }
    }
    await em.persistAndFlush(row);

    const after = this.toContract(row);
    await this.auditLog.record({
      actorAdminUserId: audit.actorAdminUserId ?? null,
      impersonatedCustomerAccountId: audit.customerAccountId ?? null,
      action: 'quick_order.default_preference.update',
      objectType: 'QuickOrderDefaultPreference',
      objectId: row.id,
      stateBefore: before as Record<string, unknown> | null,
      stateAfter: after as Record<string, unknown>,
      ipAddress: audit.ipAddress ?? null,
      userAgent: audit.userAgent ?? null,
      requestId: audit.requestId ?? null,
    });
    return after;
  }

  /**
   * Effective defaults for a customer: customer-over-org per field, then each
   * value is dropped to null if it is no longer eligible (FR-020).
   */
  async resolveForCustomer(customerAccountId: string): Promise<QuickOrderResolvedDefaults> {
    const em = this.emFactory();
    const organizationId = await this.customerOrganizationId(customerAccountId);

    const customerRow = this.rowFields(
      await em.findOne(QuickOrderDefaultPreference, { scope: 'customer', scopeId: customerAccountId }),
    );
    const orgRow = organizationId
      ? this.rowFields(
          await em.findOne(QuickOrderDefaultPreference, {
            scope: 'organization',
            scopeId: organizationId,
          }),
        )
      : null;

    const resolved = resolvePreferenceFields(customerRow, orgRow);

    // Two spellings of "unrestricted", and both mean allow-everything. `null`
    // is the degrade the owner put inside its own return type (composition
    // checklist item 7) — an organisation the restriction module cannot find —
    // and an **empty array** is an organisation with no link rows, which is the
    // ordinary case. Reading either as "nothing is allowed" drops every stored
    // default silently; see `isPaymentEligible`.
    const allowedPayment = organizationId
      ? await this.ports.restriction.allowedIdsFor(organizationId, 'paymentMethodIds')
      : null;
    const allowedDelivery = organizationId
      ? await this.ports.restriction.allowedIdsFor(organizationId, 'deliveryMethodIds')
      : null;

    const payment = await this.keepIf(resolved.payment, (id) =>
      this.isPaymentEligible(id, allowedPayment),
    );
    const delivery = await this.keepIf(resolved.delivery, (id) =>
      this.isDeliveryEligible(id, allowedDelivery),
    );
    const billing = await this.keepIf(resolved.billing, (id) =>
      this.isAddressEligible(id, organizationId, customerAccountId),
    );
    const shipping = await this.keepIf(resolved.shipping, (id) =>
      this.isAddressEligible(id, organizationId, customerAccountId),
    );

    return {
      paymentMethodId: payment.id,
      deliveryMethodId: delivery.id,
      billingAddressId: billing.id,
      shippingAddressId: shipping.id,
      source: {
        payment: payment.source,
        delivery: delivery.source,
        billing: billing.source,
        shipping: shipping.source,
      },
    };
  }

  private async keepIf(
    field: ResolvedField,
    eligible: (id: string) => Promise<boolean>,
  ): Promise<ResolvedField> {
    if (!field.id) return field;
    return (await eligible(field.id)) ? field : { id: null, source: null };
  }

  private async isPaymentEligible(id: string, allowed: string[] | null): Promise<boolean> {
    const method = await this.ports.paymentMethods.findById(id);
    if (!method || method.status !== 'active') return false;
    return unrestricted(allowed) || allowed.includes(id);
  }

  private async isDeliveryEligible(id: string, allowed: string[] | null): Promise<boolean> {
    const method = await this.ports.deliveryMethods.findById(id);
    if (!method || method.status !== 'active') return false;
    return unrestricted(allowed) || allowed.includes(id);
  }

  private async isAddressEligible(
    id: string,
    organizationId: string | null,
    customerAccountId: string,
  ): Promise<boolean> {
    // Org-shared address belonging to the customer's organization. `liveOnly`
    // because this answer feeds a choice rather than a rendering: without it
    // `findById` returns soft-deleted rows and a deleted address becomes an
    // eligible one-click default (AddressReadPort's doc block).
    if (organizationId !== null) {
      const orgAddress = await this.ports.addresses.findById(organizationId, id, {
        liveOnly: true,
      });
      if (orgAddress) return true;
    }
    // Feature 040 — personal address owned by the customer. Same `liveOnly`
    // reason, and the port already scopes by account, so the ownership check
    // cannot be forgotten.
    const personal = await this.ports.customerAddresses.findById(customerAccountId, id, {
      liveOnly: true,
    });
    return personal !== null;
  }

  private async customerOrganizationId(customerAccountId: string): Promise<string | null> {
    const customer = await this.ports.customerAccounts.findById(customerAccountId);
    return customer?.organizationId ?? null;
  }

  private rowFields(row: QuickOrderDefaultPreference | null): PreferenceRow | null {
    if (!row) return null;
    return {
      defaultPaymentMethodId: row.defaultPaymentMethodId ?? null,
      defaultDeliveryMethodId: row.defaultDeliveryMethodId ?? null,
      defaultBillingAddressId: row.defaultBillingAddressId ?? null,
      defaultShippingAddressId: row.defaultShippingAddressId ?? null,
    };
  }

  private toContract(row: QuickOrderDefaultPreference): QuickOrderPreference {
    return {
      scope: row.scope,
      scopeId: row.scopeId,
      defaultPaymentMethodId: row.defaultPaymentMethodId ?? null,
      defaultDeliveryMethodId: row.defaultDeliveryMethodId ?? null,
      defaultBillingAddressId: row.defaultBillingAddressId ?? null,
      defaultShippingAddressId: row.defaultShippingAddressId ?? null,
    };
  }
}
