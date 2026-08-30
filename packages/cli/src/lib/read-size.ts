/**
 * "What did this check actually read?" — the one line every check prints
 * (issue #244).
 *
 * ## The defect family
 *
 * Seven times now a check has reported `violations=0` because it was not
 * looking, not because the tree was clean:
 *
 *   * **#215** — the walk came back *short*. `files.length === 0` is the wrong
 *     floor when 1364 of 1469 files live under `src/modules`: move that tree
 *     out and eight checks read the other 105 files, find nothing, and report
 *     clean.
 *   * **#228** — the *population definition* excluded a live entry point, so
 *     `unscoped=0` said nothing about `src/seeds/dev-catalog-seed.ts`.
 *   * **#235 / #237** — a file in the population hid a *site* inside it: the
 *     answer was per file while the rule is per call.
 *   * **#238** — a spread bypassed excess-property checking, so the off-state
 *     test stopped testing anything while `tsc` stayed green.
 *   * **#241** — an input transform ate 41% of the file before matching.
 *   * **#244** — the population is defined by the presence of the thing being
 *     checked, so its *absence* is undetectable.
 *
 * They are one defect. **A check's output says what it found and never says
 * what it read**, so "found nothing" and "read nothing" print the same green.
 * Every repair so far has been per check and after the fact; this is the
 * general answer, and it is deliberately not a new rule about correctness. It
 * is a rule about *disclosure*: the size of the input is printed beside the
 * count of findings, on every run, in one grammar, so that a reader — or the
 * ratchet in `test/unit/scripts/check-read-size.test.ts` — can tell a clean
 * tree from a check that stopped reading it.
 *
 * ## The grammar
 *
 * ```
 * [entry-scope] read: files=1459 sites=47 sources=manifest-index:65/65,package-scripts:18/18
 * [nul-bytes]   read: files=5163 sources=self-reported
 * ```
 *
 *   * **`files`** — how many files the check *opened*. Not how many it had a
 *     finding in, and not how many survived a filter it applied afterwards.
 *     That distinction is the whole point and it is easy to get backwards:
 *     `check-entry-scope` already printed `files=38`, which is the number of
 *     files that hold an entry site, out of the 1459 it reads. A number that
 *     moves with the findings cannot answer "did you read the tree".
 *   * **`sites`** — the finer population, where the check has one: the calls,
 *     nodes, entries, documents or records it examined *inside* those files.
 *     Issues #235 and #237 are exactly the case where the file count is
 *     unchanged and the examined-site count is what moved, so a check that
 *     answers per site must print both. Omitted where the file is the unit.
 *   * **`sources`** — how the two numbers above are corroborated. A check that
 *     computes its own population and then reports it has not closed #215:
 *     that is the same value twice. Where an *independent* derivation exists —
 *     the generated manifest index for a module walk, `package.json` scripts
 *     for a declared program — the reconciliation is printed as
 *     `<source>:<covered>/<expected>` and a shortfall is refused. Where there
 *     genuinely is none, the token is the literal `self-reported`: the honest
 *     word, so that a reader can see which checks still rest on their own
 *     answer, and so the inventory can require a reason for each.
 *
 * ## What it refuses
 *
 * Three shapes, all exit 2 — "nothing was read" is neither a pass (0) nor a
 * violation (1):
 *
 *   1. `read-nothing` — `files=0`. The pre-existing floor, kept uniform.
 *   2. `short-walk` — a declared source expected more than the walk covered.
 *      This is #215's predicate, generalised past the module tree: any check
 *      that can name an independent expectation gets the short case, not only
 *      the empty one.
 *   3. `no-expectation` — a declared source whose expectation is zero. An
 *      independent derivation that derived nothing silently turns the floor off
 *      while looking like a normal run, which is the same green this file
 *      exists to break.
 *
 * The verdict is a pure function over the record so a red proof enters where a
 * real run enters (issue #130); {@link reportReadSize} is the thin CLI half
 * that prints it and exits.
 */
/* eslint-disable no-console -- prints on behalf of the CLI checks: stdout is their interface. */

/** One independent derivation of what the check should have read. */
export interface ReadCoverage {
  /**
   * Where the expectation came from — printed, so the reader can check it
   * themselves. `manifest-index` and `package-scripts` are the two the tree
   * has; the token is free text so a check with a third can name it.
   */
  readonly source: string;
  /** How many units that source says exist. */
  readonly expected: number;
  /** How many of them the walk actually reached. */
  readonly covered: number;
}

