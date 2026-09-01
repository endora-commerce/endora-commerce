/**
 * A status badge's colours, computed from the hex an operator picked (feature
 * 091, batch 8).
 *
 * Published out of `admin/src/modules/orders/orderStatusColor.ts`, which
 * `returns` imported for the return workflow's own status badges —
 * `backend/scripts/ledgers/cross-module-imports/returns.ts` recorded the reach
 * and its retiring condition offered two exits, of which this is the first:
 * *"the helper is generic and moves into the kit"*. It is: two pure functions
 * over a hex string, with no `orders` vocabulary and no request.
 *
 * **Renamed, and the rename is the point.** `orderStatusBadgeStyle` in the kit
 * would be a kit symbol named after a module, which is R6's rule wearing a
 * different hat — `returns` calls it about return statuses and `orders` about
 * order statuses, and the function cannot tell. The old spelling survives at
 * the old path as a re-export shim, so `orders`' own four call sites are
 * unchanged.
 *
 * `ORDER_STATUS_DEFAULT_COLOR` stays `@endora-commerce/contracts`' and is
 * imported from there rather than re-exported here: it is the platform's
 * fallback for an unset colour, both callers already compile that package, and
 * a second name for one constant is two things that can disagree.
 */
import type { CSSProperties } from 'react';
import { ORDER_STATUS_DEFAULT_COLOR } from '@endora-commerce/contracts';

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
export function statusBadgeStyle(color: string | null | undefined): CSSProperties {
  const hex = normalizeHex(color);
  return { backgroundColor: hex, color: readableTextColor(hex), borderColor: 'transparent' };
}
