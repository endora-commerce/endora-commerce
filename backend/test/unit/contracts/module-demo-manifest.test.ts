import { describe, expect, it } from 'vitest';
import {
  defineModuleManifest,
  ModuleDemoDeclarationSchema,
  type DemoResetResult,
  type DemoSeedResult,
  type ModuleDemoManifest,
  type ModuleManifest,
} from '@endora-commerce/contracts';

/**
 * Feature 113 Phase 0 — `contracts/module-demo-data-layer.md` §1, the
 * declaration and the one layer that can judge it without an instance.
 *
 * `defineModuleManifest` sees **one** manifest, on the author's own machine, at
 * import time, with no database. Everything §1 can be decided from that, it
 * decides here: the three states (§1.2), the shape (§1.3), and the two
 * `after` declarations that cannot mean anything (§4.3–§4.4).
 *
 * Every proof below hands `defineModuleManifest` a whole manifest object — the
 * top of the analysis, which is where a red proof has to enter (`AGENTS.md`,
 * issue #130). None of them reaches past it into the assertion function, because
 * a fixture that enters below the classifier cannot catch a classifier that
 * stopped running.
 */
function manifest(overrides: Partial<ModuleManifest> & { id: string }): ModuleManifest {
  return defineModuleManifest({
    name: 'Fixture module',
    version: '1.0.0',
    dependencies: [],
    ...overrides,
  } as ModuleManifest);
}

/** A well-formed in-module declaration, in the shape §1.4 requires of a real one. */
function demoDeclaration(
  overrides: Partial<ModuleDemoManifest> = {},
): ModuleDemoManifest {
  return {
    summary: 'A demo warehouse and two stock levels.',
    seed: async (): Promise<DemoSeedResult> => ({ created: [{ entity: 'Warehouse', count: 1 }] }),
    reset: async (): Promise<DemoResetResult> => ({ removed: [{ entity: 'Warehouse', count: 1 }] }),
    ...overrides,
  };
}

