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
import { Migration20261008T135701CrmOpportunityEvents } from './20261008T135701_crm_opportunity_events.js';
import { Migration20261009T163307CrmOpportunityMessageReads } from './20261009T163307_crm_opportunity_message_reads.js';
import { Migration20261027T020030CrmOpportunityReferenceDocuments } from './20261027T020030_crm_opportunity_reference_documents.js';
import { Migration20261028T143444CrmOpportunityReferenceKinds } from './20261028T143444_crm_opportunity_reference_kinds.js';
import { Migration20261109T163616CrmOpportunityValueChanges } from './20261109T163616_crm_opportunity_value_changes.js';

export const migrations = [
  Migration20261005T132439CrmInit,
  Migration20261005T215329CrmOpportunityCustomFieldValues,
  Migration20261007T180600CrmOpportunityReferenceAdminUser,
  Migration20261008T135701CrmOpportunityEvents,
  Migration20261009T163307CrmOpportunityMessageReads,
  Migration20261027T020030CrmOpportunityReferenceDocuments,
  Migration20261028T143444CrmOpportunityReferenceKinds,
  Migration20261109T163616CrmOpportunityValueChanges,
];

export {
  Migration20261005T132439CrmInit,
  Migration20261005T215329CrmOpportunityCustomFieldValues,
  Migration20261007T180600CrmOpportunityReferenceAdminUser,
  Migration20261008T135701CrmOpportunityEvents,
  Migration20261009T163307CrmOpportunityMessageReads,
  Migration20261027T020030CrmOpportunityReferenceDocuments,
  Migration20261028T143444CrmOpportunityReferenceKinds,
  Migration20261109T163616CrmOpportunityValueChanges,
};
