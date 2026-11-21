import type { NavItem } from './nav-types.js';

/**
 * Section keys the shell no longer declares, and the section that takes their
 * rows — issue #1519 (UX audit SHELL-11, owner decision DEC-02), which split
 * *System* into *Access* and *Platform*.
 *
 * **Contributions.** `'system'` stays a member of `AdminNavSectionNameSchema`,
 * deprecated, so a separately shipped module still declaring it keeps a row
 * rather than failing `composeNav`'s undeclared-section refusal. Its rows are
 * filed under *Platform*, the section every former System row that is not about
 * access now lives in.
 */
export const SECTION_ALIASES: Readonly<Record<string, string>> = { system: 'platform' };

/**
 * What a retired section's collapse key became — the sections that inherit its
 * collapsed state.
 *
 * `sidebarCollapsedGroups` is keyed by section key, so an admin who had folded
 * *System* would otherwise find both of its successors open after the split.
 * The stored value is not rewritten here — it is reinterpreted when read, and
 * dropped the next time the admin toggles a group (`toggleCollapsedGroup`).
 */
export const COLLAPSE_SUCCESSORS: Readonly<Record<string, readonly string[]>> = {
  system: ['access', 'platform'],
};

/** The section a contribution declaring `section` renders in. */
export function resolveSectionKey(section: string): string {
  return SECTION_ALIASES[section] ?? section;
}

/** The stored collapsed keys, with every retired key replaced by its successors. */
export function migrateCollapsedGroups(stored: readonly string[]): string[] {
  const out: string[] = [];
  for (const key of stored) {
    for (const next of COLLAPSE_SUCCESSORS[key] ?? [key]) {
      if (!out.includes(next)) out.push(next);
    }
  }
  return out;
}

/**
 * The collapsed keys after the admin toggles `key`, starting from the stored
 * value — migrated first, so a retired key is written back as its successors
 * and never again as itself.
 */
export function toggleCollapsedGroup(stored: readonly string[], key: string): string[] {
  const current = migrateCollapsedGroups(stored);
  return current.includes(key) ? current.filter((group) => group !== key) : [...current, key];
}

/**
 * A section's rows in render order: the host's unweighted rows first, as they
 * always were, then the weighted host rows and the contributions together by
 * weight. The sort is stable, so equal weights keep host-before-contribution and
 * the contributions' own weight-then-module-id order.
 */
export function orderSectionItems(
  hostItems: readonly NavItem[],
  contributed: readonly (NavItem & { weight: number })[],
): NavItem[] {
  const leading = hostItems.filter((item) => item.weight === undefined);
  const weighted = [
    ...hostItems.filter((item): item is NavItem & { weight: number } => item.weight !== undefined),
    ...contributed,
  ];
  return [...leading, ...weighted.sort((left, right) => left.weight - right.weight)];
}
