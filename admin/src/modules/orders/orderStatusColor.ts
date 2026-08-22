import type { CSSProperties } from 'react';
import { ORDER_STATUS_COLOR_PRESETS, ORDER_STATUS_DEFAULT_COLOR } from '@endora-commerce/contracts';

const HEX = /^#[0-9a-fA-F]{6}$/;

function normalizeHex(color: string | null | undefined): string {
  return color && HEX.test(color.trim()) ? color.trim() : ORDER_STATUS_DEFAULT_COLOR;
}

/**
 * Black or white text for a given background hex, chosen by perceived
 * luminance so the status label stays legible on any picked colour.
 */
export function readableTextColor(hex: string): string {
  const value = normalizeHex(hex).slice(1);
  const int = Number.parseInt(value, 16);
  const r = (int >> 16) & 0xff;
  const g = (int >> 8) & 0xff;
  const b = int & 0xff;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1f2937' : '#ffffff';
}

/** Inline style for a status badge: solid background + auto-contrast text. */
export function orderStatusBadgeStyle(color: string | null | undefined): CSSProperties {
  const hex = normalizeHex(color);
  return { backgroundColor: hex, color: readableTextColor(hex), borderColor: 'transparent' };
}

export { ORDER_STATUS_COLOR_PRESETS, ORDER_STATUS_DEFAULT_COLOR };
