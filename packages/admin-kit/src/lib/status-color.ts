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

function linearChannel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rrggbb` colour. */
function relativeLuminance(hex: string): number {
  const int = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * linearChannel((int >> 16) & 0xff) +
    0.7152 * linearChannel((int >> 8) & 0xff) +
    0.0722 * linearChannel(int & 0xff)
  );
}

/**
 * Black or white text for a given background hex — whichever of the two has
 * the higher WCAG contrast against it.
 *
 * Chosen by contrast ratio and not by a brightness threshold, because the
 * threshold put white text on the mid-tones an operator actually picks for a
 * status — amber, green, blue — at 2:1 to 3.7:1. The dark side is pure black
 * for the same reason: against the better of black and white every colour
 * reaches 4.58:1 (SC 1.4.3 asks for 4.5:1), and against any softer dark the
 * mid-tones do not.
 */
export function readableTextColor(hex: string): string {
  const luminance = relativeLuminance(normalizeHex(hex));
  const onWhite = 1.05 / (luminance + 0.05);
  const onBlack = (luminance + 0.05) / 0.05;
  return onBlack > onWhite ? '#000000' : '#ffffff';
}

/** Inline style for a status badge: solid background + auto-contrast text. */
export function statusBadgeStyle(color: string | null | undefined): CSSProperties {
  const hex = normalizeHex(color);
  return { backgroundColor: hex, color: readableTextColor(hex), borderColor: 'transparent' };
}
