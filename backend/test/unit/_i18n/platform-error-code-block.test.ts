import { describe, expect, it } from 'vitest';
import { resolvedManifestEntries } from '../../../src/lifecycle/registered-manifests.js';
import { CHAIN_ANSWERS_AS_MODULE_IDS } from '../../fixtures/error-code-routing/chain-answers.js';
import {
  MINTED_ERROR_CODES,
  PLATFORM_OWNED_ERROR_CODES,
  REHOMED_ERROR_CODES,
} from '../../fixtures/error-code-routing/reference-ledgers.js';
import {
  describePlatformBlockFaults,
  EmptyLedgerReferenceError,
  findPlatformBlockFaults,
  intendedRouting,
  type PlatformBlockReferences,
  type PlatformOwnedCode,
  type PlatformOwnedErrorCodes,
  type ReferenceLedgers,
} from '../../helpers/error-code-routing.js';

/** The module that owns the platform bundle — `core` is its namespace, not its id. */
const PLATFORM_MODULE_ID = '_i18n';

/** The declared addends of the reference side, as every reader of it takes them. */
const LEDGERS: ReferenceLedgers = {
  rehomed: REHOMED_ERROR_CODES,
  minted: MINTED_ERROR_CODES,
};

/**
 * **The completeness gate of D-129's sweep** (D-186 §4,
 * `specs/090-module-owned-error-codes/d129-sweep.md` §6.3).
 *
 * The sweep moved 79 codes out of the platform block and left 21. The mechanism
 * that produced the hundred is already dead — `moduleIdForErrorCode` ended in
 * `return 'core'`, and Phase 4 deleted it, so a member of `ERROR_CODES` nobody
 * declares now fails the build naming the code. What is not dead is the habit:
 * the sixty-ninth code can still reach the platform block by somebody typing one
 * line into `_i18n`'s manifest, and until this file existed nothing would have
 * asked why.
 *
 * **This is a gate and deliberately not a scanner.** Both scanners anybody would
 * reach for were measured against the tree the sweep leaves and refused — *"the
 * platform declares it and exactly one module raises it"* gives three findings,
 * all three correct as they stand, and the family-split signal gives four of
 * which three are first-token coincidences (§6.1, §6.2). A ledger that is 100%
 * exceptions on the day it is written has met `check:diacritic-folds`' own
 * retiring condition before the check exists. The gate works where the scanner
 * cannot because the surviving block is short: 21 lines a reviewer reads in
 * full, each with a sentence beside it that a reviewer can disagree with. The
 * sixty-ninth code then lands either in a module's manifest, which is correct by
 * construction, or here with no reason of its own — which is a reviewable
 * omission in a diff, and now a red one.
 *
 * **What the expectation is derived from, since it is never a list of 21**
 * (D-100). Two references, neither of them written by the author of an
 * annotation:
 *
 * - **what `_i18n` declares**, read out of the resolved manifest set — which is
 *   the built package, by bare specifier, exactly as the composition roots read
 *   it;
 * - **`intendedRouting(capture, ledgers)`**, the frozen chain capture with the
 *   re-homing and minting ledgers laid over it. That is the same reference side
 *   `error-code-routing-equality.test.ts` measures the whole tree against, so
 *   the block's membership here is the sweep's own arithmetic — the hundred the
 *   chain answered `core` for, minus every code a `REHOMED_ERROR_CODES` entry
 *   moved — rather than a number anybody typed.
 *
 * Both directions fail. An annotation the manifest does not back is `undeclared`
 * or `outside-the-block`; a code either reference puts with the platform and no
 * annotation covers is `unannotated`.
 */
