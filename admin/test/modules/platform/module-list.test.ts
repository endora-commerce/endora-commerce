import { describe, expect, it } from 'vitest';
import type { ModuleListItem, ModulePresence } from '@endora-commerce/contracts';
import {
  filterModuleRows,
  groupModuleRows,
  matchesModuleSearch,
  moduleSectionsOf,
  statusFilterCounts,
  statusFilterOf,
  type ModuleRow,
  type ModuleStatusFilter,
} from '../../../../packages/admin-shell/src/modules/platform/module-list';

/**
 * Issue #1520 (UX audit SHELL-12) — the pure half of the Modules screen's
 * search, status filters and grouping. None of it decides activation; these
 * tests pin which rows are on screen and where.
 */

function row(
  id: string,
  patch: { item?: Partial<ModuleListItem>; presence?: Partial<ModulePresence> | null } = {},
): ModuleRow {
  const item: ModuleListItem = {
    id,
    name: id,
    description: null,
    version: { registered: '1.0.0', onDisk: '1.0.0' },
    state: 'installed',
    dependencies: [],
    flags: [],
    installedAt: null,
    lastStateChangeAt: null,
    ...patch.item,
  };
  const presence: ModulePresence | undefined =
    patch.presence === null
      ? undefined
      : {
          id,
          present: true,
          platformState: 'installed',
          activated: true,
          deactivatable: true,
          nonDeactivatableReason: null,
          ...patch.presence,
        };
  return { item, presence, activityVisible: undefined };
}

const on = row('blog', { item: { name: 'Blog' } });
const off = row('newsletter', { item: { name: 'Newsletter' }, presence: { activated: false, present: false } });
const notOffered = row('ksef', {
  item: { name: 'KSeF', state: 'not-installed' },
  presence: { platformState: 'not-installed', present: false },
});
const locked = row('auth', {
  item: { name: 'Authentication' },
  presence: { deactivatable: false, nonDeactivatableReason: 'Nobody could sign in.' },
});
const alwaysOn = row('probe', { presence: { deactivatable: false, nonDeactivatableReason: null } });
const unknown = row('mystery', { presence: null });

describe('statusFilterOf — each row answers to at most one chip', () => {
  it('maps the operator axis and the platform axis to On · Off · Not offered · Locked', () => {
    expect(statusFilterOf(on)).toBe('on');
    expect(statusFilterOf(off)).toBe('off');
    expect(statusFilterOf(notOffered)).toBe('not-offered');
    expect(statusFilterOf(locked)).toBe('locked');
    // A module with no activation declaration cannot be switched either.
    expect(statusFilterOf(alwaysOn)).toBe('locked');
    expect(statusFilterOf(unknown)).toBeNull();
  });

  it('reads "not offered" before the operator axis, which is not the operator\'s there', () => {
    const offButUninstalled = row('x', {
      item: { state: 'not-installed' },
      presence: { platformState: 'not-installed', activated: false, present: false },
    });
    expect(statusFilterOf(offButUninstalled)).toBe('not-offered');
  });

  it('counts the rows per chip', () => {
    expect(statusFilterCounts([on, off, notOffered, locked, alwaysOn, unknown])).toEqual({
      on: 1,
      off: 1,
      'not-offered': 1,
      locked: 2,
    });
  });
});

describe('matchesModuleSearch — liberal in what it accepts (Postel)', () => {
  const accounting = row('accounting_export', {
    item: { name: 'Księgowość', description: 'Exports invoices to the ledger.' },
  });

  it('matches the name, the id and the description, case-insensitively', () => {
    expect(matchesModuleSearch(accounting, 'KSIĘG')).toBe(true);
    expect(matchesModuleSearch(accounting, 'accounting_exp')).toBe(true);
    expect(matchesModuleSearch(accounting, 'ledger')).toBe(true);
    expect(matchesModuleSearch(accounting, 'stock')).toBe(false);
  });

  it('ignores diacritics and needs every term', () => {
    expect(matchesModuleSearch(accounting, 'ksiegowosc')).toBe(true);
    expect(matchesModuleSearch(accounting, '  ksiegowosc   ledger ')).toBe(true);
    expect(matchesModuleSearch(accounting, 'ksiegowosc stock')).toBe(false);
    expect(matchesModuleSearch(accounting, '   ')).toBe(true);
  });
});

describe('filterModuleRows', () => {
  const rows = [on, off, notOffered, locked, unknown];

  it('keeps every row while nothing is pressed', () => {
    expect(filterModuleRows(rows, '', new Set())).toHaveLength(5);
  });

  it('keeps the union of the pressed chips, and drops a row with no known status', () => {
    const pressed = new Set<ModuleStatusFilter>(['off', 'locked']);
    expect(filterModuleRows(rows, '', pressed).map((r) => r.item.id)).toEqual(['newsletter', 'auth']);
  });

  it('applies the search and the chips together', () => {
    expect(filterModuleRows(rows, 'blog', new Set(['off']))).toEqual([]);
    expect(filterModuleRows(rows, 'blog', new Set(['on']))).toEqual([on]);
  });
});

describe('moduleSectionsOf / groupModuleRows — grouped by the sidebar section', () => {
  const headings = [
    { key: 'main', labelKey: '' },
    { key: 'sales', labelKey: 'appShell.section.sales' },
    { key: 'catalog', labelKey: 'appShell.section.catalog' },
    { key: 'system', labelKey: 'appShell.section.system' },
  ];
  const nav = (section: string) => ({ section, to: '/x', labelKey: 'x', icon: 'Box', weight: 100 });
  const entries = [
    { moduleId: 'orders', contributions: { nav: [nav('sales')] } },
    // Two sections: listed where an operator meets it first.
    { moduleId: 'catalog', contributions: { nav: [nav('system'), nav('catalog')] } },
    // Only the unlabelled top cluster: not a group of its own.
    { moduleId: 'dashboard_widgets', contributions: { nav: [nav('main')] } },
    { moduleId: 'webhooks', contributions: {} },
  ] as never;

  it('takes the first section in the sidebar order that holds one of the module\'s entries', () => {
    const sections = moduleSectionsOf(entries, headings);
    expect(sections.get('orders')).toBe('sales');
    expect(sections.get('catalog')).toBe('catalog');
    expect(sections.has('dashboard_widgets')).toBe(false);
    expect(sections.has('webhooks')).toBe(false);
  });

  it('orders the groups as the sidebar does, the rows by name, and "Other" last; empty groups are dropped', () => {
    const sections = moduleSectionsOf(entries, headings);
    const rows = [
      row('webhooks', { item: { name: 'Webhooks' } }),
      row('catalog', { item: { name: 'Catalog' } }),
      row('orders', { item: { name: 'Orders' } }),
      row('dashboard_widgets', { item: { name: 'Dashboard widgets' } }),
    ];
    const groups = groupModuleRows(rows, sections, headings, 'platform.modules.group.other');
    expect(groups.map((g) => [g.key, g.labelKey, g.rows.map((r) => r.item.id)])).toEqual([
      ['sales', 'appShell.section.sales', ['orders']],
      ['catalog', 'appShell.section.catalog', ['catalog']],
      ['other', 'platform.modules.group.other', ['dashboard_widgets', 'webhooks']],
    ]);
  });
});
