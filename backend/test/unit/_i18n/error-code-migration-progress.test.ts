import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { resolvedManifestEntries } from '../../../src/lifecycle/registered-manifests.js';
import { CHAIN_ANSWERS_AS_MODULE_IDS } from '../../fixtures/error-code-routing/chain-answers.js';
import { MINTED_ERROR_CODES } from '../../fixtures/error-code-routing/reference-ledgers.js';
import {
  describeLedgerFaults,
  describeMigrationGaps,
  EmptyLedgerReferenceError,
  EmptyMigrationScopeError,
  findLedgerFaults,
  findMigrationGaps,
  intendedRouting,
  type LedgerReferences,
  type MintedCode,
  type ReferenceLedgers,
} from '../../helpers/error-code-routing.js';

/** The declared addends of the reference side, as every reader takes them. */
const LEDGERS: ReferenceLedgers = { minted: MINTED_ERROR_CODES };

/**
 * Feature 090 Phase 3 — **a migrated module has migrated completely.**
 *
 * `specs/090-module-owned-error-codes/contracts/error-code-declaration.md` §6.4
 * made the migration one merge request per owning module, and
 * `error-code-routing-equality.test.ts` is what each of those merge requests was
 * measured by. That harness compares the map the composition roots inject to the
 * frozen chain capture, and it was exactly right about what it measured — but
 * while the migration was in flight the injected map was
 * `composeErrorTranslationTargets`, the declarations laid *over* the chain
 * (§6.7), so **it could not see an incomplete migration**. A module that
 * declared ten of the thirteen codes it owned still produced a composed map that
 * answered correctly for all thirteen: the chain covered the other three. The
 * harness reported nothing, the merge request was green, and the shortfall would
 * have arrived on the merge request that deleted the chain, as three codes that
 * route nowhere and one reviewer with eighteen merge requests to re-read.
 *
 * This file closes that. For every module on the roster below, the codes its
 * manifest declares are **exactly** the codes the frozen capture routes to it,
 * in both directions.
 *
 * **The roster was the Phase 3 progress ledger.** Adding a module to it was the
 * one line each migration merge request added here; the ratchet below refuses a
 * module that declares codes without being on it, so the roster cannot drift
 * behind the manifests. It holds all eighteen, Phase 3 is complete, and Phase 4
 * has deleted the chain — so this file is now the standing proof that the
 * deletion lost nothing, per module, and the ratchet is what will refuse a
 * silent re-homing when D-129's sweep runs.
 *
 * **A module that minted every code it owns is on it too**, and it has to be:
 * the ratchet is an equality, so leaving such a module off is a red, and adding
 * it without the reference knowing about its codes is `EmptyMigrationScopeError`
 * — the capture routes nothing there, because the chain was already deleted when
 * they were created. Both are one question, answered by the same reference side
 * the equality harness uses: `capture ⊕ minted`
 * (`test/fixtures/error-code-routing/reference-ledgers.ts`). The refusal itself
 * is untouched, so a module *nothing* routes to is still refused.
 *
 * `specs/090-module-owned-error-codes/migration-runbook.md` is the procedure the
 * roster is filled in by.
 */
