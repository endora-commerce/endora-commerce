/**
 * **R3 — the vocabulary rule**, over prose written to the team and rendered
 * into a file that ships (`specs/129-github-canonical-migration/` T017 /
 * FR-031; `specs/conventions/commercial-data.md`).
 *
 * ## What it is, and the sentence nobody may forget
 *
 * It is a **term list**, which is the weakest instrument this estate owns.
 * Measured over this repository's commit-message history it flags 25 messages
 * of which 7 are true disclosures — a precision of **≈ 28 %** — and its
 * **recall is unknown and unknowable**: it cannot see a cost stated as *"three
 * weeks of work"*, a client named without the word *pilot*, or a margin written
 * as a bare number. **A green from this rule is not a guarantee**, and the
 * requirement that it say so out loud exists precisely so that nobody later
 * mistakes one for a structural gate.
 *
 * It is worth having anyway, for one measured reason: **a changeset is written
 * by an author who thinks they are writing to the team, and it is rendered into
 * a file that ships.** The one real disclosure this estate found in a published
 * artefact came through that surface, and nothing stood between the author and
 * the render.
 *
 * ## The two narrowings, and why the rule is unusable without them
 *
 * Both are ruled, and both are in `specs/conventions/commercial-data.md` §4:
 *
 *   * **§4(b) — effort *measured* is not effort *priced*.** *"The sweep took a
 *     full day"* is a backward observation and is N2; *"this is N–M
 *     person-days"* is a forward commitment and is C1. **No regex can see the
 *     difference**, and 12 of the 25 messages the instrument flagged were
 *     backward observations. What is implemented here is the best available
 *     approximation — a backward-observation marker on the same line suppresses
 *     a C1 hit — and its false negatives are real and are named in
 *     {@link BACKWARD_OBSERVATION}. It is the trade the definition takes: a
 *     rule that admitted every backward observation would take the
 *     false-positive rate from tolerable to absolute, and an instrument nobody
 *     can keep green is an instrument that gets switched off.
 *   * **§4(c) — product prices are not commercial data.** A currency code, an
 *     amount in a fixture, a credit limit in a seed are the **domain the
 *     software is about**. So there is **no money regex here at all**, and that
 *     is a deliberate absence rather than an oversight: fifteen commit messages
 *     and several hundred code sites in this repository match a naive one and
 *     not one of them discloses anything. Only prices this business charges for
 *     its own product or work are C3, and those are matched by name.
 *
 * ## Clearing is by annotation, never by widening the list
 *
 * A false positive is cleared with a line in the document's own body:
 *
 * ```
 * <!-- commercial-data: cleared `pilot` — names the pilot-programme module, not a client -->
 * ```
 *
 * **An annotation reaches its own block, not the document** (D-277;
 * `specs/conventions/commercial-data.md` §7.4): the maximal run of non-blank
 * lines that holds the annotation line. It clears its term there and nowhere
 * else, so it goes beside the paragraph it judges, and the same term in another
 * paragraph is judged again. Document reach was sized for a changeset body a
 * few lines long; over a whole source file it let an annotation inside a
 * fixture string clear a real sentence elsewhere in the file.
 *
 * A cleared hit is **counted and printed**, so the clearances are visible rather
 * than invisible. Widening {@link TERMS} is not clearing: it silently stops the
 * rule refusing a real finding somewhere else, which is the estate's standing
 * precedent (a recorded exception is a ledger entry, never a band made wider).
 * The ledger is two-way for the same reason every other one here is — a
 * clearance whose own block holds no hit of its term is reported as stale, so
 * the annotations cannot accumulate into a list nobody reads.
 *
 * ## Reported class by class, zeros included
 *
 * §4(d) is a **rule**: a measurement must scan for every class its definition
 * names, and a class it did not scan for is reported as a zero indistinguishable
 * from a real one. {@link scanCommercialVocabulary} therefore returns a count
 * per class **including the zeros**, and {@link COMMERCIAL_CLASSES} is what a
 * caller prints — never the classes that happened to have a hit.
 */

/** The four classes of `specs/conventions/commercial-data.md` §2. */
export type CommercialClass = 'C1' | 'C2' | 'C3' | 'C4';