export interface ReadSizeInput {
  /** The check's log prefix, e.g. `[entry-scope]` — brackets included. */
  readonly prefix: string;
  /** Files opened. Never files with a finding, never files after a filter. */
  readonly files: number;
  /** The finer population examined inside them, where the check has one. */
  readonly sites?: number;
  /**
   * Independent corroboration, if any. An empty list prints `self-reported`,
   * which is a statement rather than an omission: the inventory requires a
   * reason for every check that prints it.
   */
  readonly coverage?: readonly ReadCoverage[];
}

export type ReadSizeRefusalKind = 'read-nothing' | 'short-walk' | 'no-expectation';

export interface ReadSizeRefusal {
  readonly kind: ReadSizeRefusalKind;
  readonly message: string;
}

/** The literal printed where no independent derivation exists. */
export const SELF_REPORTED = 'self-reported';

/** The `sources=` token: every derivation, or the honest word for none. */
export function coverageToken(coverage: readonly ReadCoverage[] = []): string {
  if (coverage.length === 0) return SELF_REPORTED;
  return coverage.map((c) => `${c.source}:${c.covered}/${c.expected}`).join(',');
}

/**
 * The line itself. One grammar for every check, so the ratchet parses one
 * shape and a reader learns one.
 */
export function readSizeLine(input: ReadSizeInput): string {
  const sites = input.sites === undefined ? '' : ` sites=${input.sites}`;
  return `${input.prefix} read: files=${input.files}${sites} sources=${coverageToken(input.coverage)}`;
}

/**
 * Why this run may not report on what it read, or `null`.
 *
 * Pure, and over the record the check hands in — the top of this helper's
 * analysis. A proof that constructed the message instead would prove the
 * string formatting and leave all three predicates unproven.
 */
export function readSizeRefusal(input: ReadSizeInput): ReadSizeRefusal | null {
  if (input.files <= 0) {
    return {
      kind: 'read-nothing',
      message:
        'the walk opened no file at all — a finding count over an empty input is not a ' +
        'clean tree; refusing to report a vacuous pass',
    };
  }
  for (const coverage of input.coverage ?? []) {
    if (coverage.expected <= 0) {
      return {
        kind: 'no-expectation',
        message:
          `the independent derivation \`${coverage.source}\` expects nothing, so it ` +
          'corroborates nothing — the floor it exists to provide is switched off; ' +
          'refusing to report a vacuous pass',
      };
    }
    if (coverage.covered < coverage.expected) {
      return {
        kind: 'short-walk',
        message:
          `the walk opened ${input.files} file(s) and covered ${coverage.covered} of the ` +
          `${coverage.expected} unit(s) \`${coverage.source}\` derives — it is reading a ` +
          'residue of its population, not the population; refusing to report a vacuous pass',
      };
    }
  }
  return null;
}

/**
 * The CLI half: print the read size, or refuse and exit 2.
 *
 * One function rather than a copy per check, because a copy per check is a
 * chance per check to write the one that prints a number nothing compares —
 * which is the state this repository was in when the family reached seven.
 */
export function reportReadSize(input: ReadSizeInput): void {
  const refusal = readSizeRefusal(input);
  if (refusal !== null) {
    console.error(`${input.prefix} ${refusal.message}`);
    process.exit(2);
  }
  console.log(readSizeLine(input));
}

export interface ParsedReadSize {
  readonly prefix: string;
  readonly files: number;
  /** `null` when the check declares no finer population. */
  readonly sites: number | null;
  readonly coverage: readonly ReadCoverage[];
  /** True when the `sources=` token is the literal `self-reported`. */
  readonly selfReported: boolean;
}

const READ_LINE =
  /\[([^\]\n]+)\] read: files=(\d+)(?: sites=(\d+))? sources=(\S+)/;

/**
 * The line back out of a check's output, for the ratchet that spawns it.
 *
 * Returns `null` when the output holds no read line — which the ratchet reads
 * as "this check does not disclose its read size", a failure rather than a
 * skip.
 */
export function parseReadSize(output: string): ParsedReadSize | null {
  const match = READ_LINE.exec(output);
  if (match === null) return null;
  const token = match[4] ?? SELF_REPORTED;
  const coverage: ReadCoverage[] =
    token === SELF_REPORTED
      ? []
      : token.split(',').flatMap((part) => {
          const parsed = /^([^:]+):(\d+)\/(\d+)$/.exec(part);
          if (parsed === null) return [];
          return [
            {
              source: parsed[1]!,
              covered: Number(parsed[2]),
              expected: Number(parsed[3]),
            },
          ];
        });
  return {
    prefix: match[1]!,
    files: Number(match[2]),
    sites: match[3] === undefined ? null : Number(match[3]),
    coverage,
    selfReported: token === SELF_REPORTED,
  };
}