const MIGRATED_MODULES: readonly string[] = [
  // The platform block: 100 codes, the one roster entry whose id is not the
  // chain's answer for them. See the note on `CHAIN_ANSWER_ALIASES` in
  // `test/fixtures/error-code-routing/chain-answers.ts`.
  '_i18n',
  'assets_library',
  'blog',
  'carts',
  'catalog',
  'cms',
  'comparisons',
  'credentials',
  'dictionaries',
  'inventory',
  'invoices',
  'megamenu',
  'mfa',
  'orders',
  // Minted after the chain was deleted (!1159), so the frozen capture holds none
  // of its three codes and `MINTED_ERROR_CODES` is what accounts for them. The
  // roster's question — does this module declare exactly what the reference says
  // it owns — is the same one, and asking it of a minting module is the point:
  // the ledger entry without the roster line would leave the declaration
  // unmeasured.
  'payments',
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
        // The capture's answers as module ids, plus the codes the capture
        // predates. `findMigrationGaps` derives the module's `owned` set by
        // filtering this map, and one of the capture's answers — `core` — is a
        // bundle namespace, not a module id: handed the raw capture it would
        // refuse `_i18n` with `EmptyMigrationScopeError` (nothing routes to it)
        // while calling the block's completeness unmeasurable. See
        // `chain-answers.ts`'s `CHAIN_ANSWER_ALIASES`. `intendedRouting` is the
        // second reconciliation at the same edge, for a module whose codes were
        // minted after the chain was deleted.
        const gaps = findMigrationGaps(
          moduleId,
          declared,
          intendedRouting(CHAIN_ANSWERS_AS_MODULE_IDS, LEDGERS),
        );
        expect(
          gaps,
          gaps.length === 0
            ? ''
            : `${moduleId}'s error-code migration is not answer-preserving. The frozen ` +
              'capture plus the minting ledger is the reference, and neither is edited ' +
              'to agree with a migration ' +
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

/**
 * **The minting ledger is a claim the tree agrees with.**
 *
 * `test/fixtures/error-code-routing/reference-ledgers.ts` declares the codes that
 * are outside the frozen capture's subject: the ones minted after the chain was
 * deleted. Both harnesses read it as the overlay on the capture, which is what
 * lets a code the chain never answered for be green without re-freezing the
 * reference or relaxing the comparison to a subset check.
 *
 * That overlay has authority over the reference side of two tests, so the entries
 * themselves are the thing to check. **Two directions, one implementation each**:
 *
 * - *entry → world*, here: an entry the frozen capture contradicts, whose `to` no
 *   manifest declares, whose destination is not a module, or that carries no
 *   reason.
 * - *world → entry*, in `error-code-routing-equality.test.ts`: a code minted and
 *   not ledgered is `unexpected` in the comparison and is named by the
 *   enumeration-coverage assertion in the words an author needs.
 *
 * The second is deliberately **not** implemented twice. It is the same question,
 * and two implementations of one question are two answers waiting to disagree.
 */
describe('the minting ledger', () => {
  /**
   * The red proofs, over references and entries handed to the predicate whole
   * (`AGENTS.md`, issue #130). They enter at the top of the analysis: nothing
   * here is a value the tree computes, and each proof isolates one fault kind so
   * that three of the four cannot go blind behind the fourth's red.
   */
  describe('the ledger predicate can go red — one proof per fault it reports', () => {
    const references: LedgerReferences = {
      // A code the chain answered for; and — absent from the capture — one the
      // manifests declare and one nobody declares at all.
      capture: { OLD_CODE: 'catalog' },
      declaredBy: { OLD_CODE: ['catalog'], NEW_CODE: ['payments'] },
      registeredModuleIds: ['_i18n', 'catalog', 'payments'],
    };
    const wellFormed: MintedCode = {
      to: 'payments',
      reason: 'A fixture entry, so each fault is measured on input that enters above it.',
    };
    const ledger = (entries: Record<string, MintedCode>): ReferenceLedgers => ({
      minted: entries,
    });

    it('reports nothing for an entry the capture and the manifests both agree with', () => {
      expect(findLedgerFaults(ledger({ NEW_CODE: wellFormed }), references)).toEqual([]);
    });

    it('reports `captured-code` for an entry the chain answered for', () => {
      const entry: MintedCode = { ...wellFormed, to: 'catalog' };
      expect(findLedgerFaults(ledger({ OLD_CODE: entry }), references)).toEqual([
        { code: 'OLD_CODE', kind: 'captured-code', to: 'catalog', observed: 'catalog' },
      ]);
    });

    it('reports `unknown-destination` for a module that is not registered', () => {
      const entry: MintedCode = { ...wellFormed, to: 'not_a_module' };
      expect(findLedgerFaults(ledger({ NEW_CODE: entry }), references)).toEqual([
        { code: 'NEW_CODE', kind: 'unknown-destination', to: 'not_a_module', observed: null },
      ]);
    });

    it('reports `undeclared-destination`, naming the module that does declare it', () => {
      const entry: MintedCode = { ...wellFormed, to: '_i18n' };
      expect(findLedgerFaults(ledger({ NEW_CODE: entry }), references)).toEqual([
        {
          code: 'NEW_CODE',
          kind: 'undeclared-destination',
          to: '_i18n',
          observed: 'payments',
        },
      ]);
    });

    it('reports `undeclared-destination` with no declarer — an entry written ahead of itself', () => {
      expect(findLedgerFaults(ledger({ UNDECLARED_CODE: wellFormed }), references)).toEqual([
        {
          code: 'UNDECLARED_CODE',
          kind: 'undeclared-destination',
          to: 'payments',
          observed: null,
        },
      ]);
    });

    it('reports `unreasoned` for an entry whose reason is blank', () => {
      const entry: MintedCode = { ...wellFormed, reason: '   ' };
      expect(findLedgerFaults(ledger({ NEW_CODE: entry }), references)).toEqual([
        { code: 'NEW_CODE', kind: 'unreasoned', to: 'payments', observed: null },
      ]);
    });

    it('names every fault in the words the merge request that wrote the entry needs', () => {
      const described = describeLedgerFaults(
        findLedgerFaults(
          {
            minted: {
              OLD_CODE: { to: 'catalog', reason: '' },
              UNDECLARED_CODE: wellFormed,
            },
          },
          references,
        ),
      );
      expect(described).toContain(
        '[captured-code] OLD_CODE: the frozen capture routes it to catalog, so the chain ' +
          'answered for it and it was not minted.',
      );
      expect(described).toContain('[unreasoned] OLD_CODE');
      expect(described).toContain('[undeclared-destination] UNDECLARED_CODE');
    });

    /**
     * The empty cases, and the asymmetry between them is the design.
     *
     * Each reference is what a whole class of fault is measured against, so a
     * reference that failed to load does not produce silence — it produces a page
     * of invented findings, which is worse (issue #113). The **ledger** is the
     * population being judged and is legally empty, on a tree where nothing has
     * been minted since the chain was deleted; it is read only after the three
     * references are checked, so an emptiness of its own can never switch a floor
     * off (issue #215, the shape !1158 met).
     */
    it('refuses an empty capture rather than judging every entry against nothing', () => {
      expect(() =>
        findLedgerFaults(ledger({ NEW_CODE: wellFormed }), { ...references, capture: {} }),
      ).toThrow(EmptyLedgerReferenceError);
    });

    it('refuses a manifest set that declares no code at all', () => {
      expect(() =>
        findLedgerFaults(ledger({ NEW_CODE: wellFormed }), { ...references, declaredBy: {} }),
      ).toThrow(EmptyLedgerReferenceError);
    });

    it('refuses an empty registered-module set', () => {
      expect(() =>
        findLedgerFaults(ledger({ NEW_CODE: wellFormed }), {
          ...references,
          registeredModuleIds: [],
        }),
      ).toThrow(EmptyLedgerReferenceError);
    });

    it('accepts an empty ledger — nothing has been minted, and that is not a fault', () => {
      expect(findLedgerFaults(ledger({}), references)).toEqual([]);
    });
  });

  describe('the tree', () => {
    const readReferences = async (): Promise<LedgerReferences> => {
      const entries = await resolvedManifestEntries();
      const declaredBy: Record<string, string[]> = {};
      for (const entry of entries) {
        for (const declaration of entry.manifest.errorCodes ?? []) {
          (declaredBy[declaration.code] ??= []).push(entry.manifest.id);
        }
      }
      return {
        capture: CHAIN_ANSWERS_AS_MODULE_IDS,
        declaredBy,
        registeredModuleIds: entries.map((entry) => entry.manifest.id),
      };
    };

    /**
     * What was read, reconciled against two authors who are not this file
     * (issue #244). `error-codes` is the platform's published enumeration in
     * `@endora-commerce/contracts`, against the reference side; `declarations` is
     * the resolved manifest set, against the frozen capture. A judgement over a
     * short read of either is not a lighter judgement — it is a different one, so
     * both are floors and not statistics.
     */
    it('reads a population it can name, reconciled against the enumeration and the manifests', async () => {
      const references = await readReferences();
      const enumerated: readonly string[] = Object.values(ERROR_CODES);
      const captured = Object.keys(references.capture);
      const referenced = new Set([...captured, ...Object.keys(MINTED_ERROR_CODES)]);
      const accounted = enumerated.filter((code) => referenced.has(code));
      const capturedDeclared = captured.filter((code) => references.declaredBy[code] !== undefined);

      // eslint-disable-next-line no-console -- the population is the point of the assertion
      console.log(
        `[reference-ledgers] read: minted=${Object.keys(MINTED_ERROR_CODES).length} ` +
          `codes=${captured.length} modules=${references.registeredModuleIds.length} ` +
          `sources=error-codes:${accounted.length}/${enumerated.length},` +
          `declarations:${capturedDeclared.length}/${captured.length}`,
      );

      expect(enumerated.length).toBeGreaterThan(0);
      expect(references.registeredModuleIds.length).toBeGreaterThan(0);
      // The reference side accounts for the whole enumeration, and every code the
      // capture holds is declared by somebody. The counts are derived on both
      // sides rather than written down (D-100). The first is asserted in
      // `error-code-routing-equality.test.ts` too, with the message that tells an
      // author what to write; it is repeated here because it is *this* file's
      // floor — a judgement over a short capture is a different judgement, not a
      // lighter one.
      expect(accounted).toHaveLength(enumerated.length);
      expect(
        captured.filter((code) => references.declaredBy[code] === undefined),
        'a code the frozen capture holds is declared by no module, so the ledger is being ' +
          'judged against a manifest set that is short',
      ).toEqual([]);
    });

    it('every entry describes a tree the capture and the manifests both agree with', async () => {
      const references = await readReferences();
      const faults = findLedgerFaults(LEDGERS, references);
      expect(
        faults,
        faults.length === 0
          ? ''
          : 'the minting ledger disagrees with the tree. An entry declares a code the chain ' +
            'never answered for, owned by the module that declares it today, with the ' +
            `reason it exists:\n${describeLedgerFaults(faults)}`,
      ).toEqual([]);
    });
  });
});
