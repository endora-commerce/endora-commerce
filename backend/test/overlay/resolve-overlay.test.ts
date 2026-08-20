import { describe, it, expect } from 'vitest';
import { classifyKind, indexCore, resolveOverlay } from '../../src/overlay/resolve-overlay.js';
import { coreSampleRoot, overlayRoot } from './_fixtures.js';

describe('resolve-overlay — classification (T006)', () => {
  it('classifies overridable and rejected kinds by path', () => {
    // `services/` was the `service` kind until feature 072 (T067). A service
    // override is a decoration now — named by the registration it wraps, not
    // by the path it shadows — so nothing here classifies it, and a file at
    // this path is exactly what `other` means: not an override of anything.
    expect(classifyKind('services/pricing-service.ts')).toBe('other');
    expect(classifyKind('routes.admin.ts')).toBe('route');
    expect(classifyKind('routes/admin.ts')).toBe('route');
    expect(classifyKind('plugin.ts')).toBe('route');
    expect(classifyKind('config.ts')).toBe('config');
    expect(classifyKind('manifest.ts')).toBe('config');
    expect(classifyKind('entities/product.ts')).toBe('schema');
    expect(classifyKind('migrations/001_init.ts')).toBe('schema');
    expect(classifyKind('services/pricing-service.interface.ts')).toBe('other');
    expect(classifyKind('random-internal.ts')).toBe('other');
  });
});

describe('resolve-overlay — deterministic resolution & shadowing (T006)', () => {
  it('indexes core modules and their files', () => {
    const core = indexCore(coreSampleRoot);
    expect([...core.moduleIds].sort()).toEqual(['catalog', 'price_lists']);
    expect(core.filesByModule.get('price_lists')?.has('services/pricing-service.ts')).toBe(true);
  });

  it('resolves overlay overrides + new modules deterministically', () => {
    const res = resolveOverlay({
      coreRoot: coreSampleRoot,
      overlayRoot: overlayRoot('overlay-good'),
      deployment: 'acme',
    });
    expect(res.deployment).toBe('acme');
    expect(res.newModules).toEqual(['acme_loyalty']);
    // Sorted by (moduleId, kind, relPath). A `services/` file is no longer an
    // overridable unit (feature 072, T067) — a service override is a
    // decoration, declared by the overriding module, not a shadowed path.
    expect(res.overrides.map((o) => `${o.moduleId}:${o.kind}:${o.relPath}`)).toEqual([
      'price_lists:route:routes.admin.ts',
    ]);
  });

  it('is core-only (empty) when overlayRoot is null', () => {
    const res = resolveOverlay({ coreRoot: coreSampleRoot, overlayRoot: null, deployment: null });
    expect(res).toEqual({ deployment: null, overrides: [], newModules: [] });
  });

  it('produces identical output across repeated runs (determinism)', () => {
    const a = resolveOverlay({ coreRoot: coreSampleRoot, overlayRoot: overlayRoot('overlay-good'), deployment: 'acme' });
    const b = resolveOverlay({ coreRoot: coreSampleRoot, overlayRoot: overlayRoot('overlay-good'), deployment: 'acme' });
    expect(JSON.stringify(a.overrides.map((o) => o.relPath))).toEqual(
      JSON.stringify(b.overrides.map((o) => o.relPath)),
    );
  });
});
