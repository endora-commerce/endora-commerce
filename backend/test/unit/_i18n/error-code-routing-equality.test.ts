import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  ERROR_TRANSLATION_KEYS,
  composeErrorTranslationTargets,
} from '@endora-commerce/mod-i18n/backend';
import { resolvedManifestEntries } from '../../../src/lifecycle/registered-manifests.js';
import {
  CHAIN_ANSWERS_AS_MODULE_IDS,
  CHAIN_ROUTING_ANSWERS,
} from '../../fixtures/error-code-routing/chain-answers.js';
import {
  compareErrorCodeRouting,
  describeRoutingDifferences,
  EmptyRoutingComparisonError,
  type RoutingAnswers,
} from '../../helpers/error-code-routing.js';

/**
 * Feature 090 Phase 0 — the equality harness, before anything moves.
 *
 * `specs/090-module-owned-error-codes/plan.md`: *"A test that computes, for
 * every code in `ERROR_CODES`, the answer `moduleIdForErrorCode` gives. This is
 * the artefact that permits Phase 3 and it must exist while the function still
 * does."*
 *
 * Two halves, and the order matters. The **red proofs** come first: they drive
 * the comparison over maps handed to it whole, so every difference kind and both
 * vacuity refusals are shown working on a fixture that enters at the top of the
 * analysis (`AGENTS.md`, issue #130) rather than on a value the harness
 * normally computes. Only then is the comparison pointed at the tree.
 *
 * What the tree half asserts is **not** "the chain agrees with itself". It is
 * that the live chain agrees with a frozen capture of what the chain said at
 * `49f3c6817`, over the whole of `ERROR_CODES` and in both directions. That
 * capture is what the Phase 3 merge requests will be measured against once the
 * chain is gone, so its accuracy has to be established while there is still
 * something to establish it from.
 *
 * **A third block landed with Phase 2** and is the one the migration is actually
 * measured by: the same comparison, over the map the composition roots inject —
 * `composeErrorTranslationTargets(resolvedManifestEntries())`, the declarations
 * laid over the chain. The chain half above stays, because the two answer
 * different questions: one says the incumbent has not moved, the other says the
 * thing serving requests still agrees with it.
 */