/** Every class, so a report can carry the zeros (§4(d)). */
export const COMMERCIAL_CLASSES: readonly CommercialClass[] = ['C1', 'C2', 'C3', 'C4'];

export interface VocabularyTerm {
  readonly klass: CommercialClass;
  /** The term as an author would name it in a clearing annotation. */
  readonly term: string;
  readonly pattern: RegExp;
}

/**
 * Markers of a **backward observation** — §4(b)'s narrowing, implemented at the
 * granularity of a line.
 *
 * What it cannot do is the whole point of saying it here. *"It took two
 * person-days"* is suppressed; *"the sweep, two person-days, is scheduled"* is
 * not, and neither is a forward estimate in a sentence that happens to contain
 * the word *measured*. The suppression is therefore a source of **false
 * negatives in both directions**, and an author who finds one clears it or
 * rewrites the sentence — they do not add a marker here, for the same reason
 * they do not widen the term list.
 */
export const BACKWARD_OBSERVATION =
  /\b(?:took|taken|spent|measured|turned out|so far|in the end|as it turned out|was measured)\b/i;

/**
 * The list. Small on purpose: every term here has to justify a false positive
 * rate an author will meet, and a term list that grows to catch one more real
 * case has usually bought it with ten spurious ones.
 *
 * **What is deliberately absent, because the domain owns the word**: `price`,
 * `discount`, `customer`, `invoice`, `credit limit`, every currency code and
 * every bare amount. This platform is commerce software; those are what it is
 * *about*, and matching them is §4(c)'s refused instrument.
 */