describe('feature 090 — the platform declares exactly the codes annotated platform-owned', () => {
  /**
   * The red proofs, first and over fixtures handed to the predicate whole
   * (`AGENTS.md`, issue #130). Nothing here is a value the tree computes, and
   * each proof isolates one fault kind so that five of the six cannot go blind
   * behind the sixth's red.
   */
  describe('the gate can go red — one proof per fault it reports', () => {
    const wellAnnotated: PlatformOwnedCode = {
      tier: 'T3',
      reason: 'A fixture entry, so each fault is measured on input that enters above it.',
    };
    const references: PlatformBlockReferences = {
      platformModuleId: '_i18n',
      declaredBy: { STAYED_CODE: ['_i18n'], MOVED_CODE: ['price_lists'] },
      reference: { STAYED_CODE: '_i18n', MOVED_CODE: 'price_lists' },
    };
    const annotate = (entries: PlatformOwnedErrorCodes): PlatformOwnedErrorCodes => ({
      STAYED_CODE: wellAnnotated,
      ...entries,
    });

    it('reports nothing for a block whose declarations, routing and annotations agree', () => {
      expect(findPlatformBlockFaults(annotate({}), references)).toEqual([]);
    });

    it('reports `unannotated` for a code the platform declares and no entry covers', () => {
      expect(
        findPlatformBlockFaults(
          {},
          { ...references, reference: { ...references.reference, STAYED_CODE: 'price_lists' } },
        ),
      ).toEqual([{ code: 'STAYED_CODE', kind: 'unannotated', observed: 'declared' }]);
    });

    it('reports `unannotated` for a code the routing reference leaves with the platform', () => {
      expect(
        findPlatformBlockFaults(annotate({}), {
          ...references,
          declaredBy: { ...references.declaredBy, ROUTED_CODE: ['_i18n'] },
          reference: { ...references.reference, ROUTED_CODE: '_i18n' },
        }),
      ).toEqual([{ code: 'ROUTED_CODE', kind: 'unannotated', observed: 'declared and routed' }]);
    });

    it('reports `undeclared` for an entry the platform manifest does not back', () => {
      expect(findPlatformBlockFaults(annotate({ MOVED_CODE: wellAnnotated }), references)).toEqual([
        { code: 'MOVED_CODE', kind: 'declared-elsewhere', observed: 'price_lists' },
        { code: 'MOVED_CODE', kind: 'outside-the-block', observed: 'price_lists' },
        { code: 'MOVED_CODE', kind: 'undeclared', observed: 'price_lists' },
      ]);
    });

    it('reports `declared-elsewhere` for a code a module claims beside the platform', () => {
      expect(
        findPlatformBlockFaults(annotate({}), {
          ...references,
          declaredBy: { ...references.declaredBy, STAYED_CODE: ['_i18n', 'catalog'] },
        }),
      ).toEqual([{ code: 'STAYED_CODE', kind: 'declared-elsewhere', observed: 'catalog' }]);
    });

    it('reports `outside-the-block` for an entry the routing reference does not put here', () => {
      expect(
        findPlatformBlockFaults(annotate({ MINTED_CODE: wellAnnotated }), {
          ...references,
          declaredBy: { ...references.declaredBy, MINTED_CODE: ['_i18n'] },
          reference: { ...references.reference, MINTED_CODE: 'catalog' },
        }),
      ).toEqual([{ code: 'MINTED_CODE', kind: 'outside-the-block', observed: 'catalog' }]);
    });

    it('reports `unreasoned` for an entry with nothing a reviewer can disagree with', () => {
      expect(
        findPlatformBlockFaults({ STAYED_CODE: { tier: 'T3', reason: '  ' } }, references),
      ).toEqual([{ code: 'STAYED_CODE', kind: 'unreasoned', observed: null }]);
    });

    it('reports `wrong-tier` for an entry that names a module owner and files itself here', () => {
      expect(
        findPlatformBlockFaults(
          { STAYED_CODE: { ...wellAnnotated, tier: 'T1' } },
          references,
        ),
      ).toEqual([{ code: 'STAYED_CODE', kind: 'wrong-tier', observed: 'T1' }]);
    });

    it('refuses a manifest set that declares no code at all', () => {
      expect(() => findPlatformBlockFaults(annotate({}), { ...references, declaredBy: {} })).toThrow(
        EmptyLedgerReferenceError,
      );
    });

    it('refuses an empty routing reference rather than calling every entry stale', () => {
      expect(() => findPlatformBlockFaults(annotate({}), { ...references, reference: {} })).toThrow(
        EmptyLedgerReferenceError,
      );
    });

    it('refuses a platform that declares nothing, which would make the block look empty', () => {
      expect(() =>
        findPlatformBlockFaults(annotate({}), {
          ...references,
          declaredBy: { MOVED_CODE: ['price_lists'] },
        }),
      ).toThrow(EmptyLedgerReferenceError);
    });

    it('names every fault in the words the merge request that touched the block needs', () => {
      const described = describePlatformBlockFaults(
        '_i18n',
        findPlatformBlockFaults({ MOVED_CODE: wellAnnotated }, references),
      );
      expect(described).toContain('[unannotated] STAYED_CODE');
      expect(described).toContain('[undeclared] MOVED_CODE');
      expect(described).toContain('[outside-the-block] MOVED_CODE');
    });
  });

  describe('the tree', () => {
    const readReferences = async (): Promise<PlatformBlockReferences> => {
      const entries = await resolvedManifestEntries();
      const declaredBy: Record<string, string[]> = {};
      for (const entry of entries) {
        for (const declaration of entry.manifest.errorCodes ?? []) {
          (declaredBy[declaration.code] ??= []).push(entry.manifest.id);
        }
      }
      return {
        platformModuleId: PLATFORM_MODULE_ID,
        declaredBy,
        reference: intendedRouting(CHAIN_ANSWERS_AS_MODULE_IDS, LEDGERS),
      };
    };

    /**
     * What was read, reconciled against two authors who are not this file
     * (issue #244). `declarations` is the resolved manifest set — the block as
     * the running platform composes it — and `routing` is the frozen capture
     * with both ledgers over it. The two are derived independently and the gate
     * is the claim that they agree with the annotations; a run over a short read
     * of either is a different judgement, not a lighter one.
     */
    it('reads a block it can name, reconciled against the manifests and the routing reference', async () => {
      const references = await readReferences();
      const declared = Object.keys(references.declaredBy).filter((code) =>
        (references.declaredBy[code] ?? []).includes(PLATFORM_MODULE_ID),
      );
      const routed = Object.keys(references.reference).filter(
        (code) => references.reference[code] === PLATFORM_MODULE_ID,
      );
      const annotated = Object.keys(PLATFORM_OWNED_ERROR_CODES);

      // eslint-disable-next-line no-console -- the population is the point of the assertion
      console.log(
        `[platform-block] read: annotated=${annotated.length} ` +
          `rehomed=${Object.keys(REHOMED_ERROR_CODES).length} ` +
          `sources=declarations:${declared.length},routing:${routed.length}`,
      );

      expect(annotated.length).toBeGreaterThan(0);
      expect(declared.length).toBeGreaterThan(0);
      expect(routed.length).toBeGreaterThan(0);
    });

    it('every code the platform block holds is annotated, and every annotation is a code it holds', async () => {
      const references = await readReferences();
      const faults = findPlatformBlockFaults(PLATFORM_OWNED_ERROR_CODES, references);
      expect(
        faults,
        faults.length === 0
          ? ''
          : 'the platform error-code block and its annotations disagree. A code is owned by ' +
            'the platform because no module owns its noun (D-121 T3), which is a decision ' +
            'somebody makes and writes down — never a default a code arrives at:\n' +
            describePlatformBlockFaults(PLATFORM_MODULE_ID, faults),
      ).toEqual([]);
    });
  });
});
