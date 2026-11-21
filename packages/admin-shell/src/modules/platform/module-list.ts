import { foldDiacritics, type ModuleListItem, type ModulePresence } from '@endora-commerce/contracts';
import type { AdminRegistryEntry } from '../../lib/module-registry/index.js';
import { resolveSectionKey } from '../../components/sidebar/nav-sections.js';

/**
 * The pure half of `/platform/modules` — issue #1520 (UX audit 2026-11-17,
 * SHELL-12): what a row is, which status filter it answers to, whether it
 * matches the search, and which navigation section it is listed under.
 *
 * Nothing here decides activation. The row's operator-axis rendering is still
 * `activationKindOf`, read off the presence projection exactly as before; the
 * filters and the grouping only choose which rows are on screen and in what
 * order (Constitution XVII: the semantics of the two axes are untouched).
 */

/** One table row: the platform record plus whatever the projection knows. */
export interface ModuleRow {
  item: ModuleListItem;
  presence: ModulePresence | undefined;
  /** Absent for a module that declares no recent-activity eligibility. */
  activityVisible: boolean | undefined;
}

export type ActivationKind = 'on' | 'off' | 'locked' | 'always-on' | 'unknown';

/**
 * Five operator-axis renderings, and the difference between `locked` and
 * `always-on` is the whole reason this is a function rather than a boolean.
 *
 * `deactivatable: false` **with** a reason is a module that declared itself
 * non-deactivatable — the platform's functional base, and the sentence is its
 * own. The same flag **without** one is a module that declares no activation
 * block at all, which since feature 074 means one thing only: it owns no seam
 * either presence axis could close, so there is nothing for a control to do.
 * Both are "you cannot switch this", and both render the locked affordance;
 * the difference is carried by the sentence rather than by a third visual
 * state.
 *
 * The selection is on the **absent declaration**, never on a module id. That is
 * what keeps this from being the hard-coded exception list Constitution XVII
 * prohibits. No module this repository ships is in that position any more
 * (`test/unit/_lifecycle/non-deactivatable-set.test.ts` pins the class as
 * empty), but this app renders whatever presence projection a deployment serves
 * it, and a module package from outside this repository can still arrive with
 * no activation block. A missing branch would offer an operator a control that
 * does nothing.
 *
 * `unknown` is not a decision: the presence projection carried no row for this
 * module, so this app knows nothing about its operator axis.
 */
export function activationKindOf(presence: ModulePresence | undefined): ActivationKind {
  if (!presence) return 'unknown';
  if (!presence.deactivatable) {
    return presence.nonDeactivatableReason ? 'locked' : 'always-on';
  }
  return presence.activated ? 'on' : 'off';
}

/** Whether the deployment offers this module at all. */
export function isPlatformAvailable(row: ModuleRow): boolean {
  const state = row.presence?.platformState ?? row.item.state;
  return state === 'installed';
}

/**
 * The four status filters the toolbar offers (On · Off · Not offered ·
 * Locked). Each row answers to at most one:
 *
 * - `not-offered` — the deployment does not install it. Checked first, because
 *   an operator-axis value on such a row is not the operator's to act on;
 * - `locked` — offered, and it cannot be switched off (a declared reason, or no
 *   activation declaration at all);
 * - `on` / `off` — offered, and the operator's switch says so.
 *
 * A row with no projection entry (`unknown`) answers to none: the screen does
 * not know its operator axis, so it is listed only while no filter is applied.
 */
export type ModuleStatusFilter = 'on' | 'off' | 'not-offered' | 'locked';

export const MODULE_STATUS_FILTERS: readonly ModuleStatusFilter[] = [
  'on',
  'off',
  'not-offered',
  'locked',
];

export function statusFilterOf(row: ModuleRow): ModuleStatusFilter | null {
  if (!isPlatformAvailable(row)) return 'not-offered';
  const kind = activationKindOf(row.presence);
  if (kind === 'locked' || kind === 'always-on') return 'locked';
  if (kind === 'on' || kind === 'off') return kind;
  return null;
}

/** How many rows answer to each status filter — the chips' counts. */
export function statusFilterCounts(
  rows: readonly ModuleRow[],
): Readonly<Record<ModuleStatusFilter, number>> {
  const counts: Record<ModuleStatusFilter, number> = {
    on: 0,
    off: 0,
    'not-offered': 0,
    locked: 0,
  };
  for (const row of rows) {
    const filter = statusFilterOf(row);
    if (filter) counts[filter] += 1;
  }
  return counts;
}

