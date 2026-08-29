/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array.
 *
 * The array is what the platform reads when this module is **installed**:
 * `src/packages/package-runtime.ts` takes `exported['migrations']` and refuses
 * the package outright when it is absent (D-168).
 *
 * Listed in ascending timestamp, which orders **this module's own** migrations
 * and nothing else (feature 081). Where the block sits relative to every other
 * module's is decided by the manifest `dependencies` graph.
 *
 * The **named** exports stay, and the asymmetry with `./backend` — which
 * publishes an array and no entity class by name (D-168) — is deliberate.
 * `db/migrations-registry.generated.ts` imports each class by name from this
 * specifier, and a migration class name is contract in a way an entity class
 * name is not: `mikro_orm_migrations` persists it, so it is a string every
 * already-migrated database holds.
 *
 * A class that is in neither the array nor the barrel is a migration that does
 * not run: `migration:pending` reports nothing pending and the first symptom
 * is a query against a table nobody created.
 */

import { Migration20260424T205317OrganizationsInit } from './20260424T205317_organizations_init.js';
import { Migration20260425T051700OrganizationsInvitationsInit } from './20260425T051700_organizations_invitations_init.js';
import { Migration20260611T140349OrganizationsConsolidation } from './20260611T140349_organizations_consolidation.js';
import { Migration20260611T140358OrganizationsOrgOrderConfirmationEmails } from './20260611T140358_organizations_org_order_confirmation_emails.js';
import { Migration20260611T140402OrganizationsOrgFulfilmentStrategy } from './20260611T140402_organizations_org_fulfilment_strategy.js';
import { Migration20260717T151403OrganizationsPersonalOrganizations } from './20260717T151403_organizations_personal_organizations.js';
import { Migration20260718T200340OrganizationsOrganizationCustomFieldValues } from './20260718T200340_organizations_organization_custom_field_values.js';
import { Migration20260720T044254OrganizationsOrgHierarchy } from './20260720T044254_organizations_org_hierarchy.js';

export const migrations = [
  Migration20260424T205317OrganizationsInit,
  Migration20260425T051700OrganizationsInvitationsInit,
  Migration20260611T140349OrganizationsConsolidation,
  Migration20260611T140358OrganizationsOrgOrderConfirmationEmails,
  Migration20260611T140402OrganizationsOrgFulfilmentStrategy,
  Migration20260717T151403OrganizationsPersonalOrganizations,
  Migration20260718T200340OrganizationsOrganizationCustomFieldValues,
  Migration20260720T044254OrganizationsOrgHierarchy,
];

export {
  Migration20260424T205317OrganizationsInit,
  Migration20260425T051700OrganizationsInvitationsInit,
  Migration20260611T140349OrganizationsConsolidation,
  Migration20260611T140358OrganizationsOrgOrderConfirmationEmails,
  Migration20260611T140402OrganizationsOrgFulfilmentStrategy,
  Migration20260717T151403OrganizationsPersonalOrganizations,
  Migration20260718T200340OrganizationsOrganizationCustomFieldValues,
  Migration20260720T044254OrganizationsOrgHierarchy,
};
