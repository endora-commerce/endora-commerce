import { describe, expect, it } from 'vitest';
import {
  defineModuleManifest,
  type EnvironmentInput,
  type ModuleManifest,
} from '@endora-commerce/contracts';

/**
 * Feature 117 Phase 3 — `contracts/environment-inputs.md` §R2.2, the manifest
 * half of the environment declaration (FR-002).
 *
 * `defineModuleManifest` sees **one** manifest, on the author's own machine, at
 * import time, with no instance, no database and no sight of the platform's own
 * declaration. So it decides exactly one thing: that every entry is owned by the
 * module declaring it. Whether the *name* is one the platform already owns needs
 * the platform's declaration and is `check:env-inputs`'
 * `module-declares-a-platform-input` — a refusal at a layer that can see both.
 *
 * Every proof hands `defineModuleManifest` a whole manifest object — the top of
 * the analysis, which is where a red proof has to enter (issue #130). None
 * reaches past it into `assertEnvironmentInputRules`, because a fixture entering
 * below the rule cannot catch a rule that stopped running.
 */
function manifest(overrides: Partial<ModuleManifest> & { id: string }): ModuleManifest {
  return defineModuleManifest({
    name: 'Fixture module',
    version: '1.0.0',
    dependencies: [],
    ...overrides,
  } as ModuleManifest);
}

const OWNED: EnvironmentInput = {
  name: 'FIXTURE_API_TOKEN',
  describes: {
    en: 'The token this module presents to its vendor when it synchronises.',
    pl: 'Token, którym ten moduł uwierzytelnia się u dostawcy podczas synchronizacji.',
  },
  requirement: { kind: 'required' },
  secret: true,
  generable: false,
  owner: { kind: 'module', moduleId: 'fixture_env' },
  consumers: ['backend'],
  addressOf: null,
};

describe('defineModuleManifest — env declaration (feature 117 Phase 3)', () => {
  describe('what it accepts', () => {
    it('accepts a manifest declaring no environment input at all', () => {
      expect(manifest({ id: 'fixture_env' }).env).toBeUndefined();
    });

    it('accepts an input the declaring module owns', () => {
      const m = manifest({ id: 'fixture_env', env: [OWNED] });
      expect(m.env).toEqual([OWNED]);
    });

    it('accepts every requirement kind, including a condition over another author’s input', () => {
      const m = manifest({
        id: 'fixture_env',
        env: [
          {
            ...OWNED,
            name: 'FIXTURE_SEARCH_URL',
            secret: false,
            // The predicate names an input `catalog` owns. Nothing here refuses
            // that: a condition is evaluated against the whole vocabulary, and
            // `check:env-inputs` is what holds the name to some declaration.
            requirement: { kind: 'requiredWhen', input: 'CATALOG_SEARCH_BACKEND', equals: 'meilisearch' },
          },
          {
            ...OWNED,
            name: 'FIXTURE_WEBHOOK_URL',
            secret: false,
            requirement: {
              kind: 'optional',
              without: {
                en: 'This module stops notifying the vendor when an order ships.',
                pl: 'Moduł przestaje powiadamiać dostawcę o wysyłce zamówienia.',
              },
            },
          },
        ],
      });
      expect(m.env).toHaveLength(2);
    });
  });

  describe('what it refuses', () => {
    it('refuses an input declared as owned by the platform', () => {
      expect(() =>
        manifest({
          id: 'fixture_env',
          env: [{ ...OWNED, name: 'STOREFRONT_BASE_URL', owner: { kind: 'platform' } }],
        }),
      ).toThrow(/declares the environment input "STOREFRONT_BASE_URL" as owned by the platform/);
    });

    it('refuses an input declared as owned by another module', () => {
      expect(() =>
        manifest({
          id: 'fixture_env',
          env: [{ ...OWNED, owner: { kind: 'module', moduleId: 'search' } }],
        }),
      ).toThrow(/as owned by the module "search"/);
    });

    it('refuses an input declared as owned by an application', () => {
      expect(() =>
        manifest({
          id: 'fixture_env',
          env: [{ ...OWNED, owner: { kind: 'application', application: 'storefront' } }],
        }),
      ).toThrow(/as owned by the storefront application/);
    });

    it('names the module and the variable, so the author knows which entry to move', () => {
      let message = '';
      try {
        manifest({ id: 'fixture_env', env: [{ ...OWNED, owner: { kind: 'platform' } }] });
      } catch (error: unknown) {
        message = String(error);
      }
      expect(message).toContain('fixture_env');
      expect(message).toContain('FIXTURE_API_TOKEN');
    });

    it('still refuses the schema’s own violations — a `describes` missing a shipped language', () => {
      expect(() =>
        manifest({
          id: 'fixture_env',
          env: [{ ...OWNED, describes: { en: 'Only English.' } } as unknown as EnvironmentInput],
        }),
      ).toThrow();
    });
  });
});
