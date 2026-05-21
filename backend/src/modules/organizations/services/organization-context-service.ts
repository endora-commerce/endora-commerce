import type { EntityManager } from '@mikro-orm/postgresql';
import { Organization, type OrganizationStatus } from '../entities/organization.entity.js';

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
}

export class OrganizationNotFoundError extends Error {
  constructor(public readonly organizationId: string) {
    super(`Organization ${organizationId} not found.`);
    this.name = 'OrganizationNotFoundError';
  }
}

export class OrganizationCannotTransactError extends Error {
  constructor(
    public readonly organizationId: string,
    public readonly status: Exclude<OrganizationStatus, 'active'>,
  ) {
    super(`Organization ${organizationId} cannot transact in status '${status}'.`);
    this.name = 'OrganizationCannotTransactError';
  }
}
