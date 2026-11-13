/** The part of a per-product bulk result these rules read. */
export interface BulkResultOutcome {
  readonly status: 'succeeded' | 'skipped' | 'failed';
  readonly changedFields?: readonly string[] | undefined;
}

/**
 * A product already in the requested state succeeds with nothing changed — the API keeps
 * it `succeeded` (feature 163, O-6), and the admin names it "Unchanged". The one rule the
 * bulk edit dialog's summary and the bulk operation detail page both read (issue #501).
 */
export function isUnchangedResult(result: BulkResultOutcome): boolean {
  return result.status === 'succeeded' && (result.changedFields?.length ?? 0) === 0;
}

/** How many of the results changed nothing; a subset of the succeeded count, never apart from it. */
export function unchangedResultCount(results: readonly BulkResultOutcome[]): number {
  return results.filter(isUnchangedResult).length;
}
