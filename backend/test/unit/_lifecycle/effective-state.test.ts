import { describe, expect, it, beforeEach } from 'vitest';
import {
  ModulePresenceNotLoadedError,
  ModuleRegistryCache,
} from '../../../src/modules/_lifecycle/services/registry-cache.js';
import {
  ModuleEffectiveState,
  effectiveState,
} from '../../../src/modules/_lifecycle/services/effective-state.js';
import type { ModuleActivationDeclaration } from '../../../src/kernel/lifecycle/activation-resolver.js';

/**
 * Feature 073 — effective state is the conjunction of the two axes
 * (Constitution XVII, data-model §2.1).
 *
 * Three invariants are pinned here:
 *   1. `isPresent` is synchronous — no I/O, no await, no database read. It is
 *      called on every gated request through four wrappers.
 *   2. An unknown module id is absent. There is no fall-open for a module the
 *      resolver has never heard of.
 *   3. A non-deactivatable module's operator axis is forced on, whatever is
 *      stored — which is what removes the recursion of gating `settings` on a
 *      value that lives in `settings`.
 */

const CONTROL: ModuleActivationDeclaration = {
  moduleId: 'fixture_control',
  settingCode: 'fixture_control.activation',
  default: true,
  nonDeactivatableReason: null,
};

const CORE: ModuleActivationDeclaration = {
  moduleId: 'fixture_core',
  settingCode: null,
  default: true,
  nonDeactivatableReason: 'The platform cannot switch itself off.',
};

describe('ModuleEffectiveState', () => {
  let cache: ModuleRegistryCache;
  let state: ModuleEffectiveState;

  beforeEach(() => {
    cache = new ModuleRegistryCache();
    cache.setActivationDeclarations([CONTROL, CORE]);
    state = new ModuleEffectiveState(cache);
  });

  describe('the conjunction, across all four axis combinations', () => {
    it('platform available + operator activated ⇒ present', () => {
      cache.__setEnabledForTesting(['fixture_control']);
      expect(state.isPresent('fixture_control')).toBe(true);
    });

    it('platform available + operator deactivated ⇒ absent', () => {
      cache.__setEnabledForTesting(['fixture_control'], { deactivated: ['fixture_control'] });
      expect(state.isPresent('fixture_control')).toBe(false);
    });

    it('platform unavailable + operator activated ⇒ absent', () => {
      cache.__setEnabledForTesting([]);
      expect(state.isPresent('fixture_control')).toBe(false);
    });

    it('platform unavailable + operator deactivated ⇒ absent', () => {
      cache.__setEnabledForTesting([], { deactivated: ['fixture_control'] });
      expect(state.isPresent('fixture_control')).toBe(false);
    });
  });

  it('has no answer at all before the presence load (feature 072, D-38)', () => {
    // A cache nobody has loaded used to report every module absent, which reads
    // like data and is not: the platform's own boot hooks asked it and got
    // "switched off" for a deployment where nothing was.
    expect(() => state.isPresent('fixture_control')).toThrow(ModulePresenceNotLoadedError);
  });

  it('reports absent — as an answer — once loaded with an empty platform axis', () => {
    cache.__setEnabledForTesting([]);
    expect(state.isPresent('fixture_control')).toBe(false);
  });

  it('an unknown module id is absent (invariant 2)', () => {
    cache.__setEnabledForTesting(['fixture_control']);
    expect(state.isPresent('module_that_does_not_exist')).toBe(false);
    expect(state.presence('module_that_does_not_exist')).toBeUndefined();
  });

  it('isPresent performs no I/O and returns a plain boolean (invariant 1)', () => {
    cache.__setEnabledForTesting(['fixture_control']);
    const result = state.isPresent('fixture_control');
    expect(typeof result).toBe('boolean');
    expect(result).not.toBeInstanceOf(Promise);
  });

  describe('a non-deactivatable module (invariant 3)', () => {
    it('is activated even when a stored value says otherwise', () => {
      cache.__setEnabledForTesting(['fixture_core'], { deactivated: ['fixture_core'] });
      expect(state.isPresent('fixture_core')).toBe(true);
      expect(state.presence('fixture_core')?.operatorActivated).toBe(true);
    });

    it('is still absent when the platform axis is off — the axes stay orthogonal', () => {
      cache.__setEnabledForTesting([]);
      expect(state.isPresent('fixture_core')).toBe(false);
    });

    it('reports itself as not deactivatable, with its declared reason', () => {
      cache.__setEnabledForTesting(['fixture_core']);
      expect(state.presence('fixture_core')).toEqual({
        moduleId: 'fixture_core',
        platformAvailable: true,
        platformState: 'installed',
        operatorActivated: true,
        deactivatable: false,
        nonDeactivatableReason: 'The platform cannot switch itself off.',
      });
    });
  });

  describe('a module that has declared no activation control yet', () => {
    it('is governed by the platform axis alone', () => {
      cache.__setEnabledForTesting(['fixture_unconverted']);
      expect(state.isPresent('fixture_unconverted')).toBe(true);
      cache.__setEnabledForTesting([]);
      expect(state.isPresent('fixture_unconverted')).toBe(false);
    });

    it('reports no operator control', () => {
      cache.__setEnabledForTesting(['fixture_unconverted']);
      expect(state.presence('fixture_unconverted')?.deactivatable).toBe(false);
      expect(state.presence('fixture_unconverted')?.nonDeactivatableReason).toBeNull();
    });
  });

  describe('presence()', () => {
    it('reports both axes separately so the Admin UI can render them differently', () => {
      cache.__setEnabledForTesting(['fixture_control'], { deactivated: ['fixture_control'] });
      expect(state.presence('fixture_control')).toEqual({
        moduleId: 'fixture_control',
        platformAvailable: true,
        platformState: 'installed',
        operatorActivated: false,
        deactivatable: true,
        nonDeactivatableReason: null,
      });
    });

    it('reports a declared module the registry has never heard of as not-installed', () => {
      cache.__setEnabledForTesting([]);
      expect(state.presence('fixture_control')).toEqual({
        moduleId: 'fixture_control',
        platformAvailable: false,
        platformState: 'not-installed',
        operatorActivated: true,
        deactivatable: true,
        nonDeactivatableReason: null,
      });
    });
  });

  describe('all()', () => {
    it('covers every declared module plus everything the registry knows', () => {
      cache.__setEnabledForTesting(['fixture_control', 'fixture_unconverted']);
      expect(state.all().map((p) => p.moduleId).sort()).toEqual([
        'fixture_control',
        'fixture_core',
        'fixture_unconverted',
      ]);
    });
  });

  it('surfaces the cache degraded flag', () => {
    expect(state.isDegraded()).toBe(false);
  });
});

describe('effectiveState singleton', () => {
  it('is a sharable instance over the process registry cache', () => {
    expect(effectiveState).toBeInstanceOf(ModuleEffectiveState);
  });
});
