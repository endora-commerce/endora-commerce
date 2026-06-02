/*
 * Dynamic/computed styling helpers for the CMS Page Builder components.
 *
 * Static styling (the former `baseFont` / `editorFrame` / `emptyEmbed`
 * `CSSProperties` constants) was migrated to `cmsc:`-prefixed Tailwind
 * utilities in markup (feature 041, see `styles/cms-components.css`). Only
 * genuinely computed helpers — which produce author-driven values that no
 * utility class can express — remain here.
 */

export function clampColumnCount(columns: number): number {
  if (!Number.isFinite(columns)) return 2;
  return Math.min(6, Math.max(1, Math.round(columns)));
}

export function parseWidths(widths: string, columns: number): string[] {
  const parts = widths
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === columns && parts.every((part) => /^\d+(\.\d+)?%$/.test(part))) {
    return parts;
  }

  return Array.from({ length: columns }, () => `${100 / columns}%`);
}
