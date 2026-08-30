import { describe, expect, it } from 'vitest';
import {
  resolvePermissionLabel,
  scopeCarrying,
} from '../../../src/modules/admin_users/permission-label';
import type { Bundle } from '../../../src/i18n/types';

/**
 * Feature 091, Phase 3 — a permission label written in the owning module's own
 * bundle has to render.
 *
 * The regression these assertions pin is not a crash: `mfa`, `pwa`, `stripe`
 * and `prompt_actions` each shipped their labels in their own bundle, the
 * screen looked them up in `core` only, and the operator saw the English
 * manifest label with nothing logged. Every fixture below is a merged bundle,
 * which is what the provider holds.
 */
describe('permission label resolution', () => {
  const KEY = 'adminRoles.permission.pwa:read';

  it("takes the owning module's own namespace", () => {
    const bundle: Bundle = { pwa: { [KEY]: 'Podgląd ustawień PWA' } };
    expect(
      resolvePermissionLabel({
        code: 'pwa:read',
        fallbackLabel: 'View PWA settings',
        language: 'pl',
        bundle,
      }),
    ).toBe('Podgląd ustawień PWA');
  });

  it('prefers the legacy `core` block while a label is still there', () => {
    const bundle: Bundle = {
      core: { [KEY]: 'core copy' },
      pwa: { [KEY]: 'module copy' },
    };
    expect(scopeCarrying(bundle, KEY)).toBe('core');
    expect(
      resolvePermissionLabel({
        code: 'pwa:read',
        fallbackLabel: 'View PWA settings',
        language: 'en',
        bundle,
      }),
    ).toBe('core copy');
  });

  it("falls back to English through the module's own namespace", () => {
    expect(
      resolvePermissionLabel({
        code: 'pwa:read',
        fallbackLabel: 'manifest label',
        language: 'pl',
        bundle: { pwa: {} },
        fallbackBundle: { pwa: { [KEY]: 'View PWA settings' } },
      }),
    ).toBe('View PWA settings');
  });

  it('falls back to the manifest label when no bundle carries the key', () => {
    expect(
      resolvePermissionLabel({
        code: 'crm:read',
        fallbackLabel: 'View CRM',
        language: 'pl',
        bundle: { core: {}, pwa: { [KEY]: 'Podgląd' } },
      }),
    ).toBe('View CRM');
  });

  it('never renders the raw key as a label', () => {
    const label = resolvePermissionLabel({
      code: 'crm:read',
      fallbackLabel: 'View CRM',
      language: 'en',
      bundle: {},
    });
    expect(label).not.toContain('adminRoles.permission.');
  });

  it('resolves a scan deterministically when two namespaces carry the key', () => {
    expect(scopeCarrying({ zzz: { k: 'z' }, aaa: { k: 'a' } }, 'k')).toBe('aaa');
    expect(scopeCarrying({}, 'k')).toBeNull();
    expect(scopeCarrying(undefined, 'k')).toBeNull();
  });
});
