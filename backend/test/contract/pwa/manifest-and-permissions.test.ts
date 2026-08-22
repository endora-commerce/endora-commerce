import { describe, expect, it } from 'vitest';
import { manifest, pwaSettingsManifest } from '../../../src/modules/pwa/manifest.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { listAssignablePermissionCodes } from '../../../src/modules/admin_roles/services/permission-catalogue.service.js';
import { PWA_PERMISSIONS, PWA_SETTING_CODES } from '@endora-commerce/contracts';

describe('pwa manifest + permissions (feature 046)', () => {
  it('declares id "pwa" and its dependencies', () => {
    expect(manifest.id).toBe('pwa');
    expect(manifest.dependencies).toEqual(
      expect.arrayContaining(['settings', 'sales_channels', 'assets_library']),
    );
  });

  it('declares the three pwa permission codes', () => {
    const codes = (manifest.permissions ?? []).map((p) => p.code).sort();
    expect(codes).toEqual(
      [PWA_PERMISSIONS.READ, PWA_PERMISSIONS.WRITE, PWA_PERMISSIONS.SEND_PUSH].sort(),
    );
  });

  it('registers the pwa settings group with caching/push defaulting off', () => {
    expect(pwaSettingsManifest.moduleCode).toBe('pwa');
    expect(pwaSettingsManifest.groups.map((g) => g.code)).toContain('pwa');
    const byCode = new Map(pwaSettingsManifest.settings.map((s) => [s.code, s]));
    expect(byCode.get(PWA_SETTING_CODES.CACHING_ENABLED)?.defaultValue).toBe(false);
    expect(byCode.get(PWA_SETTING_CODES.PUSH_ENABLED)?.defaultValue).toBe(false);
    // VAPID private key + FCM service account are secret value types.
    expect(byCode.get(PWA_SETTING_CODES.VAPID_PRIVATE_KEY)?.valueType).toBe('secret');
    expect(byCode.get(PWA_SETTING_CODES.FCM_SERVICE_ACCOUNT)?.valueType).toBe('secret');
  });

  it('is registered in the lifecycle manifest registry', () => {
    const ids = REGISTERED_MANIFESTS.map((e) => e.manifest.id);
    expect(ids).toContain('pwa');
  });

  it('exposes its permission codes in the assignable catalogue', () => {
    const assignable = new Set(listAssignablePermissionCodes(REGISTERED_MANIFESTS));
    expect(assignable.has(PWA_PERMISSIONS.READ)).toBe(true);
    expect(assignable.has(PWA_PERMISSIONS.WRITE)).toBe(true);
    expect(assignable.has(PWA_PERMISSIONS.SEND_PUSH)).toBe(true);
  });
});
