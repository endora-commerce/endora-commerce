import { describe, expect, it } from 'vitest';
import {
  OrganizationRoleCatalogue,
  effectiveCodes,
  grantedCodes,
  mergeSubmittedPermissions,
  unknownCodes,
  type OrganizationPermissionManifestEntry,
} from './organization-role-catalogue.js';

/**
 * The organization-permission catalogue and the role arithmetic over it
 * (`specs/170-organization-roles/` WP-02a, T025; data-model §1 and §6; research
 * R-3, R-17; FR-002, FR-007, FR-023, FR-025, US 8).
 *
 * Pure: the manifests and the presence predicate are injected, so the rules are
 * read here without a container. Presence is asked per call, which is what lets
 * a module flip need no cache drop (US 8, SC-007).
 */

const declare = (code: string, memberDefault: boolean) => ({
  code,
  label: `Label of ${code}`,
  description: `Description of ${code}.`,
  memberDefault,
});

const MANIFESTS: OrganizationPermissionManifestEntry[] = [
  {
    manifest: {
      id: 'carts',
      name: 'Carts',
      organizationPermissions: [declare('carts.create', true), declare('carts.approve', false)],
    },
  },
  {
    manifest: {
      id: 'quick_order',
      name: 'Quick order',
      organizationPermissions: [declare('quick_order.one_click', true)],
    },
  },
  {
    manifest: {
      id: 'orders',
      name: 'Orders',
      organizationPermissions: [declare('orders.view_organization', false)],
    },
  },
  { manifest: { id: 'blog', name: 'Blog' } },
];

function catalogue(present: Set<string>, manifests = MANIFESTS): OrganizationRoleCatalogue {
  return new OrganizationRoleCatalogue({
    manifests: () => manifests,
    isModulePresent: (moduleId) => present.has(moduleId),
  });
}

describe('OrganizationRoleCatalogue', () => {
  it('reads the vocabulary from every composed manifest, present or not', () => {
    const c = catalogue(new Set(['carts']));
    expect([...c.vocabulary()].sort()).toEqual([
      'carts.approve',
      'carts.create',
      'orders.view_organization',
      'quick_order.one_click',
    ]);
    expect(c.isKnown('orders.view_organization')).toBe(true);
    expect(c.isKnown('orders.nothing')).toBe(false);
    expect(c.declarationOf('carts.create')).toMatchObject({ moduleId: 'carts', moduleName: 'Carts', memberDefault: true });
  });

  it('answers the present codes from the presence predicate, on every call', () => {
    const present = new Set(['carts', 'orders']);
    const c = catalogue(present);
    expect(c.presentCodes()).toEqual(['carts.approve', 'carts.create', 'orders.view_organization']);
    expect(c.isPresent('quick_order.one_click')).toBe(false);

    present.delete('orders');
    present.add('quick_order');
    expect(c.presentCodes()).toEqual(['carts.approve', 'carts.create', 'quick_order.one_click']);
    expect(c.isPresent('quick_order.one_click')).toBe(true);
    expect(c.isPresent('orders.view_organization')).toBe(false);
  });

  it('knows the member-default codes of the vocabulary, present or not (FR-021)', () => {
    const c = catalogue(new Set(['carts']));
    expect([...c.memberDefaults()].sort()).toEqual(['carts.create', 'quick_order.one_click']);
  });

  it('reports a code outside the vocabulary', () => {
    const c = catalogue(new Set(['carts']));
    expect(unknownCodes(['carts.create', 'carts.nothing', 'catalog:read'], c)).toEqual(['carts.nothing', 'catalog:read']);
  });
});

