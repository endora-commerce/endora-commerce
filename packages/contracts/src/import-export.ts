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
import { isoDateTimeSchema, uuidSchema } from './common.js';
import { pimLocaleMappingEntrySchema, pimLocaleTagSchema, sameSourceLocale } from './pim-locale-mapping.js';

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
  /**
   * Feature 168 (`contracts/import-profiles-and-csv.md` §2.3) — products imports only: the
   * per-column count of `NULL` and `INHERIT` cells (shown before "Apply" after a dry run), the
   * run warnings (unmapped source locales, FR-041) and the per-row field errors (refusals of the
   * write encoding; the row's other fields apply).
   */
  cellCounts?: Array<{ column: string; null: number; inherit: number }>;
  warnings?: Array<{ kind: 'unmapped_locale'; locale: string; sourceChannel: string | null; products: number }>;
  fieldErrors?: Array<{ index: number; column: string; code: string }>;
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
 *
 * The list is also **caller-derived**: each entity is gated by the code that
 * protects its rows on the owning module's own routes, and an entity appears
 * only when the caller may export or import it. `canExport` and `canImport`
 * say which — an entity whose import is supported but not permitted carries
 * its `importHeader` and `canImport: false`, which is a different fact from an
 * import that does not exist.
 */
export const importExportEntitySchema = z.object({
  name: z.string(),
  exportHeader: z.array(z.string()),
  importHeader: z.array(z.string()).nullable(),
  canExport: z.boolean(),
  canImport: z.boolean(),
});
export type ImportExportEntity = z.infer<typeof importExportEntitySchema>;

export const importExportEntitiesResponseSchema = z.object({
  data: z.object({ entities: z.array(importExportEntitySchema) }),
});
export type ImportExportEntitiesResponse = z.infer<typeof importExportEntitiesResponseSchema>;

// --- Import profiles (feature 168, `contracts/import-profiles-and-csv.md` §1, data-model §11) ---

/** The most mapping entries one import profile holds, and targets per entry (data-model §11). */
export const IMPORT_PROFILE_ENTRIES_MAX = 100;
export const IMPORT_PROFILE_TARGETS_MAX = 16;

/** The only entity with a locale mapping in 168. */
export const importProfileEntitySchema = z.enum(['products']);

const importProfileMappingSchema = z
  .array(pimLocaleMappingEntrySchema.refine((entry) => entry.targets.length <= IMPORT_PROFILE_TARGETS_MAX, {
    message: `At most ${IMPORT_PROFILE_TARGETS_MAX} targets per entry.`,
  }))
  .max(IMPORT_PROFILE_ENTRIES_MAX)
  .refine(
    (entries) =>
      entries.every(
        (entry, index) =>
          !entries.some(
            (other, j) =>
              j < index && other.sourceChannel === entry.sourceChannel && sameSourceLocale(other.sourceLocale, entry.sourceLocale),
          ),
      ),
    { message: 'Two entries map the same source locale and source channel.' },
  );

export const importProfileSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(120),
  entity: importProfileEntitySchema,
  /** The source locale written to Global (FR-047); `null` = none. */
  sourceLanguageForGlobal: pimLocaleTagSchema.nullable(),
  localeMapping: importProfileMappingSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ImportProfile = z.infer<typeof importProfileSchema>;

export const createImportProfileRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    entity: importProfileEntitySchema,
    sourceLanguageForGlobal: pimLocaleTagSchema.nullable(),
    localeMapping: importProfileMappingSchema,
  })
  .strict();
export type CreateImportProfileRequest = z.infer<typeof createImportProfileRequestSchema>;

export const updateImportProfileRequestSchema = createImportProfileRequestSchema.partial().strict();
export type UpdateImportProfileRequest = z.infer<typeof updateImportProfileRequestSchema>;

export const importProfileResponseSchema = z.object({ data: importProfileSchema });
export const importProfileListResponseSchema = z.object({ data: z.array(importProfileSchema) });
export type ImportProfileListResponse = z.infer<typeof importProfileListResponseSchema>;

/** `GET …/profiles` query. */
export const importProfileListQuerySchema = z.object({ entity: importProfileEntitySchema.optional() }).strict();

/** `POST /api/v1/admin/import/products` query — the profile is required for products (FR-048). */
export const productsImportQuerySchema = z
  .object({ profileId: uuidSchema.optional(), dryRun: z.enum(['true', 'false']).optional() })
  .strict();

/** `404 IMPORT_PROFILE_NOT_FOUND` / `409 IMPORT_PROFILE_NAME_TAKEN` details. */
export const importProfileNotFoundDetailsSchema = z.object({ profileId: uuidSchema });
export const importProfileNameTakenDetailsSchema = z.object({ name: z.string() });
