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

import { Migration20261026T144350ProjectsInit } from './20261026T144350_projects_init.js';
import { Migration20261026T231555ProjectsLinkOrganization } from './20261026T231555_projects_link_organization.js';
import { Migration20261027T172441ProjectsValueChanges } from './20261027T172441_projects_value_changes.js';
import { Migration20261028T143448ProjectsReferenceKinds } from './20261028T143448_projects_reference_kinds.js';
import { Migration20261114T145439ProjectsStageAlertInterrupted } from './20261114T145439_projects_stage_alert_interrupted.js';
import { Migration20261114T153132ProjectsConfigurationVersions } from './20261114T153132_projects_configuration_versions.js';

export const migrations = [
  Migration20261026T144350ProjectsInit,
  Migration20261026T231555ProjectsLinkOrganization,
  Migration20261027T172441ProjectsValueChanges,
  Migration20261028T143448ProjectsReferenceKinds,
  Migration20261114T145439ProjectsStageAlertInterrupted,
  Migration20261114T153132ProjectsConfigurationVersions,
];

export {
  Migration20261026T144350ProjectsInit,
  Migration20261026T231555ProjectsLinkOrganization,
  Migration20261027T172441ProjectsValueChanges,
  Migration20261028T143448ProjectsReferenceKinds,
  Migration20261114T145439ProjectsStageAlertInterrupted,
  Migration20261114T153132ProjectsConfigurationVersions,
};
