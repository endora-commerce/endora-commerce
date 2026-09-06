/**
 * How a command acquires the values it was not given
 * (`specs/117-instance-bring-up/contracts/input-resolution.md`, FR-010…FR-015).
 *
 * Four tiers, in one fixed order, stopping at the first that answers: an
 * explicit **flag**, then a **`.env` already placed in the target directory**,
 * then an interactive **prompt**, then a **refusal**. The order is contract and
 * is not configurable (R1.1) — a precedence an operator can change is a value
 * nobody can predict.
 *
 * ## `defaulted=0` is made unfakeable by arithmetic, not by discipline
 *
 * R2.2 binds the provenance line's `defaulted` count to `0`, and the temptation
 * is to satisfy that with a counter nothing increments. That is the *fakeable*
 * construction, and it is fakeable in the precise sense that matters: it prints
 * `0` because no code path calls it, which is indistinguishable from printing
 * `0` because nothing was invented. The estate has a name for that shape —
 * a check that reports what it found and never what it read (issue #244).
 *
 * So `defaulted` is a **residue**, not a counter:
 *
 * ```
 * defaulted = resolved.length − (flags + env-file + prompted + generated)
 * ```
 *
 * Two consequences, and both are the point. A value can only enter `resolved`
 * carrying a {@link Provenance}, which is a closed union of the four tiers, so
 * inventing one requires a fifth tag and `tsc` refuses it. And if a later author
 * *does* widen the union and forgets the sum, the arithmetic does not stay
 * silent — the residue goes non-zero, the line says so on the operator's own
 * terminal, and the acceptance test fails. The number cannot be right by
 * accident and cannot be wrong quietly.
 *
 * `provenanceCounts` therefore takes the loosest record it can, so a red proof
 * can hand it a value whose origin is none of the four and watch the residue
 * appear. That is the whole of the guarantee, and it is one subtraction.
 *
 * ## The prompt is a fallback, never a generator
 *
 * A prompt exists for a **required** input the first two tiers did not answer.
 * An optional input is never prompted for (R1.4): the prompt's length is the
 * required set's length and nothing more, because a tool that asks twelve
 * questions to save one is not assistance. And nothing here supplies a value of
 * its own — the one exception is {@link generateSecret}, whose whole class is a
 * value with no human judgement in it (R4.1).
 *
 * ## One module, every command
 *
 * R5.3. Two implementations of a precedence order are two orders, and R5.2 is
 * that one product means one behaviour: a command that resolved inputs
 * differently from its sibling would be `cli-product.md` R3.3's *"three commands
 * that happen to share a prefix"* arriving through the input layer instead of
 * the command layer.
 */
import { randomBytes } from 'node:crypto';

import {
  isRequiredGiven,
  scopeToMembers,
  type EnvironmentConsumer,
  type EnvironmentInput,
} from '@endora-commerce/contracts';

/** Where a value came from. Four tiers, closed, and there is no fifth. */
export type Provenance = 'flag' | 'env-file' | 'prompt' | 'generated';

export interface ResolvedInput {
  readonly name: string;
  readonly value: string;
  readonly provenance: Provenance;
}

/** An input the run needs and could not resolve, with the flag that supplies it. */
export interface MissingInput {
  readonly name: string;
  /** `--<kebab-cased name>`, so a refusal names the remedy and not only the gap. */
  readonly flag: string;
  /** The declaration's own sentence, in the language this run reports in. */
  readonly describes: string;
  readonly secret: boolean;
}

/** The counts the provenance line prints. */
export interface ProvenanceCounts {
  readonly total: number;
  readonly flags: number;
  readonly envFile: number;
  readonly prompted: number;
  readonly generated: number;
  /** The residue. Contract-bound to `0` — see the header for why by subtraction. */
  readonly defaulted: number;
}

/** What the process can prove about its own invocation (R3.1). */
export interface InteractivityFacts {
  readonly stdinIsTty: boolean;
  readonly stdoutIsTty: boolean;
  readonly nonInteractive: boolean;
  readonly dryRun: boolean;
  readonly environment: Readonly<Record<string, string | undefined>>;
}