/** Lower case with the diacritics removed, so "Ksiegowosc" finds "Księgowość" (Postel). */
function fold(value: string): string {
  return foldDiacritics(value).toLowerCase();
}

/**
 * Whether the row matches the search: every whitespace-separated term occurs
 * in the module's name, id or description, case- and diacritics-insensitively.
 * An empty search matches everything.
 */
export function matchesModuleSearch(row: ModuleRow, query: string): boolean {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = fold(
    [row.item.name, row.item.id, row.item.description ?? ''].join(' '),
  );
  return terms.every((term) => haystack.includes(term));
}

/** The rows the search and the status filters leave. No filter pressed means every status. */
export function filterModuleRows(
  rows: readonly ModuleRow[],
  query: string,
  statuses: ReadonlySet<ModuleStatusFilter>,
): ModuleRow[] {
  return rows.filter((row) => {
    if (!matchesModuleSearch(row, query)) return false;
    if (statuses.size === 0) return true;
    const filter = statusFilterOf(row);
    return filter !== null && statuses.has(filter);
  });
}

/** A navigation section heading as the sidebar declares it. */
export interface ModuleSectionHeading {
  readonly key: string;
  readonly labelKey: string;
}

/** The group a module with no labelled menu entry is listed under; always last. */
export const OTHER_MODULES_GROUP = 'other';

/**
 * Which sidebar section each module is listed under: the first section, in
 * the sidebar's own order, that holds one of the module's menu entries. A
 * module with menu entries in two sections is listed once, where an operator
 * meets it first. The section comes from the module's own contributions, never
 * from a list of ids here, so a packaged module lands in its group unedited.
 *
 * A section with no heading (the unlabelled cluster at the top of the sidebar)
 * is not a group: its modules fall through to their next section or to
 * {@link OTHER_MODULES_GROUP}.
 */
export function moduleSectionsOf(
  entries: readonly AdminRegistryEntry[],
  headings: readonly ModuleSectionHeading[],
): ReadonlyMap<string, string> {
  const order = new Map<string, number>();
  headings.forEach((heading, index) => {
    if (heading.labelKey !== '') order.set(heading.key, index);
  });
  const best = new Map<string, number>();
  for (const entry of entries) {
    for (const item of entry.contributions.nav ?? []) {
      // A deprecated section key is read as the section that renders it
      // (issue #1519: `'system'` → *Platform*), so the module is listed where
      // the sidebar shows it.
      const index = order.get(resolveSectionKey(item.section));
      if (index === undefined) continue;
      const current = best.get(entry.moduleId);
      if (current === undefined || index < current) best.set(entry.moduleId, index);
    }
  }
  const sections = new Map<string, string>();
  for (const [moduleId, index] of best) sections.set(moduleId, headings[index]!.key);
  return sections;
}

export interface ModuleGroup {
  /** A section key, or {@link OTHER_MODULES_GROUP}. */
  readonly key: string;
  /** The heading's translation key in `core`. */
  readonly labelKey: string;
  readonly rows: readonly ModuleRow[];
}

/**
 * The rows grouped by sidebar section, in the sidebar's order, each group
 * sorted by module name; modules with no menu entry last, under "Other
 * modules". Empty groups are dropped, so a filter never leaves a bare heading.
 */
export function groupModuleRows(
  rows: readonly ModuleRow[],
  sections: ReadonlyMap<string, string>,
  headings: readonly ModuleSectionHeading[],
  otherLabelKey: string,
): ModuleGroup[] {
  const byKey = new Map<string, ModuleRow[]>();
  for (const row of rows) {
    const key = sections.get(row.item.id) ?? OTHER_MODULES_GROUP;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }
  const byName = (left: ModuleRow, right: ModuleRow): number =>
    left.item.name.localeCompare(right.item.name) || left.item.id.localeCompare(right.item.id);
  const groups: ModuleGroup[] = [];
  for (const heading of headings) {
    const list = byKey.get(heading.key);
    if (heading.labelKey === '' || !list) continue;
    groups.push({ key: heading.key, labelKey: heading.labelKey, rows: [...list].sort(byName) });
  }
  const other = byKey.get(OTHER_MODULES_GROUP);
  if (other) {
    groups.push({ key: OTHER_MODULES_GROUP, labelKey: otherLabelKey, rows: [...other].sort(byName) });
  }
  return groups;
}
