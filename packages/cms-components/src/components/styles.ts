/*
 * Dynamic/computed styling helpers for the CMS Page Builder components.
 */

export function clampColumnCount(columns: number): number {
  if (!Number.isFinite(columns)) return 2;
  return Math.min(12, Math.max(1, Math.round(columns)));
}
