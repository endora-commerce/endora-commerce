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

/**
 * T3-A's own "done when": a module's `env` is readable from an **installed**
 * package's built manifest.
 *
 * The declarations the estate is reconciled against are read out of source text
 * (D-164), and that is right for a check running in this checkout. It says
 * nothing about the thing this feature exists for, which is a module a client
 * *installed*: such a module ships `dist` and no source at all, and its manifest
 * reaches a client only if the field survives the build and the `exports` map.
 *
 * So this reaches it the way a consumer does — a **bare specifier**, resolved
 * through the package's own `exports` map at its build output — rather than by
 * reading a file. A relative path into `dist` would prove the compiler emitted
 * something and leave the question of whether anybody can name it, which is the
 * half that actually fails (`ERR_PACKAGE_PATH_NOT_EXPORTED` at the first
 * consumer).
 *
 * One module, as an existence proof of the mechanism. Which modules declare what
 * is `check:env-inputs`' question and is derived there; asserting the population
 * here as well would be two answers waiting to disagree (D-100).
 */
describe('a module’s `env` survives into its published manifest', () => {
  // Two packages rather than one, and not as belt and braces: one package's
  // `dist` carrying the field could be a fact about how that package happens to
  // build. Two, declaring differently — `search`'s is `required` and `pwa`'s is
  // `optional` with a consequence — is a fact about the mechanism. It is also
  // what keeps this file out of `check:test-ownership`'s `misplaced-test`, and
  // correctly so: a file naming exactly one module is that module's test and
  // belongs beside its subject, and this one is `defineModuleManifest`'s.
  const cases = [
    { specifier: '@endora-commerce/mod-search', moduleId: 'search', name: 'MEILISEARCH_URL' },
    { specifier: '@endora-commerce/mod-pwa', moduleId: 'pwa', name: 'PWA_VAPID_SUBJECT' },
  ] as const;

  it.each(cases)('is readable through $specifier’s own `exports` map', async (entry) => {
    const { manifest } = (await import(entry.specifier)) as { manifest: ModuleManifest };
    const declared = manifest.env ?? [];
    const found = declared.find((candidate) => candidate.name === entry.name);
    expect(found, `${entry.moduleId} declared: ${declared.map((e) => e.name).join(', ')}`)
      .toBeDefined();
    expect(found?.owner).toEqual({ kind: 'module', moduleId: entry.moduleId });
    // Both shipped languages, on the declaration itself: the first reader is a
    // CLI on a client's machine, which loads no `_i18n` reconciler and has no
    // settings store to ask.
    expect(found?.describes.en.length).toBeGreaterThan(0);
    expect(found?.describes.pl.length).toBeGreaterThan(0);
  });
});
