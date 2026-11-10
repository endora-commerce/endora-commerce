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

import { Migration20261026T133731TasksInit } from './20261026T133731_tasks_init.js';
import { Migration20261028T140002TasksTaskManagement } from './20261028T140002_tasks_task_management.js';
import { Migration20261110T054810TasksValueChanges } from './20261110T054810_tasks_value_changes.js';

export const migrations = [
  Migration20261026T133731TasksInit,
  Migration20261028T140002TasksTaskManagement,
  Migration20261110T054810TasksValueChanges,
];

export {
  Migration20261026T133731TasksInit,
  Migration20261028T140002TasksTaskManagement,
  Migration20261110T054810TasksValueChanges,
};
