import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { ERROR_TRANSLATION_KEYS } from '@endora-commerce/mod-i18n/backend';
import { CHAIN_ROUTING_ANSWERS } from '../../fixtures/error-code-routing/chain-answers.js';
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
 */
describe('error-code routing equality harness (feature 090, Phase 0)', () => {
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
});
