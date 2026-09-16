/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array.
 *
 * The array is what the platform reads when this module is **installed**:
 * `src/packages/package-runtime.ts` takes `exported['migrations']` and refuses
 * the package outright when it is absent (D-168).
 *
 * Listed in ascending timestamp, which is the order of this module's own
 * migrations and of nothing else (feature 081): a manifest `dependencies` array
 * is the only thing ordering this block against another module's.
 *
 * The **named** exports stay beside the array, and the asymmetry with
 * `./backend` — which publishes an array and no named class (D-168) — is
 * deliberate. `db/migrations-registry.generated.ts` imports each class by name
 * from this specifier, and a migration class name is contract in a way an entity
 * class name is not: `mikro_orm_migrations` persists it, so it is a string every
 * already-migrated database holds.
 *
 * A class that is in neither the array nor the barrel is a migration that does
 * not run: `migration:pending` reports nothing pending and the first symptom is
 * a query against a table nobody created.
 */

import { Migration20260629T125121InvoicesModule } from './20260629T125121_invoices_module.js';
import { Migration20260801T111000InvoicesGenericTemplateReseed } from './20260801T111000_invoices_generic_template_reseed.js';
import { Migration20260817T201110InvoicesCorrectionIdempotencyKey } from './20260817T201110_invoices_correction_idempotency_key.js';
import { Migration20260903T101756InvoicesNamespaceBlockNames } from './20260903T101756_invoices_namespace_block_names.js';
import { Migration20260914T133603InvoicesErpImportedSaleDocuments } from './20260914T133603_invoices_erp_imported_sale_documents.js';

export const migrations = [
  Migration20260629T125121InvoicesModule,
  Migration20260801T111000InvoicesGenericTemplateReseed,
  Migration20260817T201110InvoicesCorrectionIdempotencyKey,
  Migration20260903T101756InvoicesNamespaceBlockNames,
  Migration20260914T133603InvoicesErpImportedSaleDocuments,
];

export {
  Migration20260629T125121InvoicesModule,
  Migration20260801T111000InvoicesGenericTemplateReseed,
  Migration20260817T201110InvoicesCorrectionIdempotencyKey,
  Migration20260903T101756InvoicesNamespaceBlockNames,
  Migration20260914T133603InvoicesErpImportedSaleDocuments,
};
