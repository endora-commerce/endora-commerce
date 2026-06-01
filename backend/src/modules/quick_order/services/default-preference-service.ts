import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type QuickOrderPreference,
  type QuickOrderPreferenceScope,
  type QuickOrderPreferenceUpsert,
  type QuickOrderResolvedDefaults,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import { PaymentMethod } from '../../payment_methods/entities/payment-method.entity.js';
import { DeliveryMethod } from '../../delivery_methods/entities/delivery-method.entity.js';
import { Address } from '../../addresses/entities/address.entity.js';
import { CustomerAddress } from '../../customers/entities/customer-address.entity.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';
import type { OrganizationRestrictionService } from '../../organizations/services/organization-restriction-service.js';
import { QuickOrderDefaultPreference } from '../entities/quick-order-default-preference.entity.js';
import { canManagePreference, type PreferenceActor } from './default-preference-authz.js';
import {
  resolvePreferenceFields,
  type PreferenceRow,
  type ResolvedField,
} from './default-preference-resolver.js';

export interface PreferenceAuditContext {
  actorAdminUserId?: string | null;
  customerAccountId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
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
export class DefaultPreferenceService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog: AuditLogService,
    private readonly restriction?: OrganizationRestrictionService,
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
      input.scope === 'customer' ? await this.customerOrganizationId(em, input.scopeId) : null;
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
    const organizationId = await this.customerOrganizationId(em, customerAccountId);

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

    const allow = organizationId && this.restriction
      ? await this.restriction.readAllowLists(organizationId)
      : null;

    const payment = await this.keepIf(resolved.payment, (id) =>
      this.isPaymentEligible(em, id, allow?.paymentMethodIds ?? []),
    );
    const delivery = await this.keepIf(resolved.delivery, (id) =>
      this.isDeliveryEligible(em, id, allow?.deliveryMethodIds ?? []),
    );
    const billing = await this.keepIf(resolved.billing, (id) =>
      this.isAddressEligible(em, id, organizationId, customerAccountId),
    );
    const shipping = await this.keepIf(resolved.shipping, (id) =>
      this.isAddressEligible(em, id, organizationId, customerAccountId),
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

  private async isPaymentEligible(
    em: EntityManager,
    id: string,
    allowed: string[],
  ): Promise<boolean> {
    const method = await em.findOne(PaymentMethod, { id });
    if (!method || method.status !== 'active') return false;
    return allowed.length === 0 || allowed.includes(id);
  }

  private async isDeliveryEligible(
    em: EntityManager,
    id: string,
    allowed: string[],
  ): Promise<boolean> {
    const method = await em.findOne(DeliveryMethod, { id });
    if (!method || method.status !== 'active') return false;
    return allowed.length === 0 || allowed.includes(id);
  }

  private async isAddressEligible(
    em: EntityManager,
    id: string,
    organizationId: string | null,
    customerAccountId: string,
  ): Promise<boolean> {
    // Org-shared address belonging to the customer's organization.
    const orgAddress = await em.findOne(Address, { id });
    if (
      orgAddress &&
      !orgAddress.deletedAt &&
      organizationId !== null &&
      orgAddress.organizationId === organizationId
    ) {
      return true;
    }
    // Feature 040 — personal address owned by the customer.
    const personal = await em.findOne(CustomerAddress, { id });
    return (
      personal != null &&
      !personal.deletedAt &&
      personal.customerAccountId === customerAccountId
    );
  }

  private async customerOrganizationId(em: EntityManager, customerAccountId: string): Promise<string | null> {
    const customer = await em.findOne(CustomerAccount, { id: customerAccountId });
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
