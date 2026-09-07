import type { LucideIcon } from 'lucide-react';
import { resolveIcon } from '../../lib/admin-actions/icon-map.js';

/**
 * Feature 024, rewritten by feature 080's T042j (D-163.1).
 *
 * **This file used to be one of the four hand-maintained action tables.**
 * `ACTIVITY_RENDERING` was a 22-entry map from an audit token to a lucide
 * import and an i18n key under the `core` scope, and it was the fourth copy of
 * a list the server kept three of. Two consequences, both measured rather than
 * predicted:
 *
 *  - `prompt_action.execute` was in the server's allow-list and its prefix map
 *    and absent from here, so every prompt-assistant row on the dashboard drew
 *    the unknown-verb fallback — for as long as feature 043 had shipped;
 *  - a module the SPA was not built with could not be in it at all, so a
 *    packaged module's row was unrenderable even once the server learned to
 *    return it.
 *
 * The rendering now travels **on the item**: the server reads the declaring
 * module's `recentActivity` manifest export and puts its `icon` and its
 * module-namespace-relative `labelKey` on every row. So the icon comes from the
 * one `icon-map.ts` this app already has — a closed allowlist a package cannot
 * escape — and the verb is resolved in the declaring module's own i18n
 * namespace, which is where a package ships its translations.
 *
 * There is nothing left here to add an entry to, which is the point.
 */

export interface ActivityRendering {
  icon: LucideIcon;
  /** Scope for the verb lookup: the declaring module's i18n namespace. */
  scope: string;
  /** Key within that scope, e.g. `activity.verb.product.create`. */
  verbKey: string;
}

/**
 * The one rendering this app still owns: a row whose declaration it could not
 * read.
 *
 * It is reachable only across a version skew — a server that stopped declaring
 * a token between the fetch and the render — and it is kept because a card that
 * throws on one unknown row is worse than one that says less about it. The verb
 * is `core`'s, because there is no module to ask.
 */
export const UNKNOWN_RENDERING: ActivityRendering = {
  icon: resolveIcon('Activity'),
  scope: 'core',
  verbKey: 'home.activity.verb.unknown',
};

/** What the server said to render for this row. */
export interface ActivityRenderingSource {
  module: string;
  icon: string;
  labelKey: string;
}

/**
 * Resolve the icon + the (scope, key) pair for one row.
 *
 * `resolveIcon` already falls back to a generic glyph for a name this build
 * does not know, so an icon is never a reason to drop a row. A missing
 * `labelKey` or `module` is: without either there is nothing to look the verb
 * up under, and the placeholder the i18n resolver would render
 * (`.` + an empty key) is worse than the honest fallback.
 */
export function renderActivity(row: ActivityRenderingSource): ActivityRendering {
  if (!row.labelKey || !row.module) return UNKNOWN_RENDERING;
  return { icon: resolveIcon(row.icon), scope: row.module, verbKey: row.labelKey };
}

/**
 * Pure formatter — relative-time pill for an ISO 8601 timestamp.
 * Returns the i18n key + interpolation params for the caller's `t(...)`.
 * Separated from the component so it is unit-testable without a DOM.
 */
export function formatRelative(actedAtIso: string, now = Date.now()): {
  key: string;
  params?: Record<string, string | number>;
} {
  const acted = Date.parse(actedAtIso);
  if (!Number.isFinite(acted)) return { key: 'home.activity.time.justNow' };
  const deltaMs = Math.max(0, now - acted);
  if (deltaMs < 60_000) return { key: 'home.activity.time.justNow' };
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return { key: 'home.activity.time.minutesAgo', params: { count: minutes } };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: 'home.activity.time.hoursAgo', params: { count: hours } };
  const days = Math.floor(hours / 24);
  if (days === 1) return { key: 'home.activity.time.yesterday' };
  return { key: 'home.activity.time.daysAgo', params: { count: days } };
}
