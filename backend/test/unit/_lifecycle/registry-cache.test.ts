import { describe, it, expect, beforeEach } from 'vitest';
import {
  ModuleRegistryCache,
  registryCache,
} from '../../../src/modules/_lifecycle/services/registry-cache.js';

describe('ModuleRegistryCache (test seam)', () => {
  let cache: ModuleRegistryCache;

  beforeEach(() => {
    cache = new ModuleRegistryCache();
  });

  it('returns false for any moduleId before initialisation', () => {
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