/**
 * Markers a continuous-integration environment sets.
 *
 * A **floor**, not a closed set, and the distinction costs nothing because it is
 * not what protects the run: conditions 1 and 2 of R3.1 are the TTY tests, and a
 * pipeline that set none of these still has no terminal on either descriptor. So
 * an unlisted vendor is a marker this does not know about and a run this still
 * refuses to prompt in. `CI` alone would very nearly do; the rest are here
 * because a vendor that sets only its own name costs one entry and a hung
 * pipeline costs an hour.
 */
const CI_MARKERS = [
  'CI',
  'CONTINUOUS_INTEGRATION',
  'GITLAB_CI',
  'GITHUB_ACTIONS',
  'BUILDKITE',
  'CIRCLECI',
  'TF_BUILD',
  'TEAMCITY_VERSION',
  'JENKINS_URL',
] as const;

/** Is a CI marker set to something meaning yes? */
export function ciMarkerSet(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  return CI_MARKERS.some((marker) => {
    const value = environment[marker];
    if (value === undefined) return false;
    const normalised = value.trim().toLowerCase();
    // `CI=false` and `CI=0` are how a developer says "not a pipeline"; an empty
    // value is a variable exported and never set, which says nothing either.
    return normalised.length > 0 && normalised !== 'false' && normalised !== '0';
  });
}

/**
 * May this run issue a prompt? (R3.1 — a conjunction of five.)
 *
 * **Checking stdin alone is insufficient and R3.5 forbids it**: a run whose
 * stdout is captured and whose stdin is inherited would prompt into a log nobody
 * reads, which is the same hang wearing different clothes.
 *
 * There is deliberately no `--interactive` (R3.4). A flag that turns the
 * assistance on is a flag the person who needs it does not know about.
 */
export function mayPrompt(facts: InteractivityFacts): boolean {
  return (
    facts.stdinIsTty &&
    facts.stdoutIsTty &&
    !facts.nonInteractive &&
    !facts.dryRun &&
    !ciMarkerSet(facts.environment)
  );
}

/** The facts, read off this process. The only place the resolution touches globals. */
export function interactivityOf(options: {
  readonly nonInteractive: boolean;
  readonly dryRun: boolean;
}): InteractivityFacts {
  return {
    stdinIsTty: process.stdin.isTTY === true,
    stdoutIsTty: process.stdout.isTTY === true,
    nonInteractive: options.nonInteractive,
    dryRun: options.dryRun,
    environment: process.env,
  };
}

/**
 * The flag that supplies an input, derived from its name and never written down.
 *
 * `SESSION_COOKIE_SECRET` → `--session-cookie-secret`. Deriving it is what keeps
 * the refusal's remedy true for an input nobody has declared yet — including one
 * a module installed from a registry declares, which no table here could name.
 */
export function flagFor(name: string): string {
  return `--${name.toLowerCase().replace(/_/g, '-')}`;
}

/** The variable a flag names, inverted from {@link flagFor}. */
export function inputForFlag(flag: string): string {
  return flag.replace(/^--/, '').toUpperCase().replace(/-/g, '_');
}

/**
 * A value whose only required properties are that it is unguessable and
 * per-environment (R4.1).
 *
 * **32 random bytes, base64**, one format for every generable input, and the
 * format is not arbitrary: the platform's own secret settings are decrypted with
 * `Buffer.from(key, 'base64')` over a 32-byte AES key, so a hex key would fail
 * at the first secret setting an operator wrote. The same string is a perfectly
 * good cookie-signing key, which is why one format serves both and no `format`
 * field exists to get wrong.
 *
 * **Never at boot** (R4.4). That is a rule about the platform rather than about
 * this function, and it is why generation lives in a command an operator ran
 * once: a signing key that changed on restart would invalidate every session,
 * and a settings-encryption key that did would make every stored secret
 * unreadable. Both are worse than a refusal.
 */
