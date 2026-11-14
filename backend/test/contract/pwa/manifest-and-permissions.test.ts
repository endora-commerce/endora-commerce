import { describe, expect, it } from 'vitest';
import { manifest, pwaSettingsManifest } from '../../../../packages/modules/pwa/src/manifest.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { listAssignablePermissionCodes } from '../../../../packages/modules/admin_roles/src/backend/services/permission-catalogue.service.js';
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

  it('ships both status push category switches on (specs/149-pwa-order-status-push/ FR-002)', () => {
    const byCode = new Map(pwaSettingsManifest.settings.map((s) => [s.code, s]));
    for (const code of [
      PWA_SETTING_CODES.PUSH_ORDER_STATUS_ENABLED,
      PWA_SETTING_CODES.PUSH_QUOTE_STATUS_ENABLED,
    ]) {
      expect(byCode.get(code)?.valueType).toBe('boolean');
      expect(byCode.get(code)?.defaultValue).toBe(true);
      // Managed only from the PWA screen, like every other pwa.* value.
      expect(byCode.get(code)?.hidden).toBe(true);
    }
  });

  it('has no edge on quote_requests: quote pushes arrive through customerPushPort (specs/179-… FR-061)', () => {
    expect(manifest.dependencies).not.toContain('quote_requests');
    expect((manifest.nonBindingDependencies ?? []).filter((edge) => edge.moduleId === 'quote_requests')).toEqual([]);
  });

  it('is reachable from the command palette under the code that opens its screen (Principle XVI)', () => {
    expect(manifest.actions).toEqual([
      expect.objectContaining({
        id: 'open-settings',
        labelKey: 'actions.openSettings.label',
        descriptionKey: 'actions.openSettings.description',
        icon: 'Smartphone',
        targetRoute: '/settings/pwa',
        requiredPermission: PWA_PERMISSIONS.READ,
      }),
    ]);
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
