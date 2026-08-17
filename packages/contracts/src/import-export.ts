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
