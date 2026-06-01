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

  it('filters out permissions from disabled modules', () => {
    const svc = new PermissionCatalogueService({
      registryEntries: [{ manifest: cmsManifest }, { manifest: settingsManifest }],
      getEnabledModuleIds: () => ['settings'],
    });
    const codes = svc.listAssignableCodes();
    expect(codes).not.toContain('cms.read');
    expect(codes).toContain('settings:read');
  });

  it('invalidate() rebuilds after enabled-set changes', () => {
    let enabled: string[] = ['cms'];
    const svc = new PermissionCatalogueService({
      registryEntries: [{ manifest: cmsManifest }],
      getEnabledModuleIds: () => enabled,
    });
    expect(svc.listAssignableCodes()).toContain('cms.read');
    enabled = ['settings'];
    svc.invalidate();
    expect(svc.listAssignableCodes()).not.toContain('cms.read');
  });
});