describe('error-code routing equality harness (feature 090, Phases 0 and 2)', () => {
  describe('the comparison can go red — one proof per difference it reports', () => {
    it('reports `unrouted` for a code the reference routes and the candidate does not', () => {
      const differences = compareErrorCodeRouting(
        { A_CODE: 'catalog', B_CODE: 'orders' },
        { A_CODE: 'catalog' },
      );
      expect(differences).toEqual([
        { code: 'B_CODE', kind: 'unrouted', expected: 'orders', actual: null },
      ]);
    });

    it('reports `unexpected` for a code the candidate routes and the reference does not', () => {
      const differences = compareErrorCodeRouting(
        { A_CODE: 'catalog' },
        { A_CODE: 'catalog', B_CODE: 'orders' },
      );
      expect(differences).toEqual([
        { code: 'B_CODE', kind: 'unexpected', expected: null, actual: 'orders' },
      ]);
    });

    it('reports `rerouted` for a code both route, to different modules', () => {
      const differences = compareErrorCodeRouting(
        { A_CODE: 'catalog' },
        { A_CODE: 'search' },
      );
      expect(differences).toEqual([
        { code: 'A_CODE', kind: 'rerouted', expected: 'catalog', actual: 'search' },
      ]);
    });

    it('reports nothing for two maps that agree', () => {
      expect(compareErrorCodeRouting({ A_CODE: 'catalog' }, { A_CODE: 'catalog' })).toEqual([]);
    });

    it('refuses an empty reference rather than reporting a vacuous equality', () => {
      expect(() => compareErrorCodeRouting({}, { A_CODE: 'catalog' })).toThrow(
        EmptyRoutingComparisonError,
      );
    });

    it('refuses an empty candidate rather than reporting a vacuous equality', () => {
      expect(() => compareErrorCodeRouting({ A_CODE: 'catalog' }, {})).toThrow(
        EmptyRoutingComparisonError,
      );
    });

    it('names every difference in the words a migration reviewer needs', () => {
      const described = describeRoutingDifferences(
        compareErrorCodeRouting({ A_CODE: 'catalog' }, { A_CODE: 'search', B_CODE: 'orders' }),
      );
      expect(described).toContain('[rerouted] A_CODE: chain said catalog, declarations say search');
      expect(described).toContain('[unexpected] B_CODE: chain said nothing, declarations say orders');
    });
  });

  describe('the tree — the frozen reference against the live chain', () => {
    const live: RoutingAnswers = Object.fromEntries(
      Object.entries(ERROR_TRANSLATION_KEYS).map(([code, target]) => [code, target.moduleId]),
    );

    it('covers every member of ERROR_CODES, with no exception list', () => {
      const enumerated = Object.values(ERROR_CODES);
      expect(enumerated.length).toBeGreaterThan(0);
      // Three sizes that have to be one number: what the platform enumerates,
      // what the chain routes, and what the frozen capture records. The number
      // itself is deliberately not written down here (D-100) — it grows with
      // every code a module adds, and a literal would be the first thing to go
      // stale.
      expect(Object.keys(live)).toHaveLength(enumerated.length);
      expect(Object.keys(CHAIN_ROUTING_ANSWERS)).toHaveLength(enumerated.length);
      expect(Object.keys(CHAIN_ROUTING_ANSWERS).sort()).toEqual([...enumerated].sort());
    });

    it('the live chain answers exactly what the frozen capture records', () => {
      const differences = compareErrorCodeRouting(CHAIN_ROUTING_ANSWERS, live);
      expect(
        differences,
        differences.length === 0
          ? ''
          : 'the routing answer moved. If that was deliberate, say so in the merge ' +
            'request and edit test/fixtures/error-code-routing/chain-answers.ts in the ' +
            'same commit — it is the reference feature 090 Phase 3 is measured ' +
            `against:\n${describeRoutingDifferences(differences)}`,
      ).toEqual([]);
    });

    it('the frozen capture names only modules the chain actually reaches', () => {
      const referenced = new Set(Object.values(CHAIN_ROUTING_ANSWERS));
      const reached = new Set(Object.values(live));
      expect([...referenced].sort()).toEqual([...reached].sort());
    });
  });

  /**
   * Phase 2 — **the derivation beside the chain, asserted equal**.
   *
   * The block above measures the chain against its own frozen capture. This one
   * measures what the composition roots actually inject: the map
   * `composeErrorTranslationTargets` builds out of the **resolved manifest set**,
   * which is the modules' declarations laid over that chain
   * (`contracts/error-code-declaration.md` §4, and the transitional shape §6.4's
   * per-module delivery requires).
   *
   * It is the same predicate, over the same reference, in both directions — so
   * from the first migrated module onwards a declaration that disagrees with the
   * chain is reported as `rerouted` on the merge request that writes it, rather
   * than as one of eighteen surprises on the merge request that deletes the
   * chain.
   *
   * **It cannot pass vacuously**, and there are two distinct ways it could. The
   * comparison's own refusals cover the first: an empty reference and an empty
   * candidate are each thrown on rather than reported as agreement
   * (`EmptyRoutingComparisonError`, proved over fixtures above — this block reuses
   * them rather than growing a second pair). The second is one layer in and
   * belongs here: the composed map is the chain plus the declarations, so an
   * **empty manifest set** produces a full, correct-looking map that says nothing
   * whatever about the derivation. That population is asserted first, before any
   * claim rests on it.
   */
  describe(`the composed map — the chain plus the declarations, over all ${
    Object.values(ERROR_CODES).length
  } codes`, () => {
    it('the resolved manifest set is non-empty — the derivation is asked a real question', async () => {
      const entries = await resolvedManifestEntries();
      expect(entries.length).toBeGreaterThan(0);
    });

    it(`covers every one of the ${Object.values(ERROR_CODES).length} enumerated codes`, async () => {
      const { targets } = composeErrorTranslationTargets(await resolvedManifestEntries());
      const enumerated = Object.values(ERROR_CODES);

      for (const code of enumerated) {
        expect(targets[code], `${code} is routed by neither the chain nor a declaration`).toBeDefined();
      }
      // The count is derived on both sides rather than written down (D-100): it
      // grows with every code a module adds, and the composed map may hold more
      // than the enumeration once a module declares a code `ERROR_CODES` does
      // not hold — which is the whole point of the derivation.
      expect(Object.keys(targets).length).toBeGreaterThanOrEqual(enumerated.length);
    });

    it('answers exactly what the frozen chain capture records, in both directions', async () => {
      const { targets, collisions } = composeErrorTranslationTargets(
        await resolvedManifestEntries(),
      );
      const composed: RoutingAnswers = Object.fromEntries(
        Object.entries(targets).map(([code, target]) => [code, target.moduleId]),
      );

      // `CHAIN_ANSWERS_AS_MODULE_IDS`, not the raw capture: the composed map is
      // keyed by the **declaring module's id**, and one of the capture's
      // eighteen answers — `core` — is a bundle namespace rather than a module
      // id. Reconciling the two vocabularies at the capture's edge is what
      // keeps the platform block's 100 declarations from reading as 100
      // `rerouted` differences, without editing the reference
      // (`chain-answers.ts`'s `CHAIN_ANSWER_ALIASES`, and
      // `specs/090-module-owned-error-codes/core-block-home.md` §4(d)). The
      // block above still compares the **raw** capture to the live chain,
      // because the chain genuinely answers `core`.
      const differences = compareErrorCodeRouting(CHAIN_ANSWERS_AS_MODULE_IDS, composed);
      expect(
        differences,
        differences.length === 0
          ? ''
          : 'the map the composition roots inject no longer answers what the prefix ' +
            'chain answers. Feature 090 is answer-preserving over the whole of ' +
            'ERROR_CODES with no exception list (FR-041), so a module has declared a ' +
            'code that is not the one the chain routed to it, or has declared a code ' +
            'another module owns. Fix the declaration; do not edit the frozen ' +
            `capture:\n${describeRoutingDifferences(differences)}`,
      ).toEqual([]);
      // The other half of the same call. A collision would show up above as an
      // `unrouted` code, but only for a code the chain also routes — a contested
      // code neither the chain nor the enumeration holds is invisible to the
      // comparison and is exactly the case §3.1 rules 1-4 exist for.
      expect(collisions).toEqual([]);
    });

    it('routes every declared code to its declaring module, or reports it contested', async () => {
      const entries = await resolvedManifestEntries();
      const { targets, collisions } = composeErrorTranslationTargets(entries);
      const contested = new Set(collisions.map((collision) => collision.code));

      // Vacuous while no module has migrated, and deliberately written now: it
      // is the assertion that stops being vacuous on the first Phase 3 merge
      // request, which is the merge request that needs it.
      for (const entry of entries) {
        for (const declaration of entry.manifest.errorCodes ?? []) {
          if (contested.has(declaration.code)) continue;
          expect(
            targets[declaration.code],
            `${entry.manifest.id} declares ${declaration.code} and nothing routes it there`,
          ).toEqual({
            moduleId: entry.manifest.id,
            key: `errors.${declaration.code}`,
          });
        }
      }
    });
  });
});
