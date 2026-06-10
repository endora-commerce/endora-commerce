/**
 * Baseline enforced codes (2026-05-22, feature 026):
 * catalog:read, catalog:write, orders:read, orders:write, rfqs:handle,
 * customers:manage, customers:impersonate, integrations:manage,
 * audit_log:read, admin_users:manage, credit_limits:manage,
 * settings:read, settings:write, sales_channels:read, sales_channels:write,
 * search:write, comparisons:read, assets.read, assets.write, analytics:read,
 * dictionary.write, cms.read, cms.write, megamenu.read, megamenu.write,
 * platform.modules.read
 */
import { describe, expect, it } from 'vitest';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { scanEnforcedPermissionCodes } from '../../../src/modules/admin_roles/permission-inventory.js';
import { listAssignablePermissionCodes } from '../../../src/modules/admin_roles/services/permission-catalogue.service.js';

describe('permission inventory (SC-001)', () => {
  it('every requireAdmin gate references an assignable catalogue code', () => {
    const enforced = scanEnforcedPermissionCodes();
    const assignable = new Set(listAssignablePermissionCodes(REGISTERED_MANIFESTS));
    const missing = [...enforced].filter((code) => !assignable.has(code)).sort();
    expect(missing, `codes not in assignable catalogue: ${missing.join(', ')}`).toEqual([]);
    // +2 for feature 042 MFA codes (mfa:reset, mfa:manage).
    // +1 for feature 043 (prompt_actions:use).
    expect(assignable.size).toBe(32);
  });
});
