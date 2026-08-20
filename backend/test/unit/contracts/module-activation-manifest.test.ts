import { describe, expect, it } from 'vitest';
import { defineModuleManifest, type ModuleManifest } from '@b2b/contracts';

/**
 * Feature 073 — `contracts/module-activation-manifest.md`.
 *
 * The activation block carries three cross-field rules that a Zod union
 * cannot express, so they live in `defineModuleManifest` alongside the
 * self-dependency and `settings.moduleCode` checks that are already there.
 *
 *   1. exactly one activation form;
 *   2. an `_`-prefixed (platform-internal) module MUST use `nonDeactivatable`;
 *   3. `settingCode` MUST be namespaced to the declaring module.
 */

function manifest(overrides: Partial<ModuleManifest> & { id: string }): ModuleManifest {
  return defineModuleManifest({
    name: 'Fixture module',
    version: '1.0.0',
    dependencies: [],
    ...overrides,
  } as ModuleManifest);
}

describe('defineModuleManifest — activation declaration (feature 073)', () => {
  it('accepts a manifest with no activation block at all (unconverted module)', () => {
    const m = manifest({ id: 'fixture_activation' });
    expect(m.activation).toBeUndefined();
  });

  describe('rule 1 — exactly one activation form', () => {
    it('accepts the settingCode form', () => {
      const m = manifest({
        id: 'fixture_activation',
        activation: { settingCode: 'fixture_activation.activation', default: true },
      });
      expect(m.activation).toEqual({
        settingCode: 'fixture_activation.activation',
        default: true,
      });
    });

    it('accepts the nonDeactivatable form', () => {
      const m = manifest({
        id: 'fixture_activation',
        activation: { nonDeactivatable: true, reason: 'Holds every activation control.' },
      });
      expect(m.activation).toEqual({
        nonDeactivatable: true,
        reason: 'Holds every activation control.',
      });
    });

    it('rejects a manifest carrying both forms at once', () => {
      expect(() =>
        manifest({
          id: 'fixture_activation',
          activation: {
            settingCode: 'fixture_activation.activation',
            default: true,
            nonDeactivatable: true,
            reason: 'Both at once.',
          } as never,
        }),
      ).toThrow(/exactly one/i);
    });

    it('rejects a manifest carrying neither form', () => {
      expect(() =>
        manifest({
          id: 'fixture_activation',
          activation: {} as never,
        }),
      ).toThrow(/exactly one/i);
    });

    it('rejects the settingCode form without a default (no implicit fall-open)', () => {
      expect(() =>
        manifest({
          id: 'fixture_activation',
          activation: { settingCode: 'fixture_activation.activation' } as never,
        }),
      ).toThrow(/exactly one/i);
    });

    it('rejects the nonDeactivatable form without a reason', () => {
      expect(() =>
        manifest({
          id: 'fixture_activation',
          activation: { nonDeactivatable: true } as never,
        }),
      ).toThrow(/exactly one/i);
    });
  });

  describe('rule 2 — a platform-internal module must be non-deactivatable', () => {
    it('rejects an `_`-prefixed module declaring a settingCode control', () => {
      expect(() =>
        manifest({
          id: '_fixture',
          activation: { settingCode: '_fixture.activation', default: true } as never,
        }),
      ).toThrow(/_fixture/);
    });

    it('names the prefix rule in the error', () => {
      expect(() =>
        manifest({
          id: '_fixture',
          activation: { settingCode: 'fixture.activation', default: true },
        }),
      ).toThrow(/nonDeactivatable/);
    });

    it('accepts an `_`-prefixed module declaring nonDeactivatable', () => {
      const m = manifest({
        id: '_fixture',
        activation: { nonDeactivatable: true, reason: 'Platform-internal subsystem.' },
      });
      expect(m.activation).toHaveProperty('nonDeactivatable', true);
    });
  });

  describe('rule 3 — settingCode is namespaced to the declaring module', () => {
    it('accepts `<id>.<something>`', () => {
      const m = manifest({
        id: 'blog',
        activation: { settingCode: 'blog.enabled', default: true },
      });
      expect(m.activation).toHaveProperty('settingCode', 'blog.enabled');
    });

    it('accepts a deeper adopted code under the module namespace', () => {
      const m = manifest({
        id: 'ksef',
        activation: { settingCode: 'ksef.integration.enabled', default: false },
      });
      expect(m.activation).toHaveProperty('settingCode', 'ksef.integration.enabled');
    });

    it('rejects a code owned by another module', () => {
      expect(() =>
        manifest({
          id: 'fixture_activation',
          activation: { settingCode: 'blog.enabled', default: true },
        }),
      ).toThrow(/namespace/i);
    });

    it('rejects a code that merely starts with the id but is not namespaced', () => {
      expect(() =>
        manifest({
          id: 'blog',
          activation: { settingCode: 'blogging.enabled', default: true },
        }),
      ).toThrow(/namespace/i);
    });

    it('names the offending code and module in the error', () => {
      expect(() =>
        manifest({
          id: 'fixture_activation',
          activation: { settingCode: 'blog.enabled', default: true },
        }),
      ).toThrow(/fixture_activation.*blog\.enabled|blog\.enabled.*fixture_activation/s);
    });
  });
});
