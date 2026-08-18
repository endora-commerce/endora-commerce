/**
 * CI check — a reason string may not assert a lock the manifests contradict
 * (issue #216; D-100 generalised; Constitution XVII).
 *
 * `activation.nonDeactivatable` is a fact the build derives on every run, out
 * of the manifests, through `scripts/lib/switchable-modules.ts`. A sentence in
 * a ledger entry or a manifest comment that *restates* that fact is a copy with
 * no run behind it: the owner who withdraws a lock re-reds every site resting on
 * it in the same pipeline, while the sentence keeps asserting the opposite in
 * the file a reviewer opens to understand the edge. D-100 already forbade the
 * shape in acknowledged-edge reasons. It was found twice more within a day —
 * once in a ledger shard, which D-100 does not cover — so the prohibition is
 * enforced here, by derivation, wherever a reason is written.
 *
 * The instance that produced this check: a shard withdrew a written port
 * conversion on the stated ground that a module the manifests declare
 * `activation: { settingCode: …, default: true }` could not be switched off, and
 * reasoned from there that a real piece of work had to be reverted. The premise
 * was false, the work stayed reverted for a month, and nothing in the repository
 * could tell.
 *
 * ## The population, and what it deliberately excludes
 *
 * Artefacts whose job is to **carry a reason** — a sentence a reviewer consults
 * when deciding whether a piece of debt, an edge or a degrade may stand:
 *
 *   1. `scripts/ledgers/**` — every ledger shard, entry strings *and* the
 *      file-level and entry-level doc comments above them. The comment is where
 *      the instance above lived, so a check reading only the string values would
 *      have missed the defect it exists for.
 *   2. `scripts/check-*.ts` — the ledgers that live inside a check rather than
 *      in a shard: `TIMERS_WITHOUT_PRESENCE`, `BOOT_HOOKS_WITHOUT_PRESENCE`,
 *      `PORT_CATCHES_TO_DRAIN`, `DEFAULTED_FIXTURE_READS` and their peers, whose
 *      values are exactly the "why this site is right" sentences this refuses.
 *   3. Every module manifest, core and overlay — `nonBindingDependencies`
 *      (`reason`, `whenAbsent`), `acknowledgedDependencies` (`reason`),
 *      `activation.reason`, and the block comments that explain them.
 *
 * **Part 3 is a walk over the module tree, so it carries the derived-population
 * floor** (issue #215). The other two roots are `scripts/`, which no module move
 * touches — which is exactly the trap: on a *partial* move, the one a package
 * split performs, those ~90 files survive, the regenerated index still answers
 * "65 modules", the locked set is still complete, and a check guarding only its
 * own three vacuity conditions would read half the manifests and print
 * `violations=0`. None of those three sees it. `refuseVacuousModulePopulation`
 * does: it asks the index which modules exist and refuses when a registered one
 * contributed no file. Every registered module ships a `manifest.ts` by
 * construction — the index is generated from a walk over exactly those files —
 * so the floor is exact and takes no `excluded` list.
 *
 * **Ordinary source comments are out**, and that is a decision rather than an
 * oversight: a comment explaining code is not an artefact anybody consults to
 * decide whether debt may stand, and widening the predicate to 1370 module files
 * of prose buys no refusal that this population does not already make. A lock
 * claim that migrates into a service comment is not caught. Said plainly so the
 * green is read for what it is.
 *
 * ## What counts as a claim
 *
 * A claim has a **named subject**: the module id, spelled as a whole backticked
 * token, which is how this tree writes one. `` `fixture_module` is
 * non-deactivatable `` is in the population; *"this module is
 * non-deactivatable"*, *"the owner is non-deactivatable"* and *"both modules
 * are"* are **not** — the subject is a pronoun and resolving it is a reading
 * task, not a parse. A named-subject claim is the shape that spreads by copying
 * between manifests, which is the shape D-100 measured.
 *
 * Between the subject and the assertion the check requires a copula (`is`,
 * `are`, `was`, `remains`, `stays`, `being`) within a short window, and refuses
 * the window if it crosses a sentence boundary, a subordinator that introduces a
 * new subject (`because`, `since`, `so`, `while`, `when`, `if`, `unless`,
 * `and`, `but`), a fresh noun-phrase subject (`this module`, `the owner`, `it`)
 * or a negation. Without those guards
 * `` `x.enabled` unusable, because this module is non-deactivatable `` reads as
 * a claim about `x`, and it is not one.
 *
 * Two signals, one population, because the disease runs both ways:
 *
 *   1. **`stale-lock-claim`** — the text says a module cannot be switched off
 *      and its manifest declares an activation control. This is the #216 shape.
 *   2. **`stale-switchable-claim`** — the text says a module can be switched off
 *      and its manifest declares `nonDeactivatable`. The converse goes stale by
 *      the same mechanism, in the opposite direction: a lock *added* leaves
 *      every sentence that reasoned from its absence standing.
 *
 * **There is no ledger, deliberately.** A two-way ratchet licenses a finding
 * that is right to stand; a claim the manifests contradict is never right to
 * stand, so an entry could only license re-opening the hole. The repair is to
 * delete the clause — per D-100 a reason states the ground a human had to
 * decide, not a fact the build re-derives.
 *
 * Usage: `tsx scripts/check-lock-claims.ts [--list]`
 * Exit 0 = every named-subject lock claim agrees with the manifests;
 * exit 1 = at least one does not;
 * exit 2 = the check read nothing it needed — no artefacts, a manifest index
 * that would not load, no module ids, no lock derived, or a manifest walk that
 * came back short of the modules the index registers (issues #113, #215).
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { refuseVacuousModulePopulation } from './lib/module-population.js';
import {
  ManifestIndexUnreadableError,
  loadManifestActivations,
  lockedOwners,
  type ManifestActivationInput,
} from './lib/switchable-modules.js';

const BACKEND_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC_ROOT = join(BACKEND_ROOT, 'src');
const SCRIPTS_ROOT = join(BACKEND_ROOT, 'scripts');

/**
 * The assertions that mean "an operator cannot switch this off".
 *
 * Enumerated, and the enumeration is the check's honest limit: a spelling not
 * on this list reads as no claim at all. `nonDeactivatable` is the identifier,
 * the rest are how the tree writes the same thing in prose. `always present`
 * and `never absent` are here because the instance that produced the check used
 * the first of them as its load-bearing step — *"and `x` is always present"* —
 * without ever writing the word.
 */
