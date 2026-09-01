/**
 * `check-default-language-prose` over **source text**, for the companion test
 * and for `check-inventory.test.ts` alike.
 *
 * One builder rather than two, in the idiom `bundle-pairing-fixture.ts` and
 * `emitted-freshness-fixture.ts` established: two builders over one population
 * are two answers waiting to disagree, and the one that goes stale is the one
 * nobody is looking at.
 *
 * The fixture enters at the **top** of the analysis (issue #130). The check's
 * chain is a TypeScript parse, a position filter, a prose gate, a language
 * detector and a four-way structure analysis; a fixture handing in a classified
 * literal would prove the reporter and leave every one of those unproven — and
 * the structure analysis is where this check earns its keep, because its
 * exemptions are what stop it going uselessly red over 50 correct sites.
 */
import { SUPPORTED_LANGUAGES } from '@endora-commerce/contracts';

import {
  checkDefaultLanguageProse,
  ledgerKey,
  type DefaultLanguageProseFindingKind,
  type DefaultLanguageProseResult,
  type LedgerShard,
  type ProseSite,
} from '../../scripts/check-default-language-prose.js';

/** The default file key, for a fixture that does not care where its source is. */
export const FIXTURE_FILE = 'packages/modules/blog/src/backend/services/thing.service.ts';

/** The whole result, over one or more fixture files. */
export function runDefaultLanguageProse(
  sources: Readonly<Record<string, string>>,
  shards: readonly LedgerShard[] = [],
  moduleOf: (file: string) => string | null = () => null,
): DefaultLanguageProseResult {
  return checkDefaultLanguageProse(
    { sources: new Map(Object.entries(sources)), languages: [...SUPPORTED_LANGUAGES] },
    shards,
    moduleOf,
  );
}

/** Every finding over one fixture source, in {@link FIXTURE_FILE}. */
export function proseSites(source: string): readonly ProseSite[] {
  return runDefaultLanguageProse({ [FIXTURE_FILE]: source }).findings;
}

/** Findings of exactly one kind, so no signal goes blind behind another's red. */
export function proseFindings(
  source: string,
  kind: DefaultLanguageProseFindingKind,
): number {
  return proseSites(source).filter((finding) => finding.kind === kind).length;
}

/**
 * A discrimination: the fixture holds one site that **must** be reported and one
 * shape that must **not** be, and the answer is 1 exactly while the exemption
 * holds.
 *
 * Counted this way rather than as "no finding" because a bare zero is what a
 * check that stopped reading also prints. The control site is what separates
 * the two, and it is why every exemption proof here carries one.
 */
export function proseDiscrimination(source: string, expectedText: string): number {
  const found = proseSites(source);
  return found.length === 1 && found[0]?.text === expectedText ? 1 : 0;
}

/** A shard, for the ledger's two directions. */
export function shard(moduleId: string, entries: Record<string, string>): LedgerShard {
  return { moduleId, entries };
}

/** The key a fixture literal would be ledgered under. */
export function keyFor(text: string, file: string = FIXTURE_FILE): string {
  return ledgerKey({ file, text });
}
