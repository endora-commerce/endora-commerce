import type { Organization } from '../../modules/organizations/entities/organization.entity.js';

/**
 * Kernel port — organisation read (feature 072, D-32).
 *
 * The Organization is the one tenant concept (Constitution XI), so almost every
 * module needs to read one. Today four modules import
 * `organizations/services/organization-context-service.js` directly and
 * twenty-three import the entity class. This port is the seam that replaces the
 * first group; the entity import stays legitimate because reading another
 * module's table through the ORM is not an ORM *relation* (data-model §2.1).
 *
 * The **owner is the `organizations` module**, which registers the default
 * (`OrganizationContextService`). The kernel owns only the shape, so nothing in
 * the kernel imports a module service.
 */
export interface OrganizationReadPort {
  /** The Organization, or `null` when it does not exist or is soft-deleted. */
  loadEffectiveOrganization(organizationId: string): Promise<Organization | null>;

  /**
   * Resolve the Organization and refuse when it may not transact.
   *
   * @throws `OrganizationNotFoundError` when the organisation does not exist.
   * @throws `OrganizationCannotTransactError` when its status is not `active`.
   */
  assertCanTransact(organizationId: string): Promise<Organization>;

  /** Per-organisation cart-approval policy; `false` for a customer with no organisation. */
  loadCartApprovalPolicy(organizationId: string | null): Promise<boolean>;
}