export const LOCK_ASSERTIONS: readonly string[] = [
  'nondeactivatable',
  'non-deactivatable',
  'not deactivatable',
  'undeactivatable',
  'un-deactivatable',
  'always present',
  'never absent',
  'always on',
  'has no off state',
  'cannot be switched off',
  'cannot be deactivated',
  'cannot be disabled',
  'cannot be turned off',
];

/**
 * The assertions that mean "an operator can switch this off" — signal 2.
 *
 * Kept short on purpose. `deactivatable` on its own is a substring of three
 * entries above, so it is matched with a guard on the preceding character; the
 * rest are phrases with no such overlap.
 */
export const SWITCHABLE_ASSERTIONS: readonly string[] = [
  'deactivatable',
  'switchable',
  'can be switched off',
  'may be switched off',
  'can be deactivated',
  'may be deactivated',
];

/**
 * Fragments that end the window between a subject and an assertion.
 *
 * A sentence boundary, a subordinator that introduces a new clause, or a fresh
 * noun-phrase subject. Without them the check reads
 * `` `x.enabled` unusable, because this module is non-deactivatable `` as a
 * claim about `x` — a false finding on a true sentence whose subject is a
 * different module. (The example is written with a placeholder id on purpose:
 * a real one here would be a claim this check reads, and a doc block is not the
 * place to make one.)
 */
const WINDOW_BREAKERS: readonly string[] = [
  ' because ',
  ' since ',
  ' so ',
  ' while ',
  ' when ',
  ' if ',
  ' unless ',
  ' and ',
  ' but ',
  ' this module',
  ' that module',
  ' the module',
  ' both modules',
  ' the owner',
  ' its owner',
  ' every ',
  ' it ',
  ' they ',
];

/** A negated assertion is not the assertion. */
const NEGATORS: readonly string[] = [' not ', " n't ", ' never ', ' no longer '];

/** How far apart the subject, the copula and the assertion may sit. */
const WINDOW = 40;

const COPULAS: readonly string[] = ['is', 'are', 'was', 'were', 'remains', 'stays', 'being'];

export interface LockClaim {
  readonly file: string;
  readonly line: number;
  readonly moduleId: string;
  readonly assertion: string;
  readonly direction: 'locked' | 'switchable';
  readonly text: string;
}

export interface LockClaimFinding extends LockClaim {
  readonly kind: 'stale-lock-claim' | 'stale-switchable-claim';
}

/**
 * The text of a file, stripped of the decoration that would otherwise split a
 * claim across "lines" that are not sentence boundaries: block-comment stars,
 * `//`, and the `' + '` seam a wrapped string literal is written over.
 *
 * Returns the flattened text plus, for every character in it, the source line it
 * came from — so a finding still points at a line a reader can open.
 */