export const TERMS: readonly VocabularyTerm[] = [
  // C1 — cost and effort *pricing*. Forward commitments.
  { klass: 'C1', term: 'person-day', pattern: /\bperson[- ]days?\b/i },
  { klass: 'C1', term: 'man-day', pattern: /\bman[- ]days?\b/i },
  { klass: 'C1', term: 'day-range', pattern: /\b\d+\s*[-–—]\s*\d+\s*(?:person[- ])?days?\b/i },
  { klass: 'C1', term: 'costed-at', pattern: /\bcosted at\b/i },
  { klass: 'C1', term: 'day-rate', pattern: /\bday rate\b/i },
  { klass: 'C1', term: 'budget', pattern: /\bbudgeted?\b/i },
  // C2 — counterparty identity and terms.
  { klass: 'C2', term: 'pilot', pattern: /\bpilots?\b/i },
  { klass: 'C2', term: 'prospect', pattern: /\bprospects?\b/i },
  { klass: 'C2', term: 'counterparty', pattern: /\bcounterpart(?:y|ies)\b/i },
  { klass: 'C2', term: 'the-client', pattern: /\b(?:the|our|a named) client(?:'s)?\b/i },
  { klass: 'C2', term: 'deploy-token', pattern: /\bdeploy[- ]tokens?\b/i },
  { klass: 'C2', term: 'nda', pattern: /\bNDA\b/ },
  // C3 — money figures about the business. No amount regex: §4(c).
  { klass: 'C3', term: 'revenue', pattern: /\brevenues?\b/i },
  { klass: 'C3', term: 'arr', pattern: /\bARR\b/ },
  { klass: 'C3', term: 'mrr', pattern: /\bMRR\b/ },
  { klass: 'C3', term: 'margin', pattern: /\bmargins?\b/i },
  { klass: 'C3', term: 'monetise', pattern: /\bmonetis|\bmonetiz/i },
  { klass: 'C3', term: 'licence-fee', pattern: /\blicen[cs]e fees?\b/i },
  { klass: 'C3', term: 'we-charge', pattern: /\bwe charge\b/i },
  // C4 — unpublished commercial strategy and market reasoning.
  { klass: 'C4', term: 'paid-module', pattern: /\bpaid (?:modules?|tiers?|packages?)\b/i },
  { klass: 'C4', term: 'go-to-market', pattern: /\bgo[- ]to[- ]market\b/i },
  { klass: 'C4', term: 'competitor', pattern: /\bcompetitors?\b/i },
  { klass: 'C4', term: 'sales-event', pattern: /\bsales (?:event|deadline|date)\b/i },
  { klass: 'C4', term: 'commercial-deadline', pattern: /\bcommercial deadline\b/i },
];

export interface VocabularyHit {
  readonly klass: CommercialClass;
  readonly term: string;
  /** 1-based, within the scanned text. */
  readonly line: number;
  readonly text: string;
}

export interface Clearance {
  readonly term: string;
  readonly reason: string;
  readonly line: number;
}

export interface VocabularyScan {
  /** Hits that were not cleared. These are the findings. */
  readonly hits: readonly VocabularyHit[];
  /** Hits an annotation cleared, counted so that clearances stay visible. */
  readonly cleared: readonly VocabularyHit[];
  /** Annotations whose own block holds no hit of their term. The other direction. */
  readonly staleClearances: readonly Clearance[];
  /** Lines scanned, for the read line. */
  readonly lines: number;
  /** One count per class, **zeros included** (§4(d)). */
  readonly perClass: Readonly<Record<CommercialClass, number>>;
}

/**
 * A clearing annotation: the term it clears, and why.
 *
 * The reason is required and is required to be *said*, not merely present: an
 * annotation reading `cleared` with nothing after the dash clears nothing,
 * because the whole value of a recorded exception is that the next reader can
 * disagree with a named decision.
 */
const CLEARANCE =
  /<!--\s*commercial-data:\s*cleared\s+`?([a-z0-9-]+)`?\s*[-–—]+\s*(\S[^>]*?)\s*-->/i;

/**
 * The block of every line: lines in one maximal run of non-blank lines share a
 * number, and a blank (or whitespace-only) line belongs to none (D-277).
 */
function blocksOf(lines: readonly string[]): number[] {
  const blocks: number[] = [];
  let block = 0;
  let inBlock = false;
  for (const line of lines) {
    if (line.trim() === '') {
      inBlock = false;
      blocks.push(-1);
      continue;
    }
    if (!inBlock) {
      block += 1;
      inBlock = true;
    }
    blocks.push(block);
  }
  return blocks;
}

/** The rule, pure over the text. */
export function scanCommercialVocabulary(text: string): VocabularyScan {
  const lines = text.split('\n');
  const blocks = blocksOf(lines);
  const clearances: Clearance[] = [];
  for (const [index, line] of lines.entries()) {
    const match = CLEARANCE.exec(line);
    if (match === null) continue;
    const term = match[1];
    const reason = match[2];
    if (term === undefined || reason === undefined || reason.trim().length < 8) continue;
    clearances.push({ term: term.toLowerCase(), reason: reason.trim(), line: index + 1 });
  }
  // A clearance reaches its own block only: key it by block and term.
  const key = (block: number, term: string): string => `${block}\u0000${term}`;
  const clearedInBlock = new Set(clearances.map((c) => key(blocks[c.line - 1]!, c.term)));

  const hits: VocabularyHit[] = [];
  const cleared: VocabularyHit[] = [];
  const perClass: Record<CommercialClass, number> = { C1: 0, C2: 0, C3: 0, C4: 0 };
  for (const [index, line] of lines.entries()) {
    if (CLEARANCE.test(line)) continue;
    for (const term of TERMS) {
      if (!term.pattern.test(line)) continue;
      // §4(b): a backward observation on the same line is N2, not C1. The
      // narrowing applies to C1 alone — a counterparty named in the past tense
      // is still a counterparty named.
      if (term.klass === 'C1' && BACKWARD_OBSERVATION.test(line)) continue;
      const hit: VocabularyHit = {
        klass: term.klass,
        term: term.term,
        line: index + 1,
        text: line.trim(),
      };
      perClass[term.klass] += 1;
      if (clearedInBlock.has(key(blocks[index]!, term.term))) cleared.push(hit);
      else hits.push(hit);
    }
  }

  const seen = new Set(cleared.map((h) => key(blocks[h.line - 1]!, h.term)));
  const staleClearances = clearances.filter((c) => !seen.has(key(blocks[c.line - 1]!, c.term)));
  return { hits, cleared, staleClearances, lines: lines.length, perClass };
}

/** `C1=0 C2=1 C3=0 C4=0` — every class, so a zero cannot be an unscanned class. */
export function perClassToken(scan: VocabularyScan): string {
  return COMMERCIAL_CLASSES.map((k) => `${k}=${scan.perClass[k]}`).join(' ');
}
