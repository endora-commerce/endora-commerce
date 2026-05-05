import type { CSSProperties } from 'react';

export const baseFont: CSSProperties = {
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

export const editorFrame: CSSProperties = {
  ...baseFont,
  border: '1px solid #d9e0e7',
  borderRadius: 8,
  padding: 12,
  background: '#ffffff',
};

export const emptyEmbed: CSSProperties = {
  ...baseFont,
  border: '1px dashed #9aa7b4',
  borderRadius: 8,
  padding: 16,
  color: '#5f6b7a',
  background: '#f8fafc',
  fontSize: 14,
};

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