export function flatten(source: string): { text: string; lineOf: readonly number[] } {
  const chars: string[] = [];
  const lineOf: number[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i] ?? '';
    line = line.replace(/^\s*(\*\/|\/\*+|\*|\/\/)\s?/, '');
    line = line.trimStart();
    // The wrapped-string-literal seam: `'…text ' +` / `'more text.',`.
    line = line.replace(/'\s*\+\s*$/, '');
    line = line.replace(/^'/, '');
    for (const ch of line) {
      chars.push(ch);
      lineOf.push(i + 1);
    }
    chars.push(' ');
    lineOf.push(i + 1);
  }
  return { text: chars.join(''), lineOf: lineOf };
}

function windowIsClean(fragment: string): boolean {
  const padded = ` ${fragment.toLowerCase()} `;
  if (/[.;:!?]/.test(fragment)) return false;
  if (WINDOW_BREAKERS.some((breaker) => padded.includes(breaker))) return false;
  if (NEGATORS.some((negator) => padded.includes(negator))) return false;
  return true;
}

/**
 * Every named-subject claim in one artefact.
 *
 * Takes the source text and the module ids, so a red proof drives the whole
 * classification from a fixture string rather than from a value the check would
 * normally have computed (issue #130).
 */
export function findLockClaims(
  file: string,
  source: string,
  moduleIds: ReadonlySet<string>,
): LockClaim[] {
  const { text, lineOf } = flatten(source);
  const lower = text.toLowerCase();
  const claims: LockClaim[] = [];

  const subject = /`([a-z_][a-z0-9_]*)`/g;
  let match: RegExpExecArray | null;
  while ((match = subject.exec(text)) !== null) {
    const moduleId = match[1] ?? '';
    if (!moduleIds.has(moduleId)) continue;
    const after = match.index + match[0].length;
    const tail = lower.slice(after, after + WINDOW * 2 + 12);

    for (const copula of COPULAS) {
      const copulaAt = tail.search(new RegExp(`\\b${copula}\\b`));
      if (copulaAt < 0 || copulaAt > WINDOW) continue;
      if (!windowIsClean(tail.slice(0, copulaAt))) continue;
      const rest = tail.slice(copulaAt + copula.length);

      const hit = assertionIn(rest.slice(0, WINDOW + 24));
      if (!hit) continue;
      if (!windowIsClean(rest.slice(0, hit.at))) continue;

      claims.push({
        file,
        line: lineOf[match.index] ?? 1,
        moduleId,
        assertion: hit.assertion,
        direction: hit.direction,
        text: text.slice(match.index, after + copulaAt + copula.length + hit.at + hit.assertion.length).trim(),
      });
      break;
    }
  }
  return claims;
}

function assertionIn(
  fragment: string,
): { assertion: string; direction: 'locked' | 'switchable'; at: number } | null {
  let best: { assertion: string; direction: 'locked' | 'switchable'; at: number } | null = null;
  for (const assertion of LOCK_ASSERTIONS) {
    const at = fragment.indexOf(assertion);
    if (at < 0) continue;
    if (!best || at < best.at) best = { assertion, direction: 'locked', at };
  }
  for (const assertion of SWITCHABLE_ASSERTIONS) {
    const at = fragment.indexOf(assertion);
    if (at < 0) continue;
    // `deactivatable` is a tail of `non-deactivatable`, `undeactivatable` and
    // `not deactivatable`; the preceding character decides which was written.
    const prev = at === 0 ? ' ' : (fragment[at - 1] ?? ' ');
    if (assertion === 'deactivatable' && /[-a-z)]/.test(prev)) continue;
    if (!best || at < best.at) best = { assertion, direction: 'switchable', at };
  }
  return best;
}

/**
 * The claims the manifests contradict.
 *
 * Pure, and takes the locked set, so a proof can drive it from a fixture
 * manifest list — which is the point: the classification has to move when the
 * manifests move, in the same run.
 */
export function classifyLockClaims(
  claims: readonly LockClaim[],
  locked: ReadonlySet<string>,
): LockClaimFinding[] {
  const findings: LockClaimFinding[] = [];
  for (const claim of claims) {
    if (claim.direction === 'locked' && !locked.has(claim.moduleId)) {
      findings.push({ ...claim, kind: 'stale-lock-claim' });
    }
    if (claim.direction === 'switchable' && locked.has(claim.moduleId)) {
      findings.push({ ...claim, kind: 'stale-switchable-claim' });
    }
  }
  return findings;
}

export interface LockClaimsResult {
  readonly claims: readonly LockClaim[];
  readonly findings: readonly LockClaimFinding[];
}

/**
 * The whole analysis over a file map — the seam every red proof enters at.
 */
export function checkLockClaims(opts: {
  sources: ReadonlyMap<string, string>;
  manifests: readonly ManifestActivationInput[];
}): LockClaimsResult {
  const moduleIds = new Set(opts.manifests.map((manifest) => manifest.id));
  const locked = lockedOwners(opts.manifests);
  const claims: LockClaim[] = [];
  for (const [file, source] of opts.sources) {
    claims.push(...findLockClaims(file, source, moduleIds));
  }
  return { claims, findings: classifyLockClaims(claims, locked) };
}

