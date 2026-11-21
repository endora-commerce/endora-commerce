/**
 * The role editor's permission groups — issue #1521 (UX audit 2026-11-17, SHELL-13).
 *
 * Pure functions, so the grouping, the filter and the group selection are
 * pinned without rendering the screen. None of them changes what a role
 * grants: they decide what is shown and which checkboxes one click ticks.
 */
import { normalize } from '@endora-commerce/admin-kit/lib';

/** One row of `GET /api/v1/admin/permissions`. */
export interface RoleEditorPermissionRow {
  code: string;
  /** A display grouping, not an owner: `_lifecycle` files its codes under `module_lifecycle`. */
  module: string;
  label: string;
  owners: string[];
  requires?: string[];
}

export interface PermissionGroup {
  /** The grouping as the catalogue sends it. */
  module: string;
  /** The grouping's name in the operator's language. */
  label: string;
  /** The rows the filter leaves, in catalogue order. */
  rows: RoleEditorPermissionRow[];
}

export interface GroupPermissionsOptions {
  moduleLabel: (moduleId: string) => string;
  permissionLabel: (row: RoleEditorPermissionRow) => string;
  /** Matched against the permission's label, its code and its group's name. Empty shows everything. */
  filter: string;
}

/**
 * A grouping id as words, for a module whose bundle names it nowhere
 * (`module_lifecycle` → "Module lifecycle"). Better than the raw id, and never
 * empty.
 */
export function humanizeModuleId(moduleId: string): string {
  const words = moduleId.replace(/[_-]+/g, ' ').trim();
  if (words === '') return moduleId;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The catalogue grouped by module, named, filtered and sorted by the name the operator reads. */
export function groupPermissions(
  rows: readonly RoleEditorPermissionRow[],
  options: GroupPermissionsOptions,
): PermissionGroup[] {
  const needle = normalize(options.filter);
  const byModule = new Map<string, PermissionGroup>();
  for (const row of rows) {
    let group = byModule.get(row.module);
    if (!group) {
      group = { module: row.module, label: options.moduleLabel(row.module), rows: [] };
      byModule.set(row.module, group);
    }
    if (
      needle !== '' &&
      ![options.permissionLabel(row), row.code, group.label].some((text) => normalize(text).includes(needle))
    ) {
      continue;
    }
    group.rows.push(row);
  }
  return [...byModule.values()]
    .filter((group) => group.rows.length > 0)
    .sort((a, b) => a.label.localeCompare(b.label) || a.module.localeCompare(b.module));
}

export interface GroupSelection {
  selected: number;
  total: number;
  /** What the group's checkbox shows: unticked, mixed, ticked. */
  state: 'none' | 'some' | 'all';
}

/** How many of a group's codes the draft holds. */
export function groupSelection(codes: readonly string[], selected: ReadonlySet<string>): GroupSelection {
  const count = codes.filter((code) => selected.has(code)).length;
  const state = count === 0 ? 'none' : count === codes.length ? 'all' : 'some';
  return { selected: count, total: codes.length, state };
}

/**
 * The draft with every one of `codes` added or removed. Only those codes move:
 * a code the role holds that the catalogue does not offer (its module is off)
 * has no checkbox and survives, as it always has.
 */
export function setGroupSelection(selected: ReadonlySet<string>, codes: readonly string[], on: boolean): Set<string> {
  const next = new Set(selected);
  for (const code of codes) {
    if (on) next.add(code);
    else next.delete(code);
  }
  return next;
}
