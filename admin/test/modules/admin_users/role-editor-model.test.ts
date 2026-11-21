import { describe, expect, it } from 'vitest';
import {
  groupPermissions,
  groupSelection,
  humanizeModuleId,
  setGroupSelection,
  type RoleEditorPermissionRow,
} from '../../../../packages/modules/admin_users/src/admin/role-editor-model';

/**
 * Issue #1521 (UX audit SHELL-13) — the role editor's permission groups, as
 * pure functions: grouped under the module's name rather than its id, filtered
 * by label, code or module name, counted per group, and selected or cleared a
 * group at a time without touching a code the catalogue does not offer.
 */
const ROWS: RoleEditorPermissionRow[] = [
  { code: 'orders:read', module: 'orders', label: 'Read orders', owners: ['orders'] },
  { code: 'orders:write', module: 'orders', label: 'Write orders', owners: ['orders'] },
  { code: 'catalog:read', module: 'catalog', label: 'View catalog', owners: ['catalog'] },
  { code: 'modules:manage', module: 'module_lifecycle', label: 'Switch modules', owners: ['_lifecycle'] },
];

const NAMES: Record<string, string> = { orders: 'Zamówienia', catalog: 'Katalog' };
const moduleLabel = (id: string): string => NAMES[id] ?? humanizeModuleId(id);
const permissionLabel = (row: RoleEditorPermissionRow): string => row.label;

describe('humanizeModuleId', () => {
  it('turns an id with no translated name into words', () => {
    expect(humanizeModuleId('module_lifecycle')).toBe('Module lifecycle');
    expect(humanizeModuleId('_i18n')).toBe('I18n');
    expect(humanizeModuleId('quote_requests')).toBe('Quote requests');
  });
});

describe('groupPermissions', () => {
  it('groups by module, names each group and sorts by that name', () => {
    const groups = groupPermissions(ROWS, { moduleLabel, permissionLabel, filter: '' });
    expect(groups.map((g) => [g.module, g.label])).toEqual([
      ['catalog', 'Katalog'],
      ['module_lifecycle', 'Module lifecycle'],
      ['orders', 'Zamówienia'],
    ]);
    expect(groups[2]!.rows.map((r) => r.code)).toEqual(['orders:read', 'orders:write']);
  });

  it('filters by label, by code and by module name, ignoring case and diacritics', () => {
    const codes = (filter: string): string[] =>
      groupPermissions(ROWS, { moduleLabel, permissionLabel, filter }).flatMap((g) => g.rows.map((r) => r.code));
    expect(codes('WRITE')).toEqual(['orders:write']);
    expect(codes('catalog:r')).toEqual(['catalog:read']);
    expect(codes('zamowienia')).toEqual(['orders:read', 'orders:write']);
    expect(codes('nothing matches')).toEqual([]);
  });
});

describe('groupSelection', () => {
  const codes = ['orders:read', 'orders:write'];

  it('counts what is selected and says none, some or all', () => {
    expect(groupSelection(codes, new Set())).toEqual({ selected: 0, total: 2, state: 'none' });
    expect(groupSelection(codes, new Set(['orders:read']))).toEqual({ selected: 1, total: 2, state: 'some' });
    expect(groupSelection(codes, new Set(codes))).toEqual({ selected: 2, total: 2, state: 'all' });
  });
});

describe('setGroupSelection', () => {
  it('adds or removes only the group codes, keeping codes the catalogue does not offer', () => {
    // `blog.read` belongs to a module that is off: no checkbox, so it must survive the round trip.
    const selected = new Set(['blog.read', 'orders:read', 'catalog:read']);
    expect([...setGroupSelection(selected, ['orders:read', 'orders:write'], true)].sort()).toEqual([
      'blog.read',
      'catalog:read',
      'orders:read',
      'orders:write',
    ]);
    expect([...setGroupSelection(selected, ['orders:read', 'orders:write'], false)].sort()).toEqual([
      'blog.read',
      'catalog:read',
    ]);
    // The input is not mutated.
    expect(selected.size).toBe(3);
  });
});
