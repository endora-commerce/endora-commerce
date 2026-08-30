import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { buildErrorTranslationTargets } from '@endora-commerce/mod-i18n/backend';
import { resolvedManifestEntries } from '../../../src/lifecycle/registered-manifests.js';
import {
  CHAIN_ANSWERS_AS_MODULE_IDS,
  CHAIN_ROUTING_ANSWERS,
} from '../../fixtures/error-code-routing/chain-answers.js';
import { MINTED_ERROR_CODES } from '../../fixtures/error-code-routing/reference-ledgers.js';
import {
  compareErrorCodeRouting,
  describeRoutingDifferences,
  EmptyLedgerReferenceError,
  EmptyRoutingComparisonError,
  intendedRouting,
  type ReferenceLedgers,
  type RoutingAnswers,
} from '../../helpers/error-code-routing.js';

/** The declared addends of the reference side, as every reader takes them. */
const LEDGERS: ReferenceLedgers = { minted: MINTED_ERROR_CODES };

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
 *
 * **A code minted after the chain was deleted is outside that claim's subject**,
 * and saying so is what this file's reference side gained with
 * `test/fixtures/error-code-routing/reference-ledgers.ts`. FR-041 is about the
 * answers the chain *gave*; a code created afterwards has none to preserve. So
 * the comparison still runs over the capture's own key set — the capture is
 * neither re-frozen nor relaxed to a subset check, either of which would make
 * this harness stop being able to say what the chain did — and the boundary is
 * asserted in both directions instead: nothing in `ERROR_CODES` is unaccounted
 * for, and nothing the ledger declares is in the capture.
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
   * **The reference side, `capture ⊕ minted`** — red proofs over maps handed to
   * the overlay whole (issue #130) rather than over the tree's own capture and
   * ledger, which are the values the blocks below consume.
   */
  describe('the minting ledger, applied to the reference side', () => {
    const capture: RoutingAnswers = { A_CODE: '_i18n', B_CODE: '_i18n' };
    const minted: ReferenceLedgers = {
      minted: {
        NEW_CODE: {
          to: 'payments',
          reason: 'A fixture entry, so the overlay is measured on input that enters above it.',
        },
      },
    };
    const empty: ReferenceLedgers = { minted: {} };

    it('adds a minted code the capture cannot hold, and moves no other answer', () => {
      expect(intendedRouting(capture, minted)).toEqual({
        A_CODE: '_i18n',
        B_CODE: '_i18n',
        NEW_CODE: 'payments',
      });
    });

    it('is byte-identical to the capture while the ledger is empty', () => {
      expect(intendedRouting(capture, empty)).toEqual(capture);
    });

    it('refuses an empty capture rather than building a reference out of nothing', () => {
      expect(() => intendedRouting({}, minted)).toThrow(EmptyLedgerReferenceError);
    });

    it('reports `unexpected` for a minted code nobody ledgered', () => {
      expect(
        compareErrorCodeRouting(intendedRouting(capture, empty), {
          A_CODE: '_i18n',
          B_CODE: '_i18n',
          NEW_CODE: 'payments',
        }),
      ).toEqual([{ code: 'NEW_CODE', kind: 'unexpected', expected: null, actual: 'payments' }]);
    });

    it('reports `unrouted` for a ledgered code no module declares', () => {
      expect(
        compareErrorCodeRouting(intendedRouting(capture, minted), {
          A_CODE: '_i18n',
          B_CODE: '_i18n',
        }),
      ).toEqual([{ code: 'NEW_CODE', kind: 'unrouted', expected: 'payments', actual: null }]);
    });

    it('still reports `rerouted` for a code the chain answered for that has moved', () => {
      expect(
        compareErrorCodeRouting(intendedRouting(capture, minted), {
          A_CODE: 'price_lists',
          B_CODE: '_i18n',
          NEW_CODE: 'payments',
        }),
      ).toEqual([{ code: 'A_CODE', kind: 'rerouted', expected: '_i18n', actual: 'price_lists' }]);
    });

    it('reports nothing when the ledger and the declarations agree', () => {
      expect(
        compareErrorCodeRouting(intendedRouting(capture, minted), {
          A_CODE: '_i18n',
          B_CODE: '_i18n',
          NEW_CODE: 'payments',
        }),
      ).toEqual([]);
    });
  });

  /**
   * The reference side, against the platform's own enumeration.
   *
   * It used to sit inside the live-chain block and compare three sizes: what
   * `ERROR_CODES` enumerates, what the chain routed, and what the capture
   * records. Two of the three are gone with the chain; the third is still worth
   * asserting, because the capture is the reference every remaining claim in this
   * file and in `error-code-migration-progress.test.ts` rests on, and a reference
   * that has drifted from the enumeration answers for a population nobody has.
   *
   * **It was one length equality until the minting ledger existed**, and that
   * shape could not survive its own success: the chain is deleted, so every code
   * minted afterwards is a member of `ERROR_CODES` the capture can never hold,
   * and the assertion reds forever over a tree that is entirely correct —
   * measured on `master` over !1159's three `payments` codes,
   * `expected […289] to have a length of 292`.
   *
   * The repair is not a waiver. It is the same equality, stated over the
   * population the harness always had, in the two directions that make *"no
   * exception list"* true in substance:
   *
   * - nothing in `ERROR_CODES` is in neither the capture nor the ledger;
   * - nothing the capture holds has left the enumeration.
   *
   * The third direction — that every ledger entry is absent from the capture — is
   * `findLedgerFaults`' `captured-code`, asserted in
   * `error-code-migration-progress.test.ts`. It is the one that stops a red being
   * cleared by backfilling an answer the chain never gave, which is why it is a
   * fault with a sentence rather than a line here.
   *
   * A fourth — that every ledger entry is a member of `ERROR_CODES` — is
   * deliberately somebody else's: `check:error-translations` reports a code a
   * module declares and the enumeration does not hold, as `undeclaredInEnum`
   * (FR-043), and a second author of one claim is two answers waiting to
   * disagree.
   */
  describe('the frozen capture and the minting ledger', () => {
    it('together cover every member of ERROR_CODES, with no exception list', () => {
      const enumerated: readonly string[] = Object.values(ERROR_CODES);
      expect(enumerated.length).toBeGreaterThan(0);
      const referenced = new Set([
        ...Object.keys(CHAIN_ROUTING_ANSWERS),
        ...Object.keys(MINTED_ERROR_CODES),
      ]);
      // The number itself is deliberately not written down here (D-100) — it
      // grows with every code a module adds, and a literal would be the first
      // thing to go stale.
      const unaccounted = enumerated.filter((code) => !referenced.has(code));
      expect(
        unaccounted,
        unaccounted.length === 0
          ? ''
          : 'these codes are in ERROR_CODES and in neither the frozen chain capture nor ' +
            'the minting ledger. A code minted after the chain was deleted needs an entry ' +
            'in test/fixtures/error-code-routing/reference-ledgers.ts naming its owner and ' +
            'why it exists. Do not write it into the frozen capture — the chain never ' +
            `answered for it: ${unaccounted.join(', ')}`,
      ).toEqual([]);
    });

    it('records nothing the enumeration has dropped', () => {
      const enumerated = new Set<string>(Object.values(ERROR_CODES));
      const captured = Object.keys(CHAIN_ROUTING_ANSWERS);
      expect(captured.length).toBeGreaterThan(0);
      expect(captured.filter((code) => !enumerated.has(code))).toEqual([]);
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

    it('answers exactly what the frozen capture and the minting ledger record, in both directions', async () => {
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
      //
      // `intendedRouting` is the same reconciliation for the other thing the
      // capture cannot express: a code minted after the chain was deleted, which
      // the chain gave no answer for and which the ledger declares with its owner
      // and its reason. The capture itself is untouched by it.
      const differences = compareErrorCodeRouting(
        intendedRouting(CHAIN_ANSWERS_AS_MODULE_IDS, LEDGERS),
        composed,
      );
      expect(
        differences,
        differences.length === 0
          ? ''
          : 'the map the composition roots inject no longer answers what the prefix ' +
            'chain answered. Feature 090 is answer-preserving over the whole of ' +
            'ERROR_CODES with no exception list (FR-041), so a module has declared a ' +
            'code that is not the one the chain routed to it, or has declared a code ' +
            'another module owns. A code minted after the chain was deleted is a ' +
            'different case and needs an entry in ' +
            'test/fixtures/error-code-routing/reference-ledgers.ts. Fix the declaration; ' +
            `do not edit the frozen capture:\n${describeRoutingDifferences(differences)}`,
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
