import { describe, it, expect, beforeEach } from 'vitest';
import {
  ModulePresenceNotLoadedError,
  ModuleRegistryCache,
  registryCache,
} from '../../../src/modules/_lifecycle/services/registry-cache.js';

describe('ModuleRegistryCache (test seam)', () => {
  let cache: ModuleRegistryCache;

  beforeEach(() => {
    cache = new ModuleRegistryCache();
  });

  it('refuses to answer before anything has loaded it (feature 072, D-38)', () => {
    // It used to answer `false`, and that is what stopped the platform booting:
    // "nobody has read the database yet" was indistinguishable from "the
    // operator switched this off", so every gated port resolved during
    // composition threw `ModuleDisabledError`.
    expect(cache.isLoaded()).toBe(false);
    expect(() => cache.isEnabled('demo')).toThrow(ModulePresenceNotLoadedError);
    expect(() => cache.enabledIds()).toThrow(ModulePresenceNotLoadedError);
    expect(() => cache.platformStateOf('demo')).toThrow(ModulePresenceNotLoadedError);
    expect(() => cache.activationValue('demo')).toThrow(ModulePresenceNotLoadedError);
    expect(() => cache.knownModuleIds()).toThrow(ModulePresenceNotLoadedError);
  });

  it('answers an empty platform axis once loaded — absent is an answer, unloaded is not', () => {
    cache.__setEnabledForTesting([]);
    expect(cache.isLoaded()).toBe(true);
    expect(cache.isEnabled('demo')).toBe(false);
    expect(cache.enabledIds()).toEqual([]);
  });

  it('the test seam injects an enabled set without touching Redis or DB', () => {
    cache.__setEnabledForTesting(['blog', 'search', 'settings']);
    expect(cache.isEnabled('blog')).toBe(true);
    expect(cache.isEnabled('search')).toBe(true);
    expect(cache.isEnabled('absent')).toBe(false);
    expect(cache.enabledIds()).toEqual(['blog', 'search', 'settings']);
  });

  it('test seam replaces the entire set on each call', () => {
    cache.__setEnabledForTesting(['a']);
    cache.__setEnabledForTesting(['b']);
    expect(cache.isEnabled('a')).toBe(false);
    expect(cache.isEnabled('b')).toBe(true);
  });

  it('isDegraded() defaults to false', () => {
    expect(cache.isDegraded()).toBe(false);
  });

  it('singleton `registryCache` exports a sharable instance', () => {
    expect(registryCache).toBeInstanceOf(ModuleRegistryCache);
    registryCache.__setEnabledForTesting(['x']);
    expect(registryCache.isEnabled('x')).toBe(true);
    // Reset to keep other tests deterministic.
    registryCache.__setEnabledForTesting([]);
  });
});
