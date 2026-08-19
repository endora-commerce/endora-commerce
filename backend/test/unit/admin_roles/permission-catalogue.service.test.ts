import { describe, expect, it } from 'vitest';
import { defineModuleManifest } from '@b2b/contracts';
import { PermissionCatalogueService } from '../../../src/modules/admin_roles/services/permission-catalogue.service.js';

describe('PermissionCatalogueService', () => {
  const cmsManifest = defineModuleManifest({
    id: 'cms',
    name: 'CMS',
    version: '1.0.0',
    dependencies: [],
    permissions: [
      { code: 'cms.read', label: 'Read' },
      { code: 'cms.write', label: 'Write' },
    ],
  });

  const settingsManifest = defineModuleManifest({
    id: 'settings',
    name: 'Settings',
    version: '1.0.0',
    dependencies: [],
    permissions: [{ code: 'settings:read', label: 'View settings' }],
  });

  it('merges core catalogue with manifest permissions', () => {
    const svc = new PermissionCatalogueService({
      registryEntries: [{ manifest: cmsManifest }],
    });
    const codes = svc.listAssignableCodes();
    expect(codes).toContain('catalog:read');
    expect(codes).toContain('cms.read');
    expect(codes).toContain('cms.write');
  });

  it('dedupes by code with core winning', () => {
    const duplicate = defineModuleManifest({
      id: 'blog',
      name: 'Blog',
      version: '1.0.0',
      dependencies: [],
      permissions: [{ code: 'blog.read', module: 'blog', label: 'Duplicate' }],
    });
    const svc = new PermissionCatalogueService({
      registryEntries: [{ manifest: duplicate }],
    });
    const row = svc.listAssignable().find((e) => e.code === 'blog.read');
    expect(row?.label).toBe('View blog content');
  });

  it('sorts by module then code', () => {
    const svc = new PermissionCatalogueService({
      registryEntries: [{ manifest: cmsManifest }, { manifest: settingsManifest }],
    });
    const rows = svc.listAssignable();
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]!;
      const cur = rows[i]!;
      const cmp =
        prev.module.localeCompare(cur.module) || prev.code.localeCompare(cur.code);
      expect(cmp).toBeLessThanOrEqual(0);
    }
  });

  it('filters out permissions from absent modules', () => {
    const svc = new PermissionCatalogueService({
      registryEntries: [{ manifest: cmsManifest }, { manifest: settingsManifest }],
      isModulePresent: (id) => id === 'settings',
    });
    const codes = svc.listAssignableCodes();
    expect(codes).not.toContain('cms.read');
    expect(codes).toContain('settings:read');
  });

  /**
   * Issue #213. The predicate this service takes is the **effective** state,
   * and the way to prove it is a module that is platform-available and
   * operator-deactivated — the only combination the old `getEnabledModuleIds`
   * accessor could not express, and the one an operator actually creates.
   *
   * Driven here through the predicate rather than through the registry cache;
   * `test/integration/admin_roles/permission-catalogue-off-state.test.ts`
   * drives the real two axes end to end.
   */
  it('drops a deactivated module’s codes even while the platform still offers it', () => {
    const platformAvailable = new Set(['cms', 'settings']);
    const deactivated = new Set(['cms']);
    const svc = new PermissionCatalogueService({
      registryEntries: [{ manifest: cmsManifest }, { manifest: settingsManifest }],
      isModulePresent: (id) => platformAvailable.has(id) && !deactivated.has(id),
    });

    expect(svc.listAssignableCodes()).not.toContain('cms.read');
    expect(svc.listAssignableCodes()).toContain('settings:read');
  });

  /**
   * The core `PERMISSION_CATALOGUE` rows are filtered too, and this is the half
   * that made the defect invisible: `blog.read` is a core row, not a manifest
   * one, so a fix that only filtered manifest permissions would have left the
   * reported case exactly as it was.
   */
  it('filters the core catalogue rows by their owning module as well', () => {
    const svc = new PermissionCatalogueService({
      registryEntries: [],
      isModulePresent: (id) => id !== 'blog',
    });
    const codes = svc.listAssignableCodes();
    expect(codes).not.toContain('blog.read');
    expect(codes).not.toContain('blog.write');
    expect(codes).toContain('catalog:read');
  });

  /**
   * `module` is a display grouping and the owner is a module id; `_lifecycle`
   * declares its codes under `module: 'module_lifecycle'`, which is no module
   * id at all. Filtering on the display field would delete the lifecycle
   * permissions from every deployment.
   */
  it('filters on the declaring module, not on the display grouping', () => {
    const regrouped = defineModuleManifest({
      id: '_lifecycle',
      name: 'Module lifecycle',
      version: '1.0.0',
      dependencies: [],
      permissions: [
        { code: 'modules:read', module: 'module_lifecycle', label: 'View modules' },
      ],
    });
    const svc = new PermissionCatalogueService({
      registryEntries: [{ manifest: regrouped }],
      isModulePresent: (id) => id === '_lifecycle',
    });

    expect(svc.listAssignableCodes()).toContain('modules:read');
    expect(svc.listAssignable().find((e) => e.code === 'modules:read')?.module).toBe(
      'module_lifecycle',
    );
  });

  /**
   * A code two modules declare survives while either declarer is present.
   * `integrations:manage` is the live instance: it gates both the API-keys and
   * the webhooks admin surfaces, so switching one off must not take the other's
   * gate off the role editor.
   */
  it('keeps a shared code while any of its owners is present', () => {
    const first = defineModuleManifest({
      id: 'api_keys',
      name: 'API Keys',
      version: '1.0.0',
      dependencies: [],
      permissions: [{ code: 'integrations:manage', label: 'Manage API keys + webhooks' }],
    });
    const second = defineModuleManifest({
      id: 'webhooks',
      name: 'Webhooks',
      version: '1.0.0',
      dependencies: [],
      permissions: [{ code: 'integrations:manage', label: 'Manage API keys + webhooks' }],
    });
    const entries = [{ manifest: first }, { manifest: second }];

    const apiKeysOff = new PermissionCatalogueService({
      registryEntries: entries,
      isModulePresent: (id) => id !== 'api_keys',
    });
    expect(apiKeysOff.listAssignableCodes()).toContain('integrations:manage');

    const bothOff = new PermissionCatalogueService({
      registryEntries: entries,
      isModulePresent: (id) => id !== 'api_keys' && id !== 'webhooks',
    });
    expect(bothOff.listAssignableCodes()).not.toContain('integrations:manage');
  });

  /**
   * There is no memo any more, so there is no invalidation to call and no
   * ordering for a listener to get wrong (issues #33 and #45 are the same
   * defect twice). The read reflects the very next answer the predicate gives,
   * synchronously, with nothing in between.
   */
  it('reflects a presence flip on the next read, with nothing invalidated', () => {
    let present = new Set(['cms']);
    const svc = new PermissionCatalogueService({
      registryEntries: [{ manifest: cmsManifest }, { manifest: settingsManifest }],
      isModulePresent: (id) => present.has(id),
    });
    expect(svc.listAssignableCodes()).toContain('cms.read');

    present = new Set(['settings']);
    expect(svc.listAssignableCodes()).not.toContain('cms.read');
    expect(svc.listAssignableCodes()).toContain('settings:read');

    present = new Set(['cms', 'settings']);
    expect(svc.listAssignableCodes()).toContain('cms.read');
  });

  it('asks the presence predicate on every read, never once', () => {
    const asked: string[] = [];
    const svc = new PermissionCatalogueService({
      registryEntries: [{ manifest: cmsManifest }],
      isModulePresent: (id) => {
        asked.push(id);
        return true;
      },
    });
    svc.listAssignableCodes();
    const afterFirst = asked.length;
    expect(afterFirst).toBeGreaterThan(0);
    svc.listAssignableCodes();
    expect(asked.length).toBe(afterFirst * 2);
  });

  /**
   * The grantable set narrows while a module is off; the **vocabulary** does
   * not. Role upsert validates against the second one, so an operator can save
   * a role that still holds a switched-off module's code instead of being told
   * it is unknown — off is non-destructive and reversible.
   */
  it('keeps an absent module’s codes in the known vocabulary', () => {
    const svc = new PermissionCatalogueService({
      registryEntries: [{ manifest: cmsManifest }, { manifest: settingsManifest }],
      isModulePresent: (id) => id !== 'cms' && id !== 'blog',
    });

    expect(svc.listAssignableCodes()).not.toContain('cms.read');
    expect(svc.listKnownCodes()).toContain('cms.read');
    expect(svc.listKnownCodes()).toContain('blog.read');
  });

  it('reports the codes a module owns, present or not', () => {
    const svc = new PermissionCatalogueService({
      registryEntries: [{ manifest: cmsManifest }],
      isModulePresent: () => false,
    });
    expect(svc.listOwnedCodes('cms').sort()).toEqual(['cms.read', 'cms.write']);
    expect(svc.listOwnedCodes('blog').sort()).toEqual(['blog.read', 'blog.write']);
    expect(svc.listOwnedCodes('module_lifecycle')).toEqual([]);
  });

  it('treats every registered module as present when no predicate is wired', () => {
    const svc = new PermissionCatalogueService({
      registryEntries: [{ manifest: cmsManifest }],
    });
    expect(svc.listAssignableCodes()).toContain('cms.read');
    expect(svc.listAssignableCodes()).toContain('blog.read');
  });
});
