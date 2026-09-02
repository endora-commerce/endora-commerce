import type { EntityManager } from '@mikro-orm/postgresql';
import {
  OrganizationCannotTransactError,
  OrganizationNotFoundError,
} from '@endora-commerce/contracts';
import { Organization } from '../entities/organization.entity.js';

/**
 * Lightweight read-side service that exposes "what's the effective state of
 * this Customer's Organization?" without forcing every caller to write the
 * `findOne` boilerplate.
 *
 * Two responsibilities only:
 *
 *  1. `loadEffectiveOrganization(organizationId)` — returns the Organization
 *     or `null` if it doesn't exist / is soft-deleted. Cheap (single PK
 *     lookup; MikroORM caches per request).
 *
 *  2. `assertCanTransact(orgId | org)` — throws `OrganizationCannotTransactError`
 *     when the status is anything other than `active`. The error carries a
 *     localized-message key and the current status so route handlers can map
 *     it to HTTP 423 with a Customer-friendly body.
 *
 * The service is consumed by cart-line-add, checkout-submit, and
 * quote-request-submit route handlers. Read-only flows (browse, view-cart,
 * order-history) do NOT call `assertCanTransact` — pending / blocked /
 * rejected Organizations may still see the storefront.
 */
export class OrganizationContextService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async loadEffectiveOrganization(organizationId: string): Promise<Organization | null> {
    const em = this.emFactory();
    return em.findOne(Organization, { id: organizationId, deletedAt: null });
  }

  /**
   * @throws {OrganizationNotFoundError} when the org doesn't exist.
   * @throws {OrganizationCannotTransactError} when status ≠ `active`.
   */
  async assertCanTransact(organizationId: string): Promise<Organization> {
    const org = await this.loadEffectiveOrganization(organizationId);
    if (!org) {
      throw new OrganizationNotFoundError(organizationId);
    }
    if (org.status !== 'active') {
      throw new OrganizationCannotTransactError(org.id, org.status);
    }
    return org;
  }

  /**
   * Feature 027 §R2 — single-boolean lookup driving the per-Organization
   * cart-approval policy. Returns `false` when the Organization is
   * missing or soft-deleted (the gate is off by definition in that case
   * — a Customer with no Organization uses platform defaults).
   */
  async loadCartApprovalPolicy(organizationId: string | null): Promise<boolean> {
    if (!organizationId) return false;
    const org = await this.loadEffectiveOrganization(organizationId);
    return org?.requiresCartApproval ?? false;
  }
}

/**
 * Both error classes moved to `@endora-commerce/contracts` in feature 075's Phase P. An
 * error is a shape, not behaviour — four modules catch `instanceof` on the
 * second one to turn it into a 409 envelope, and the kernel's
 * `OrganizationReadPort` has documented both as `assertCanTransact`'s failure
 * modes since D-32 while the classes themselves lived in this file.
 *
 * Re-exported here for the length of Phase P, which cuts no consumer.
 */
export { OrganizationNotFoundError, OrganizationCannotTransactError };
