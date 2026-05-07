import { describe, it, expect } from 'vitest';
import {
  ModuleManifestSchema,
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@b2b/contracts';

describe('ModuleManifestSchema', () => {
  it('accepts a minimal valid manifest', () => {
    const parsed = ModuleManifestSchema.parse({
      id: 'demo',
      name: 'Demo',
      version: '1.0.0',
      dependencies: [],
    });
    expect(parsed.id).toBe('demo');
    expect(parsed.dependencies).toEqual([]);
  });

  it('rejects a non-conforming id (uppercase)', () => {
    expect(() =>
      ModuleManifestSchema.parse({
        id: 'Demo',
        name: 'Demo',
        version: '1.0.0',
        dependencies: [],
      }),
    ).toThrow();
  });

  it('rejects a non-conforming version', () => {
    expect(() =>
      ModuleManifestSchema.parse({
        id: 'demo',
        name: 'Demo',
        version: '1.0',
        dependencies: [],
      }),
    ).toThrow();
  });

  it('accepts the underscore-prefixed reserved id', () => {
    const parsed = ModuleManifestSchema.parse({
      id: '_lifecycle',
      name: 'Lifecycle',
      version: '1.0.0',
      dependencies: [],
    });
    expect(parsed.id).toBe('_lifecycle');
  });
});

describe('defineModuleManifest', () => {
  it('rejects a self-dependency', () => {
    expect(() =>
      defineModuleManifest({
        id: 'demo',
        name: 'Demo',
        version: '1.0.0',
        dependencies: ['demo'],
      }),
    ).toThrow(/depends on itself/);
  });

  it('rejects a settings.moduleCode mismatch', () => {
    expect(() =>
      defineModuleManifest({
        id: 'demo',
        name: 'Demo',
        version: '1.0.0',
        dependencies: [],
        settings: defineModuleSettingsManifest({
          moduleCode: 'other',
          groups: [],
          settings: [],
        }),
      }),
    ).toThrow(/moduleCode/);
  });

  it('round-trips a manifest with settings', () => {
    const m = defineModuleManifest({
      id: 'demo',
      name: 'Demo',
      version: '1.0.0',
      dependencies: [],
      settings: defineModuleSettingsManifest({
        moduleCode: 'demo',
        groups: [{ code: 'demo', name: 'Demo' }],
        settings: [],
      }),
    });
    expect(m.settings?.moduleCode).toBe('demo');
    expect(m.settings?.groups[0]?.code).toBe('demo');
  });

  it('accepts a license tier from the enum', () => {
    const m = defineModuleManifest({
      id: 'paid_module',
      name: 'Paid',
      version: '1.0.0',
      dependencies: [],
      license: 'pro',
    });
    expect(m.license).toBe('pro');
  });
});