export function generateSecret(): string {
  return randomBytes(32).toString('base64');
}

/**
 * The counts, over a record loose enough for a proof to break.
 *
 * The parameter is `{ provenance: string }` rather than {@link ResolvedInput} on
 * purpose: `defaulted` is a residue and a residue can only be *shown* to work by
 * handing in something outside the partition. With the parameter narrowed, the
 * one assertion that proves the guarantee would not compile.
 */
export function provenanceCounts(
  resolved: readonly { readonly provenance: string }[],
): ProvenanceCounts {
  const count = (tier: Provenance): number =>
    resolved.filter((entry) => entry.provenance === tier).length;
  const flags = count('flag');
  const envFile = count('env-file');
  const prompted = count('prompt');
  const generated = count('generated');
  return {
    total: resolved.length,
    flags,
    envFile,
    prompted,
    generated,
    defaulted: resolved.length - (flags + envFile + prompted + generated),
  };
}

/** The line itself (R2.1), in the estate's `read:` grammar. */
export function provenanceLine(
  resolved: readonly { readonly provenance: string; readonly name: string }[],
): string {
  const counts = provenanceCounts(resolved);
  const generatedNames = resolved
    .filter((entry) => entry.provenance === 'generated')
    .map((entry) => entry.name);
  // R2.3 — a count with no names is a disclosure an operator cannot act on. The
  // **name** is printed and the value never is: it is in the `.env` this run
  // wrote, which is where an operator can read it, change it and copy it into a
  // secret store.
  const named = generatedNames.length === 0 ? '' : ` (${generatedNames.join(', ')})`;
  return (
    `[inputs] resolved: total=${counts.total} flags=${counts.flags} ` +
    `env-file=${counts.envFile} prompted=${counts.prompted} ` +
    `generated=${counts.generated}${named} defaulted=${counts.defaulted}`
  );
}

/** Everything a resolution run needs, with no global read inside it. */
export interface ResolutionRequest {
  /** The whole declaration of the tree being written. */
  readonly declared: readonly EnvironmentInput[];
  /**
   * The members this run actually writes.
   *
   * `specs/118-instance-member-selection/`: an input read by no written member
   * is **out of the population** — not resolved, not prompted for, not counted,
   * not refused. Reading it the other way would force a fifth provenance
   * outcome, because such an input can be neither defaulted (there is nothing to
   * invent) nor honestly reported as resolved.
   */
  readonly members: readonly EnvironmentConsumer[];
  /** Values given as explicit flags — tier 1. */
  readonly flags: Readonly<Record<string, string | undefined>>;
  /** Values the target directory's own `.env` already supplies — tier 2. */
  readonly envFile: ReadonlyMap<string, string>;
  readonly interactivity: InteractivityFacts;
  /** Which language the reported sentences are in. */
  readonly language: 'en' | 'pl';
}

/** What a resolution decided, before anything is asked or written. */
export interface ResolutionPlan {
  /** Values already in hand, in declaration order. */
  readonly resolved: readonly ResolvedInput[];
  /**
   * Required, unanswered, and this run will ask — or, under `--dry-run`, would
   * have (R2.4).
   *
   * One list for both, because they are one answer to one question: *which
   * inputs is nobody supplying?* A dry run reports it, a real run acts on it,
   * and splitting them would let the two drift into disagreeing about the very
   * thing a dry run exists to preview.
   */
  readonly toPrompt: readonly EnvironmentInput[];
  /** Secret, generable, unanswered — a value this run may supply (R4.1). */
  readonly toGenerate: readonly EnvironmentInput[];
  /** Required, unanswered, and this run may not ask: the refusal (R3.2). */
  readonly missing: readonly MissingInput[];
  /** Declared, in scope, and legitimately left unset — an optional nobody set. */
  readonly unset: readonly EnvironmentInput[];
}

