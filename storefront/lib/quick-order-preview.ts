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
