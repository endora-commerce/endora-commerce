/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array. The platform reads the array when the package is
 * installed and refuses a package whose `./migrations` export carries none; a
 * class that is in neither the array nor the barrel is a migration that does
 * not run.
 *
 * The named export stays beside the array: the host's generated migration
 * registry imports each class by name from this specifier, and a migration
 * class name is contract — `mikro_orm_migrations` persists it.
 */

import { Migration20261005T132439CrmInit } from './20261005T132439_crm_init.js';
import { Migration20261005T215329CrmOpportunityCustomFieldValues } from './20261005T215329_crm_opportunity_custom_field_values.js';
import { Migration20261007T180600CrmOpportunityReferenceAdminUser } from './20261007T180600_crm_opportunity_reference_admin_user.js';

export const migrations = [
  Migration20261005T132439CrmInit,
  Migration20261005T215329CrmOpportunityCustomFieldValues,
  Migration20261007T180600CrmOpportunityReferenceAdminUser,
];

export {
  Migration20261005T132439CrmInit,
  Migration20261005T215329CrmOpportunityCustomFieldValues,
  Migration20261007T180600CrmOpportunityReferenceAdminUser,
};