describe('effective permissions per role kind (FR-002, FR-007, R-3, R-17)', () => {
  const all = new Set(['carts', 'quick_order', 'orders']);

  it('administrator: every present code, with nothing stored', () => {
    const present = new Set(['carts', 'orders']);
    const c = catalogue(present);
    const admin = { kind: 'administrator' as const, permissions: [], memberDefaultsOffered: [] };
    expect(effectiveCodes(admin, c)).toEqual(['carts.approve', 'carts.create', 'orders.view_organization']);
    // A newly present module's code is held without a migration.
    present.add('quick_order');
    expect(effectiveCodes(admin, c)).toContain('quick_order.one_click');
  });

  it('member: stored grants plus every member default not yet offered, intersected with presence', () => {
    const c = catalogue(all);
    expect(effectiveCodes({ kind: 'member', permissions: [], memberDefaultsOffered: [] }, c)).toEqual([
      'carts.create',
      'quick_order.one_click',
    ]);
    // FR-071's marker: the approval Organization's Member was "offered" the two codes.
    expect(
      effectiveCodes(
        { kind: 'member', permissions: [], memberDefaultsOffered: ['quick_order.one_click', 'carts.order_without_approval'] },
        c,
      ),
    ).toEqual(['carts.create']);
    expect(
      effectiveCodes(
        { kind: 'member', permissions: ['orders.view_organization'], memberDefaultsOffered: ['carts.create', 'quick_order.one_click'] },
        c,
      ),
    ).toEqual(['orders.view_organization']);
    expect(
      effectiveCodes({ kind: 'member', permissions: [], memberDefaultsOffered: [] }, catalogue(new Set(['orders']))),
    ).toEqual([]);
  });

  it('custom: stored grants intersected with presence, never a default', () => {
    const custom = { kind: 'custom' as const, permissions: ['carts.approve', 'quick_order.one_click', 'gone.code'], memberDefaultsOffered: [] };
    expect(effectiveCodes(custom, catalogue(all))).toEqual(['carts.approve', 'quick_order.one_click']);
    expect(effectiveCodes(custom, catalogue(new Set(['carts'])))).toEqual(['carts.approve']);
  });

  it('granted (before presence) is what a save starts from', () => {
    const c = catalogue(new Set(['carts']));
    expect(grantedCodes({ kind: 'member', permissions: ['orders.view_organization'], memberDefaultsOffered: ['carts.create'] }, c)).toEqual([
      'orders.view_organization',
      'quick_order.one_click',
    ]);
  });
});

describe('a save merges with what it cannot see (FR-023, FR-025, US 8, data-model §1)', () => {
  it('keeps a grant of a switched-off module, drops a code no module declares, and takes the submitted present codes', () => {
    const c = catalogue(new Set(['carts', 'orders']));
    const merged = mergeSubmittedPermissions(
      { kind: 'custom', permissions: ['carts.create', 'quick_order.one_click', 'legacy.gone'], memberDefaultsOffered: [] },
      ['orders.view_organization', 'orders.view_organization'],
      c,
    );
    expect(merged.permissions).toEqual(['orders.view_organization', 'quick_order.one_click']);
    expect(merged.memberDefaultsOffered).toEqual([]);
  });

  it('Member: materialises the offer, so an un-ticked default never returns — across off/on and uninstall/reinstall', () => {
    const present = new Set(['carts', 'quick_order', 'orders']);
    const c = catalogue(present);
    // The administrator un-ticks `carts.create` and keeps `quick_order.one_click`.
    const saved = mergeSubmittedPermissions(
      { kind: 'member', permissions: [], memberDefaultsOffered: [] },
      ['quick_order.one_click'],
      c,
    );
    expect(saved.permissions).toEqual(['quick_order.one_click']);
    expect(saved.memberDefaultsOffered).toEqual(['carts.create', 'quick_order.one_click']);
    const after = { kind: 'member' as const, ...saved };
    expect(effectiveCodes(after, c)).toEqual(['quick_order.one_click']);

    // Off and on again.
    present.delete('carts');
    expect(effectiveCodes(after, c)).toEqual(['quick_order.one_click']);
    present.add('carts');
    expect(effectiveCodes(after, c)).toEqual(['quick_order.one_click']);

    // Uninstalled (the code leaves the vocabulary), saved meanwhile, then reinstalled.
    const withoutCarts = catalogue(present, MANIFESTS.filter((m) => m.manifest.id !== 'carts'));
    const savedWhileGone = mergeSubmittedPermissions(after, ['quick_order.one_click'], withoutCarts);
    expect(savedWhileGone.memberDefaultsOffered).toContain('carts.create');
    expect(effectiveCodes({ kind: 'member', ...savedWhileGone }, c)).toEqual(['quick_order.one_click']);
  });

  it('Member: a default of a switched-off module that was never offered is kept as a grant', () => {
    const c = catalogue(new Set(['carts']));
    const saved = mergeSubmittedPermissions({ kind: 'member', permissions: [], memberDefaultsOffered: [] }, ['carts.create'], c);
    expect(saved.permissions).toEqual(['carts.create', 'quick_order.one_click']);
  });
});
