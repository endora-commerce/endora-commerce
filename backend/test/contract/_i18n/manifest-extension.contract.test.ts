import { describe, expect, it } from 'vitest';
import { ModuleManifestSchema, defineModuleManifest } from '@endora-commerce/contracts';
import { manifest as adminI18nManifest } from '@endora-commerce/mod-i18n';
import { manifest as settingsManifest } from '../../../../packages/modules/settings/src/manifest.js';

/**
 * T033 / FR-008, FR-016 — `ModuleManifest.i18n` is the additive manifest
 * field that opts a module into the bundle-reconciler pipeline. The
 * contract: schema accepts the field with a custom or default
 * `bundlesDir`, accepts manifests that omit the field entirely
 * (back-compat for every pre-feature-019 module), and rejects an
 * empty `bundlesDir` at parse time.
 */
describe('ModuleManifest — i18n extension contract', () => {
  it('accepts a manifest declaring i18n: { bundlesDir: "i18n" }', () => {
    const m = defineModuleManifest({
      id: 'demo',
      name: 'Demo',
      version: '1.0.0',
      dependencies: [],
      i18n: { bundlesDir: 'i18n' },
    });
    expect(m.i18n).toEqual({ bundlesDir: 'i18n' });
  });

  it('accepts a manifest declaring i18n with a custom bundlesDir', () => {
    const m = defineModuleManifest({
      id: 'demo',
      name: 'Demo',
      version: '1.0.0',
      dependencies: [],
      i18n: { bundlesDir: 'translations' },
    });
    expect(m.i18n?.bundlesDir).toBe('translations');
  });

  it('defaults bundlesDir to "i18n" when only i18n: {} is supplied', () => {
    const parsed = ModuleManifestSchema.parse({
      id: 'demo',
      name: 'Demo',
      version: '1.0.0',
      dependencies: [],
      i18n: {},
    });
    expect(parsed.i18n?.bundlesDir).toBe('i18n');
  });

  it('accepts a manifest with NO i18n field (back-compat)', () => {
    const m = defineModuleManifest({
      id: 'demo',
      name: 'Demo',
      version: '1.0.0',
      dependencies: [],
    });
    expect(m.i18n).toBeUndefined();
  });

  it('rejects i18n: { bundlesDir: "" } at parse time', () => {
    expect(() =>
      ModuleManifestSchema.parse({
        id: 'demo',
        name: 'Demo',
        version: '1.0.0',
        dependencies: [],
        i18n: { bundlesDir: '' },
      }),
    ).toThrow();
  });

  it('the in-tree _i18n manifest validates and declares bundlesDir', () => {
    const parsed = ModuleManifestSchema.parse(adminI18nManifest);
    expect(parsed.id).toBe('_i18n');
    expect(parsed.i18n?.bundlesDir).toBe('i18n');
  });

  it('the in-tree settings manifest validates and declares bundlesDir (canary)', () => {
    const parsed = ModuleManifestSchema.parse(settingsManifest);
    expect(parsed.id).toBe('settings');
    expect(parsed.i18n?.bundlesDir).toBe('i18n');
  });
});
