import type { QuickOrderPreview } from './api/quick-order-preview';

/**
 * Feature 044 / US7 — pure summary helper for the mobile Quick Order view.
 *
 * The import preview carries no per-line price (the importer resolves products,
 * not pricing), so the mobile summary pills + sticky bar report recognised /
 * invalid line counts and total units rather than a monetary total. Kept in its
 * own module (no server-only imports) so it is unit-testable in the node test
 * environment without pulling in the auth-gated page.
 */
export function summarizeQuickOrderPreview(preview: {
  recognized: Array<{ quantity: number }>;
  rejected: Array<unknown>;
}): { recognised: number; invalid: number; units: number } {
  const units = preview.recognized.reduce(
    (sum, row) => sum + (Number.isFinite(row.quantity) ? row.quantity : 0),
    0,
  );
  return {
    recognised: preview.recognized.length,
    invalid: preview.rejected.length,
    units,
  };
}

/**
 * The import's response as a preview: its rows past the import's limit (`row_limit_exceeded`, one
 * per row) become one `summary.overflowCount` (PO ruling of 2026-11-08 on PR #942). The backend
 * does the same on write; doing it here keeps a large file's overflow out of the request body.
 */
export function previewOfImport(imported: QuickOrderPreview): QuickOrderPreview {
  const overflow = imported.rejected.filter((row) => row.reason === 'row_limit_exceeded').length;
  if (overflow === 0) return imported;
  const rejected = imported.rejected.filter((row) => row.reason !== 'row_limit_exceeded');
  return {
    ...imported,
    rejected,
    summary: {
      ...imported.summary,
      rejectedCount: rejected.length,
      truncated: true,
      overflowCount: (imported.summary.overflowCount ?? 0) + overflow,
    },
  };
}