function walk(dir: string, accept: (path: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, accept, out);
    else if (accept(full)) out.push(full);
  }
  return out;
}

/** The declared population, on disk. */
export function collectArtifacts(roots: { srcRoot: string; scriptsRoot: string }): string[] {
  const ledgers = walk(join(roots.scriptsRoot, 'ledgers'), (path) => path.endsWith('.ts'));
  const checks = walk(roots.scriptsRoot, (path) => /(^|\/|\\)check-[a-z-]+\.ts$/.test(path)).filter(
    (path) => !path.includes(`${'ledgers'}/`),
  );
  const manifests = [
    ...walk(join(roots.srcRoot, 'modules'), (path) => path.endsWith('/manifest.ts')),
    ...walk(join(roots.srcRoot, 'apps'), (path) => path.endsWith('/manifest.ts')),
  ];
  return [...ledgers, ...checks, ...manifests];
}

/**
 * Why this run would be reporting on nothing, or `null` if it would not.
 *
 * Extracted so these three are provable without a doctored checkout. They are
 * not the whole guard: the fourth way this check can go silently blind is a
 * manifest walk that came back short, and that one needs a tree rather than a
 * value, so it is `refuseVacuousModulePopulation`'s and its proof is a spawn
 * over a moved tree (issues #113, #215).
 */
export function vacuousReason(
  files: readonly string[],
  manifests: readonly ManifestActivationInput[],
): string | null {
  if (files.length === 0) {
    return 'no reason-carrying artefacts found';
  }
  if (manifests.length === 0) {
    return 'no module ids derived from the manifest index';
  }
  if (lockedOwners(manifests).size === 0) {
    return (
      'the manifests declared no non-deactivatable module — that is either a platform with ' +
      'no core or an index that did not load'
    );
  }
  return null;
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');

  const files = collectArtifacts({ srcRoot: SRC_ROOT, scriptsRoot: SCRIPTS_ROOT });

  let manifests: readonly ManifestActivationInput[] = [];
  if (files.length > 0) {
    try {
      manifests = await loadManifestActivations(SRC_ROOT);
    } catch (err: unknown) {
      if (err instanceof ManifestIndexUnreadableError) {
        console.error(`[lock-claims] ${err.message} — refusing to report a vacuous pass`);
        process.exit(2);
      }
      throw err;
    }
  }

  const vacuous = vacuousReason(files, manifests);
  if (vacuous !== null) {
    console.error(`[lock-claims] ${vacuous} — refusing to report a vacuous pass`);
    process.exit(2);
  }
  // Issue #215's floor: the three conditions above all pass on a partial move,
  // because `scripts/` survives it and the regenerated index still answers for
  // every module. Only a per-module floor sees a manifest walk that came back
  // short, and it sees it without anybody choosing a number.
  await refuseVacuousModulePopulation({
    prefix: '[lock-claims]',
    srcRoot: SRC_ROOT,
    files,
  });
  const locked = lockedOwners(manifests);

  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(relative(BACKEND_ROOT, file).split('\\').join('/'), readFileSync(file, 'utf8'));
  }

  const result = checkLockClaims({ sources, manifests });

  if (listMode) {
    for (const claim of result.claims) {
      const stale = result.findings.some(
        (finding) => finding.file === claim.file && finding.line === claim.line,
      );
      console.log(
        `${stale ? 'STALE ' : 'AGREES'} ${claim.file}:${claim.line}  \`${claim.moduleId}\` ` +
          `${claim.direction} — "${claim.text}"`,
      );
    }
    console.log('');
  }

  console.log(
    `[lock-claims] artefacts=${files.length} named-subject claims=${result.claims.length} ` +
      `violations=${result.findings.length} locked-modules=${locked.size} ` +
      `modules=${manifests.length}`,
  );

  if (result.findings.length > 0) {
    console.error(
      '\nA reason asserts a lock the manifests contradict (issue #216, D-100).\n' +
        'The locked set is derived from `activation.nonDeactivatable` on every run;\n' +
        'a sentence restating it is a copy no run re-derives. Delete the clause —\n' +
        'a reason states the ground a human had to decide, not a fact the build knows.\n',
    );
    for (const finding of result.findings) {
      const says =
        finding.kind === 'stale-lock-claim'
          ? 'says it cannot be switched off; its manifest declares an activation control'
          : 'says it can be switched off; its manifest declares `nonDeactivatable`';
      console.error(
        `  - ${finding.file}:${finding.line}  [${finding.kind}] \`${finding.moduleId}\` ${says}\n` +
          `      "${finding.text}"`,
      );
    }
  }

  process.exit(result.findings.length > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