/**
 * The first two tiers, and the decision about the other two.
 *
 * Pure: it asks nothing, generates nothing and writes nothing, so a caller can
 * print the whole plan under `--dry-run` (R2.4, R7.3) and a test can assert
 * every branch without a terminal.
 *
 * **A condition is answered against the values this run has resolved**, not
 * against `process.env`, which is the case that happens: a run supplying
 * `--catalog-search-backend meilisearch` on its command line has to be asked for
 * `MEILISEARCH_URL` in the same run rather than in the next one.
 */
export function planResolution(request: ResolutionRequest): ResolutionPlan {
  const inScope = scopeToMembers(request.declared, request.members);
  const resolved: ResolvedInput[] = [];
  const values: Record<string, string | undefined> = {};

  const unanswered: EnvironmentInput[] = [];
  for (const input of inScope) {
    const flag = request.flags[input.name];
    if (flag !== undefined && flag.length > 0) {
      resolved.push({ name: input.name, value: flag, provenance: 'flag' });
      values[input.name] = flag;
      continue;
    }
    const fromFile = request.envFile.get(input.name);
    if (fromFile !== undefined && fromFile.length > 0) {
      resolved.push({ name: input.name, value: fromFile, provenance: 'env-file' });
      values[input.name] = fromFile;
      continue;
    }
    unanswered.push(input);
  }

  const interactive = mayPrompt(request.interactivity);
  const toPrompt: EnvironmentInput[] = [];
  const toGenerate: EnvironmentInput[] = [];
  const missing: MissingInput[] = [];
  const unset: EnvironmentInput[] = [];

  for (const input of unanswered) {
    // Generation comes before the prompt, and only for a value with no human
    // judgement in it (R4.5): asking a human to type a session-signing key gets
    // a human-typed one, reliably.
    if (input.generable && input.secret) {
      toGenerate.push(input);
      continue;
    }
    if (!isRequiredGiven(input, values)) {
      // R1.4 — an optional input is never prompted for.
      unset.push(input);
      continue;
    }
    // **A dry run reports; it does not refuse.** R2.4 and R7.3: it answers
    // *"what would happen"* completely, and an unanswered required input is
    // part of that answer rather than a reason to stop giving it. It is also
    // the reason `--dry-run` is one of R3.1's five conditions and not merely a
    // consequence of them — the run must neither ask nor refuse.
    if (interactive || request.interactivity.dryRun) {
      toPrompt.push(input);
      continue;
    }
    missing.push({
      name: input.name,
      flag: flagFor(input.name),
      describes: input.describes[request.language],
      secret: input.secret,
    });
  }

  return { resolved, toPrompt, toGenerate, missing, unset };
}

/**
 * The refusal a run that may not ask prints, naming **every** missing input
 * (R3.2).
 *
 * Not one per run: a twelve-input setup must not be twelve failed invocations,
 * and that is a design point rather than a nicety — it is precisely the
 * experience the owner asked to have removed.
 */
export function missingInputsRefusal(
  missing: readonly MissingInput[],
  facts: InteractivityFacts,
): string {
  const why = facts.dryRun
    ? 'this is a dry run, which resolves and reports and never asks'
    : facts.nonInteractive
      ? '`--non-interactive` was given'
      : !facts.stdinIsTty || !facts.stdoutIsTty
        ? 'neither a question nor its answer has anywhere to go: ' +
          `stdin ${facts.stdinIsTty ? 'is' : 'is not'} a terminal and stdout ` +
          `${facts.stdoutIsTty ? 'is' : 'is not'}`
        : 'a continuous-integration marker is set in the environment';
  const lines = missing.map(
    (input) => `  ${input.flag} <value>\n      ${input.describes}`,
  );
  return [
    `endora: ${missing.length} required input${missing.length === 1 ? '' : 's'} ` +
      `${missing.length === 1 ? 'is' : 'are'} not set, and this run cannot ask for ` +
      `${missing.length === 1 ? 'it' : 'them'} — ${why}.`,
    '',
    'Supply each on the command line, or put it in a `.env` in the target directory',
    'before running this again:',
    '',
    ...lines,
    '',
    'Nothing was written.',
  ].join('\n');
}