describe('defineModuleManifest — demo declaration (feature 113, contract §1)', () => {
  describe('the three states (§1.2)', () => {
    it('accepts a manifest that declares nothing — nobody has decided', () => {
      expect(manifest({ id: 'fixture_demo' }).demo).toBeUndefined();
    });

    it('accepts `demo: false` — a decision that this module has nothing to demonstrate', () => {
      expect(manifest({ id: 'fixture_demo', demo: false }).demo).toBe(false);
    });

    it('accepts a declaration and keeps the two bodies callable', async () => {
      const parsed = manifest({ id: 'fixture_demo', demo: demoDeclaration() }).demo;
      expect(parsed).not.toBe(false);
      expect(parsed).toBeDefined();
      const declaration = parsed as ModuleDemoManifest;
      // The schema must pass the functions through by reference: a `parse` that
      // dropped or copied them would leave a declaration the runner cannot run.
      await expect(declaration.seed({ ctx: undefined as never })).resolves.toEqual({
        created: [{ entity: 'Warehouse', count: 1 }],
      });
      await expect(declaration.reset({ ctx: undefined as never })).resolves.toEqual({
        removed: [{ entity: 'Warehouse', count: 1 }],
      });
    });

    it('keeps absent and `false` distinguishable after parsing', () => {
      // The whole of §1.2: a check downstream asks `demo === undefined` against
      // `demo === false`, so a schema that defaulted one into the other would
      // make the two states one.
      expect(manifest({ id: 'fixture_demo' }).demo).toBeUndefined();
      expect(manifest({ id: 'fixture_demo', demo: false }).demo).not.toBeUndefined();
    });
  });

  describe('the shape (§1.3)', () => {
    it('refuses a declaration with no `seed`', () => {
      const { seed: _seed, ...withoutSeed } = demoDeclaration();
      expect(() =>
        manifest({ id: 'fixture_demo', demo: withoutSeed as ModuleDemoManifest }),
      ).toThrow(/demo/i);
    });

    it('refuses a declaration with no `reset`', () => {
      const { reset: _reset, ...withoutReset } = demoDeclaration();
      expect(() =>
        manifest({ id: 'fixture_demo', demo: withoutReset as ModuleDemoManifest }),
      ).toThrow(/demo/i);
    });

    it('refuses a `seed` that is not a function', () => {
      expect(() =>
        manifest({
          id: 'fixture_demo',
          demo: demoDeclaration({ seed: './backend/demo/seed.js' as never }),
        }),
      ).toThrow(/demo/i);
    });

    it('refuses a declaration with no `summary`', () => {
      const { summary: _summary, ...withoutSummary } = demoDeclaration();
      expect(() =>
        manifest({ id: 'fixture_demo', demo: withoutSummary as ModuleDemoManifest }),
      ).toThrow(/demo/i);
    });

    it('refuses an empty `summary` — the runner prints it per module (§3.7)', () => {
      expect(() =>
        manifest({ id: 'fixture_demo', demo: demoDeclaration({ summary: '' }) }),
      ).toThrow(/demo/i);
    });

    it('refuses a value that is neither an object nor `false`', () => {
      expect(() => manifest({ id: 'fixture_demo', demo: true as never })).toThrow(/demo/i);
    });
  });

  describe('the advisory `after` list (§4.3)', () => {
    it('accepts module ids this demo prefers to run after', () => {
      const parsed = manifest({
        id: 'fixture_demo',
        demo: demoDeclaration({ after: ['catalog', 'inventory'] }),
      }).demo as ModuleDemoManifest;
      expect(parsed.after).toEqual(['catalog', 'inventory']);
    });

    it('accepts an `after` naming a module that is not installed (§4.4)', () => {
      // Nothing here knows the installed set, and §4.4 says such an entry
      // orders nothing and is not a finding. The refusal that would be wrong
      // is one keyed on "is this module in the repository".
      expect(() =>
        manifest({ id: 'fixture_demo', demo: demoDeclaration({ after: ['not_installed_here'] }) }),
      ).not.toThrow();
    });

    it('refuses an `after` naming the declaring module itself', () => {
      expect(() =>
        manifest({ id: 'fixture_demo', demo: demoDeclaration({ after: ['fixture_demo'] }) }),
      ).toThrow(/itself/i);
    });

    it('refuses the same module named twice', () => {
      expect(() =>
        manifest({
          id: 'fixture_demo',
          demo: demoDeclaration({ after: ['catalog', 'catalog'] }),
        }),
      ).toThrow(/twice/i);
    });

    it('refuses an id the module-id grammar cannot express', () => {
      expect(() =>
        manifest({ id: 'fixture_demo', demo: demoDeclaration({ after: ['Catalog'] }) }),
      ).toThrow(/demo/i);
    });

    it('does not put the named module in `dependencies` (§2.3, FR-005)', () => {
      const m = manifest({
        id: 'fixture_demo',
        demo: demoDeclaration({ after: ['catalog'] }),
      });
      expect(m.dependencies).toEqual([]);
      expect(m.acknowledgedDependencies).toBeUndefined();
      expect(m.nonBindingDependencies).toBeUndefined();
    });
  });

  describe('the schema on its own', () => {
    it('parses `false`', () => {
      expect(ModuleDemoDeclarationSchema.parse(false)).toBe(false);
    });

    it('refuses an unknown key rather than carrying it', () => {
      const parsed = ModuleDemoDeclarationSchema.parse({
        ...demoDeclaration(),
        installer: '@endora-commerce/mod-fixture-installer',
      });
      expect(parsed).not.toBe(false);
      expect(Object.keys(parsed as object)).not.toContain('installer');
    });

    it('carries `package`, the escape hatch (§6.1, feature 113 T235)', () => {
      // **This assertion is the inverse of the one Phase 0 wrote**, and the
      // premise moved rather than the rule. That test read *"`package` is
      // designed (§6) and deliberately not implemented in Phase 0 — a stripped
      // key is what says so"*, which was exactly right while the field did not
      // exist; T235 takes it, so a stripped key would now be the schema
      // silently dropping a declaration an author wrote. The unknown-key rule
      // it was standing in for is asserted above, over a key nothing declares.
      //
      // The **runner** half of §6 is not built — `packages/platform/src/demo/`
      // does not resolve the name — so the field records an intent and changes
      // no behaviour today. `check:demo-data-budget` reads it, as an
      // over-budget module's remedy (§7.6).
      const parsed = ModuleDemoDeclarationSchema.parse({
        ...demoDeclaration(),
        package: '@endora-commerce/mod-fixture-demo',
      });
      expect(parsed).not.toBe(false);
      expect((parsed as { package?: string }).package).toBe(
        '@endora-commerce/mod-fixture-demo',
      );
    });
  });
});
