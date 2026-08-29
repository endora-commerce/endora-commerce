import { describe, expect, it } from 'vitest';
import { resolvedManifestEntries } from '../../../src/lifecycle/registered-manifests.js';
import { CHAIN_ROUTING_ANSWERS } from '../../fixtures/error-code-routing/chain-answers.js';
import {
  describeMigrationGaps,
  EmptyMigrationScopeError,
  findMigrationGaps,
} from '../../helpers/error-code-routing.js';

/**
 * Feature 090 Phase 3 — **a migrated module has migrated completely.**
 *
 * `specs/090-module-owned-error-codes/contracts/error-code-declaration.md` §6.4
 * makes the migration one merge request per owning module, and
 * `error-code-routing-equality.test.ts` is what each of those merge requests is
 * measured by. That harness compares the map the composition roots inject to the
 * frozen chain capture, and it is exactly right about what it measures — but the
 * injected map is `composeErrorTranslationTargets`, the declarations laid *over*
 * the chain (§6.7), so **it cannot see an incomplete migration**. A module that
 * declares ten of the thirteen codes it owns still produces a composed map that
 * answers correctly for all thirteen: the chain covers the other three. The
 * harness reports nothing, the merge request is green, and the shortfall arrives
 * on the merge request that deletes the chain, as three codes that route
 * nowhere and one reviewer with eighteen merge requests to re-read.
 *
 * This file closes that. For every module on the roster below, the codes its
 * manifest declares are **exactly** the codes the frozen capture routes to it,
 * in both directions.
 *
 * **The roster is the Phase 3 progress ledger.** Adding a module to it is the
 * one line each migration merge request adds here; the ratchet below refuses a
 * module that declares codes without being on it, so the roster cannot drift
 * behind the manifests. When it holds all eighteen, Phase 3 is complete and the
 * chain can go — and this file becomes the standing proof that the deletion
 * loses nothing.
 *
 * `specs/090-module-owned-error-codes/migration-runbook.md` is the procedure the
 * roster is filled in by.
 */
const MIGRATED_MODULES: readonly string[] = [
  'assets_library',
  'blog',
  'carts',
  'catalog',
  'cms',
  'inventory',
  'invoices',
  'megamenu',
  'mfa',
  'quote_requests',
  'sales_channels',
  'search',
  'settings',
];

describe('feature 090 Phase 3 — each migrated module declares exactly what it owns', () => {
  /**
   * The red proofs, first and over fixtures handed to the predicate whole
   * (`AGENTS.md`, issue #130), so each finding is shown working on input that
   * enters above the analysis rather than on a value the tree computes.
   */
  describe('the completeness predicate can go red — one proof per gap it reports', () => {
    const capture = { A_CODE: 'inventory', B_CODE: 'inventory', C_CODE: 'catalog' };

    it('reports `undeclared` for a code the capture routes to the module and the manifest omits', () => {
      expect(findMigrationGaps('inventory', ['A_CODE'], capture)).toEqual([
        { code: 'B_CODE', kind: 'undeclared', chainAnswer: 'inventory' },
      ]);
    });

    it('reports `not-owned`, naming the real owner, for a code another module owns', () => {
      expect(findMigrationGaps('inventory', ['A_CODE', 'B_CODE', 'C_CODE'], capture)).toEqual([
        { code: 'C_CODE', kind: 'not-owned', chainAnswer: 'catalog' },
      ]);
    });

    it('reports `not-owned` with no owner for a code the capture does not hold at all', () => {
      expect(findMigrationGaps('inventory', ['A_CODE', 'B_CODE', 'D_CODE'], capture)).toEqual([
        { code: 'D_CODE', kind: 'not-owned', chainAnswer: null },
      ]);
    });

    it('reports nothing for a module that declares exactly what it owns', () => {
      expect(findMigrationGaps('inventory', ['B_CODE', 'A_CODE'], capture)).toEqual([]);
    });

    it('refuses a module the capture routes nothing to, rather than calling it complete', () => {
      expect(() => findMigrationGaps('not_a_module', [], capture)).toThrow(
        EmptyMigrationScopeError,
      );
    });

    it('names every gap in the words the migrating merge request needs', () => {
      const described = describeMigrationGaps(
        'inventory',
        findMigrationGaps('inventory', ['A_CODE', 'C_CODE'], capture),
      );
      expect(described).toContain(
        '[undeclared] B_CODE: the chain routes it to inventory and the manifest does not declare it',
      );
      expect(described).toContain(
        '[not-owned] C_CODE: inventory declares it and the chain routes it to catalog',
      );
    });
  });

  describe('the tree', () => {
    it('the roster is non-empty — there is a migration to be complete about', () => {
      expect(MIGRATED_MODULES.length).toBeGreaterThan(0);
    });

    it.each(MIGRATED_MODULES)(
      '%s declares exactly the codes the frozen capture routes to it',
      async (moduleId) => {
        const entries = await resolvedManifestEntries();
        const entry = entries.find((candidate) => candidate.manifest.id === moduleId);
        expect(entry, `${moduleId} is on the Phase 3 roster and is not a registered module`).toBeDefined();

        const declared = (entry?.manifest.errorCodes ?? []).map(
          (declaration) => declaration.code,
        );
        const gaps = findMigrationGaps(moduleId, declared, CHAIN_ROUTING_ANSWERS);
        expect(
          gaps,
          gaps.length === 0
            ? ''
            : `${moduleId}'s error-code migration is not answer-preserving. The frozen ` +
              'capture is the reference and it is not edited by a migration ' +
              '(specs/090-module-owned-error-codes/migration-runbook.md):\n' +
              describeMigrationGaps(moduleId, gaps),
        ).toEqual([]);
      },
    );

    /**
     * The other direction, and the reason the roster cannot quietly fall behind:
     * a module that declares codes without being listed above is a migration
     * nothing measures for completeness. The list is one line per merge request;
     * this is what makes forgetting it fail rather than pass.
     */
    it('no module declares an error code without being on the roster', async () => {
      const entries = await resolvedManifestEntries();
      const declaring = entries
        .filter((entry) => (entry.manifest.errorCodes ?? []).length > 0)
        .map((entry) => entry.manifest.id)
        .sort();
      expect(declaring).toEqual([...MIGRATED_MODULES].sort());
    });
  });
});
