import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { buildErrorTranslationTargets } from '@endora-commerce/mod-i18n/backend';
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
 * Feature 090 — the equality harness, now that the chain is gone.
 *
 * It began as Phase 0's artefact: *"a test that computes, for every code in
 * `ERROR_CODES`, the answer `moduleIdForErrorCode` gives"*, written so that the
 * migration had a reference it could be measured against. Phase 4 deleted the
 * function, so the block that compared the **live chain** to the frozen capture
 * of it went with the chain — there is nothing live left to compare. The capture
 * stays exactly where it was, and it is now the only record of what the chain
 * said.
 *
 * Two halves, and the order matters. The **red proofs** come first: they drive
 * the comparison over maps handed to it whole, so every difference kind and both
 * vacuity refusals are shown working on a fixture that enters at the top of the
 * analysis (`AGENTS.md`, issue #130) rather than on a value the harness normally
 * computes. Only then is the comparison pointed at the tree.
 *
 * The tree half is the one the migration was measured by and the one that keeps
 * the deletion honest: the same comparison, over the map the composition roots
 * actually inject — `buildErrorTranslationTargets(resolvedManifestEntries())`,
 * which is nothing but the modules' own declarations — against the frozen
 * capture, over the whole of `ERROR_CODES` and in both directions. A green here
 * is the standing proof that deleting the chain moved no operator-visible
 * sentence.
 */
describe('error-code routing equality harness (feature 090)', () => {
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

  /**
   * The frozen capture, against the platform's own enumeration.
   *
   * It used to sit inside the live-chain block and compare three sizes: what
   * `ERROR_CODES` enumerates, what the chain routed, and what the capture
   * records. Two of the three are gone with the chain; the third is still worth
   * asserting, because the capture is the reference every remaining claim in
   * this file and in `error-code-migration-progress.test.ts` rests on, and a
   * capture that has drifted from the enumeration is a reference that answers
   * for a population nobody has.
   */
  describe('the frozen capture', () => {
    it('covers every member of ERROR_CODES, with no exception list', () => {
      const enumerated = Object.values(ERROR_CODES);
      expect(enumerated.length).toBeGreaterThan(0);
      // The number itself is deliberately not written down here (D-100) — it
      // grows with every code a module adds, and a literal would be the first
      // thing to go stale.
      expect(Object.keys(CHAIN_ROUTING_ANSWERS)).toHaveLength(enumerated.length);
      expect(Object.keys(CHAIN_ROUTING_ANSWERS).sort()).toEqual([...enumerated].sort());
    });
  });

  /**
   * **The derived map, asserted equal to the frozen capture.**
   *
   * This measures what the composition roots inject: the map
   * `buildErrorTranslationTargets` builds out of the **resolved manifest set**,
   * which since Phase 4 is nothing but the modules' own declarations
   * (`contracts/error-code-declaration.md` §4).
   *
   * It is the same predicate, over the same reference, in both directions. While
   * the migration was in flight it caught a declaration that disagreed with the
   * chain on the merge request that wrote it, rather than as one of eighteen
   * surprises on the merge request that deleted the chain; now the chain is gone
   * it is the standing proof that the deletion took no answer with it.
   *
   * **It cannot pass vacuously**, and there are two distinct ways it could. The
   * comparison's own refusals cover the first: an empty reference and an empty
   * candidate are each thrown on rather than reported as agreement
   * (`EmptyRoutingComparisonError`, proved over fixtures above — this block reuses
   * them rather than growing a second pair). The second is one layer in and
   * belongs here: an **empty manifest set** now yields an empty map, which the
   * comparison refuses — but a *short* one would yield a short map, so the
   * population is asserted first, before any claim rests on it.
   */
  describe(`the derived map — the declarations alone, over all ${
    Object.values(ERROR_CODES).length
  } codes`, () => {
    it('the resolved manifest set is non-empty — the derivation is asked a real question', async () => {
      const entries = await resolvedManifestEntries();
      expect(entries.length).toBeGreaterThan(0);
    });

    it(`covers every one of the ${Object.values(ERROR_CODES).length} enumerated codes`, async () => {
      const { targets } = buildErrorTranslationTargets(await resolvedManifestEntries());
      const enumerated = Object.values(ERROR_CODES);

      for (const code of enumerated) {
        expect(targets[code], `no module declares ${code}, so it routes nowhere`).toBeDefined();
      }
      // The count is derived on both sides rather than written down (D-100): it
      // grows with every code a module adds, and the composed map may hold more
      // than the enumeration once a module declares a code `ERROR_CODES` does
      // not hold — which is the whole point of the derivation.
      expect(Object.keys(targets).length).toBeGreaterThanOrEqual(enumerated.length);
    });

    it('answers exactly what the frozen chain capture records, in both directions', async () => {
      const { targets, collisions } = buildErrorTranslationTargets(
        await resolvedManifestEntries(),
      );
      const composed: RoutingAnswers = Object.fromEntries(
        Object.entries(targets).map(([code, target]) => [code, target.moduleId]),
      );

      // `CHAIN_ANSWERS_AS_MODULE_IDS`, not the raw capture: the derived map is
      // keyed by the **declaring module's id**, and one of the capture's
      // eighteen answers — `core` — is a bundle namespace rather than a module
      // id. Reconciling the two vocabularies at the capture's edge is what
      // keeps the platform block's 100 declarations from reading as 100
      // `rerouted` differences, without editing the reference
      // (`chain-answers.ts`'s `CHAIN_ANSWER_ALIASES`, and
      // `specs/090-module-owned-error-codes/core-block-home.md` §4(d)). The
      // alias lives at the capture's edge because the capture is the only thing
      // left that speaks the chain's vocabulary.
      const differences = compareErrorCodeRouting(CHAIN_ANSWERS_AS_MODULE_IDS, composed);
      expect(
        differences,
        differences.length === 0
          ? ''
          : 'the map the composition roots inject no longer answers what the prefix ' +
            'chain answered. Feature 090 is answer-preserving over the whole of ' +
            'ERROR_CODES with no exception list (FR-041), so a module has declared a ' +
            'code that is not the one the chain routed to it, or has declared a code ' +
            'another module owns. Fix the declaration; do not edit the frozen ' +
            `capture:\n${describeRoutingDifferences(differences)}`,
      ).toEqual([]);
      // The other half of the same call. A collision would show up above as an
      // `unrouted` code, but only for a code the capture also holds — a
      // contested code the enumeration does not hold is invisible to the
      // comparison and is exactly the case §3.1 rules 1-4 exist for.
      expect(collisions).toEqual([]);
    });

    it('routes every declared code to its declaring module, or reports it contested', async () => {
      const entries = await resolvedManifestEntries();
      const { targets, collisions } = buildErrorTranslationTargets(entries);
      const contested = new Set(collisions.map((collision) => collision.code));

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
