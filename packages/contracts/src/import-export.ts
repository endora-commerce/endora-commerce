/**
 * The bulk-import report shape, shared by every module that owns an importable
 * entity (feature 075, D-74).
 *
 * `import_export` parses the spreadsheet and renders the report; the module
 * that owns the rows validates them, resolves them against each other, opens
 * the transaction and writes the audit row. So the two halves need one word for
 * "which row was refused and why", and it lives here rather than in either of
 * them: `catalog` and `inventory` both answer in it, and neither may import the
 * other's contracts file to say so.
 *
 * The index is the caller's, deliberately. An owner has no idea a row came from
 * line 7 of a CSV — the row number an operator sees is `index + 2`, and
 * computing it is the spreadsheet reader's business, not the catalogue's.
 */

import { z } from 'zod';

/** One rejected row of a bulk import. `index` is 0-based over the rows the caller passed. */
export interface BulkImportRowError {
  index: number;
  reason: string;
}

/**
 * Either every row landed or none did: `imported` is 0 whenever `errors` is
 * non-empty.
 *
 * That is the operator-facing promise rather than an implementation detail —
 * there is no import-run ledger and no idempotency key anywhere in the
 * platform, so all-or-nothing is the only thing that makes re-uploading a
 * corrected spreadsheet safe.
 */
export interface BulkImportReport {
  imported: number;
  errors: BulkImportRowError[];
}

/**
 * One entity the import/export centre offers, as
 * `GET /api/v1/admin/import-export/entities` answers.
 *
 * The list is **presence-derived**: an entity appears only while every module
 * that owns its rows is effectively present. Until D-74 the admin SPA carried
 * the five slugs as a literal array, so an operator who switched `inventory`
 * off was still offered a Stock import — Principle XVII rule 5 in one screen.
 *
 * `importHeader` is `null` when import is unsupported for the entity, which is
 * the same fact the 405 the POST answers with states.
 */
export const importExportEntitySchema = z.object({
  name: z.string(),
  exportHeader: z.array(z.string()),
  importHeader: z.array(z.string()).nullable(),
});
export type ImportExportEntity = z.infer<typeof importExportEntitySchema>;

export const importExportEntitiesResponseSchema = z.object({
  data: z.object({ entities: z.array(importExportEntitySchema) }),
});
export type ImportExportEntitiesResponse = z.infer<typeof importExportEntitiesResponseSchema>;
