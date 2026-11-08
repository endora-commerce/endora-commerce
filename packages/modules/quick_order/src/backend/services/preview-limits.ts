import type { QuickOrderPreview } from '@endora-commerce/contracts';

/**
 * The preview's line rules (issue #809; PO ruling of 2026-11-08 on PR #942).
 *
 * The cap is the effective `quick_order.import_max_rows`, read when the preview is written, and it
 * counts only the rows the import read. The rows past the import's limit (`row_limit_exceeded`,
 * one per row from `import-pipeline.ts`) are not kept row by row: they become one
 * `summary.overflowCount`, with the limit they were past, so a 10 000-row file over a 2 000-row
 * limit neither fills Redis with identical rows nor counts against the cap.
 */

const OVERFLOW = 'row_limit_exceeded';

/** The preview with its rows past the import's limit kept as one count beside `rowLimit`. */
export function collapseOverflow(preview: QuickOrderPreview, rowLimit: number): QuickOrderPreview {
  const overflow = preview.rejected.filter((row) => row.reason === OVERFLOW).length;
  if (overflow === 0) return preview;
  const rejected = preview.rejected.filter((row) => row.reason !== OVERFLOW);
  return {
    ...preview,
    rejected,
    summary: {
      ...preview.summary,
      rejectedCount: rejected.length,
      truncated: true,
      overflowCount: (preview.summary.overflowCount ?? 0) + overflow,
      rowLimit: preview.summary.rowLimit ?? rowLimit,
    },
  };
}

/** The lines the cap counts: recognised and rejected rows the import read, never the overflow. */
export function previewLineCount(preview: QuickOrderPreview): number {
  return preview.recognized.length + preview.rejected.filter((row) => row.reason !== OVERFLOW).length;
}

/**
 * Whether a write is refused: it is over the cap **and** it grew. A write that adds no line — an
 * edit, a removal, a build's remainder — is accepted above a cap lowered since it was stored.
 */
export function refusesGrowth(input: { lines: number; previousLines: number; cap: number }): boolean {
  return input.lines > input.cap && input.lines > input.previousLines;
}
