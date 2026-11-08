/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array, in ascending timestamp (feature 081).
 *
 * The named export stays beside the array: `db/migrations-registry.generated.ts`
 * imports each class by name, and a migration class name is persisted in
 * `mikro_orm_migrations`.
 */

import { Migration20261017T071754DocumentTemplatesInit } from './20261017T071754_document_templates_init.js';
import { Migration20261107T110328DocumentTemplatesInvoiceSeededLabels } from './20261107T110328_document_templates_invoice_seeded_labels.js';

export const migrations = [
  Migration20261017T071754DocumentTemplatesInit,
  Migration20261107T110328DocumentTemplatesInvoiceSeededLabels,
];

export {
  Migration20261017T071754DocumentTemplatesInit,
  Migration20261107T110328DocumentTemplatesInvoiceSeededLabels,
};
