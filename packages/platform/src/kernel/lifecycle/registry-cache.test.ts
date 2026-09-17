import { describe, it, expect, beforeEach } from 'vitest';
import {
  ModulePresenceNotLoadedError,
  ModuleRegistryCache,
  registryCache,
} from './registry-cache.js';
import { capabilityRegistryFrom } from './capability-registry.js';
import type { ModuleManifest } from '@endora-commerce/contracts';

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

  it('the presence version moves on content, not on refresh count (issue #225)', () => {
    // A consumer that memoises a projection of presence compares this number,
    // rather than acting on the pub/sub message: the message announces a change
    // whose effect here is still a PostgreSQL round-trip away, so a cache
    // dropped on the message is refilled from the presence before the change.
    expect(cache.presenceVersion()).toBe(0);

    cache.__setEnabledForTesting(['blog']);
    const afterFirstLoad = cache.presenceVersion();
    expect(afterFirstLoad).toBeGreaterThan(0);

    // A refresh that installs the same presence — which is what every process
    // does on a state change that did not concern it, and what the degraded
    // timer does every five seconds — must cost the consumer nothing.
    cache.__setEnabledForTesting(['blog']);
    expect(cache.presenceVersion()).toBe(afterFirstLoad);

    // The operator axis moves on its own, with the platform axis unchanged.
    // This is the flip the palette was serving a stale snapshot across.
    cache.__setEnabledForTesting(['blog'], { deactivated: ['blog'] });
    const afterDeactivation = cache.presenceVersion();
    expect(afterDeactivation).toBeGreaterThan(afterFirstLoad);

    // And the platform axis moves on its own.
    cache.__setEnabledForTesting(['blog', 'search'], { deactivated: ['blog'] });
    expect(cache.presenceVersion()).toBeGreaterThan(afterDeactivation);
  });

  describe('the capability registry (feature 132, T011)', () => {
    // Manifests, because the cache is handed what the derivation produced and the
    // derivation is handed manifests. Building the fixture through
    // `capabilityRegistryFrom` rather than by hand is deliberate: a hand-written
    // registry literal would let this file's idea of the shape drift from the one
    // `presence-load` installs.
    const manifest = (overrides: Partial<ModuleManifest> & { id: string }): ModuleManifest =>
      ({ version: '1.0.0', dependencies: [], ...overrides }) as unknown as ModuleManifest;

    const FAMILY = capabilityRegistryFrom([
      manifest({
        id: 'fixture_owner',
        activation: { nonDeactivatable: true, reason: 'Always present.' },
        exclusiveCapabilities: [
          { key: 'pim-connector', errorCode: 'PIM_CONNECTOR_ALREADY_ACTIVE' },
        ],
      }),
      manifest({
        id: 'fixture_member_a',
        capabilities: ['pim-connector'],
        activation: { settingCode: 'fixture_member_a.activation', default: false },
      }),
      manifest({
        id: 'fixture_member_b',
        capabilities: ['pim-connector', 'erp-connector'],
        activation: { settingCode: 'fixture_member_b.activation', default: false },
      }),
    ]);

    it('answers no member and no owner before anything installed a registry', () => {
      expect(cache.declaredCapabilityMembers('pim-connector')).toEqual([]);
      expect(cache.exclusiveCapability('pim-connector')).toBeUndefined();
    });

    it('indexes declared members by key, in manifest order', () => {
      cache.setCapabilityDeclarations(FAMILY);
      expect(cache.declaredCapabilityMembers('pim-connector')).toEqual([
        'fixture_member_a',
        'fixture_member_b',
      ]);
      expect(cache.declaredCapabilityMembers('erp-connector')).toEqual(['fixture_member_b']);
      expect(cache.declaredCapabilityMembers('invoice-ledger-vendor')).toEqual([]);
    });

    it('indexes the owner and the code it minted', () => {
      cache.setCapabilityDeclarations(FAMILY);
      expect(cache.exclusiveCapability('pim-connector')).toEqual({
        key: 'pim-connector',
        ownerModuleId: 'fixture_owner',
        errorCode: 'PIM_CONNECTOR_ALREADY_ACTIVE',
      });
      // A key with members and no owner is not exclusive here (R3.5).
      expect(cache.exclusiveCapability('erp-connector')).toBeUndefined();
    });

    it('replaces the whole registry on each call — a re-load is not a merge', () => {
      cache.setCapabilityDeclarations(FAMILY);
      cache.setCapabilityDeclarations(capabilityRegistryFrom([]));
      expect(cache.declaredCapabilityMembers('pim-connector')).toEqual([]);
      expect(cache.exclusiveCapability('pim-connector')).toBeUndefined();
    });

    it('is answerable before the presence load — it is manifest data, not presence', () => {
      // Same property `activationDeclaration` has: the declarations are installed
      // by the composition root before any database read, and a member lookup that
      // threw before the load would make the family unreadable at exactly the
      // moment the exclusion's interceptor is being registered.
      cache.setCapabilityDeclarations(FAMILY);
      expect(cache.isLoaded()).toBe(false);
      expect(cache.declaredCapabilityMembers('pim-connector')).toEqual([
        'fixture_member_a',
        'fixture_member_b',
      ]);
    });

    it('`load` installs it in the same call as the activation declarations', async () => {
      // The Redis invalidation design (`data-model.md` §2.2): membership and
      // activation are read together on every refusal, so they are installed
      // together and refreshed by the same `b2b:module:state-changed` event.
      await cache.load({
        em: (() => {
          throw new Error('the fixture must not reach the database');
        }) as never,
        activationDeclarations: [],
        capabilityRegistry: FAMILY,
      }).catch(() => undefined);
      expect(cache.declaredCapabilityMembers('pim-connector')).toEqual([
        'fixture_member_a',
        'fixture_member_b',
      ]);
    });

    it('__resetForTesting clears it, like every other piece of installed state', () => {
      cache.setCapabilityDeclarations(FAMILY);
      cache.__resetForTesting();
      expect(cache.declaredCapabilityMembers('pim-connector')).toEqual([]);
      expect(cache.exclusiveCapability('pim-connector')).toBeUndefined();
    });
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
