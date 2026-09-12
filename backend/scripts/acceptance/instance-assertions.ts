/**
 * The verdicts of the `endora new instance` acceptance criterion, separated
 * from everything that runs a process.
 *
 * The split is `acceptance/assertions.ts`' and
 * `storefront-scaffold-assertions.ts`': the judgement is pure and unit tested
 * over fixture text, so a red proof per finding costs no install, no database
 * and no boot. Importing this file starts nothing — its one import is the
 * command's own `.npmrc` derivation (see {@link hostNpmrc}), a barrel of pure
 * functions.
 *
 * ## The assertion numbering carries a collision this file did not invent
 *
 * `contracts/instance-repository.md` R6.3 numbers twelve assertions A1…A12 and
 * a thirteenth, **A13**, which is FR-023/SC-011's — *the created instance's
 * built admin stylesheet carries a utility class that only an installed package
 * declares*. `contracts/instance-tree.md` §6 says the criterion is R6.3's
 * *"unchanged, plus one assertion this contract adds"*, and numbers **that**
 * one A13 as well — R1.4's wiring bound, measured on the created tree.
 *
 * Two contracts, one id, two different subjects. Dropping either would be the
 * criterion silently answering one contract and not the other, so this file
 * carries **fourteen**: A13 is R6.3's, and `instance-tree.md` §6's is **A14**.
 * The choice is arbitrary in one direction only — R6.3's A13 is the later
 * writing and is cited by a functional requirement and a success criterion,
 * `instance-tree.md`'s by neither — and it is recorded here rather than fixed
 * in either contract, because renumbering a contract is the owner's.
 */
import { authKeys, normalizeRegistry, TOKEN_VARIABLE } from '@endora-commerce/cli';

/** One assertion's outcome. `unmeasured` is neither a pass nor a failure. */
export type AssertionState = 'pass' | 'fail' | 'unmeasured';

export interface AssertionResult {
  readonly id: AssertionId;
  readonly state: AssertionState;
  readonly detail: string;
}

/**
 * How the instance got its `@endora-commerce/*` packages.
 *
 * `tarball` packs each one out of this checkout and pins it — publication's
 * stand-in, the only mode that works before the first publish, and therefore
 * the default. `registry` installs the semver ranges the scaffold wrote, from a
 * real registry, through the `.npmrc` `endora new instance --registry` emits.
 *
 * The two are one criterion asked of two supply routes, not two criteria: the
 * assertions are identical and only the install differs. Which one a run takes
 * is decided by `ENDORA_NPM_REGISTRY` in the environment and by nothing else,
 * which is `acceptance:storefront-scaffold`'s arrangement unchanged.
 */
export type AcceptanceMode = 'tarball' | 'registry';

export type AssertionId =
  | 'A1'
  | 'A2'
  | 'A3'
  | 'A4'
  | 'A5'
  | 'A6'
  | 'A7'
  | 'A8'
  | 'A9'
  | 'A10'
  | 'A11'
  | 'A12'
  | 'A13'
  | 'A14';

/**
 * What each assertion is, independently of any run.
 *
 * Written down so a report can name an assertion **no step answered**. An id
 * missing from the output is the one shape of vacuous result this whole file
 * exists to prevent, and it cannot be reported without a title to report it
 * under — `acceptance/assertions.ts`' `ASSERTION_CATALOGUE`, one criterion
 * over.
 */
export const ASSERTION_CATALOGUE: Readonly<Record<AssertionId, string>> = {
  A1: 'the created tree contains zero references above its own directory',
  A2: 'it installs — from a registry, or from tarballs until publication',
  A3: 'it migrates a real PostgreSQL, in the order `migration-order.ts` computes over the installed manifests',
  A4: 'it boots; health answers 200; the reconcile line accounts for every module the presence route enumerates',
  A5: 'the admin bundle contains the admin layers of exactly the installed modules',
  A6: 'the documentation site builds and its navigation names the installed modules pages',
  A7: 'a module the instance did not install is named nowhere in the bundle, the API surface or the enumeration',
  A8: 'an overlay module in the created tree is composed, and its decoration appears in the divergence report',
  A9: 'the tenancy guard is active: a cross-tenant read is refused in the created instance',
  A10: 'a module set missing a required module is refused before writing, with the platform own sentence',
  A11: 'the created tree contains no file of the platform and none of the admin shell',
  A12: 'a published platform patch reaches the instance through `pnpm update`, with no file in it edited',
  A13: 'the built admin stylesheet carries a utility class only an installed package declares',
  A14: 'the wiring the created tree holds is under the bound, measured on the tree rather than on the template',
};

export const ASSERTION_IDS = Object.keys(ASSERTION_CATALOGUE) as readonly AssertionId[];

/**
 * R1.4's bound on the wiring the command writes.
 *
 * **One number in three places, and this is the third.** It is the literal
 * `250` in `contracts/instance-tree.md` R1.4, a literal in
 * `packages/cli/test/new-instance.test.ts` (T13A's own note records that), and
 * this. A shared constant would have to live in the CLI, which is the package
 * whose output the bound is about — so the criterion would be reading the
 * measured party's own answer, and A14's whole reason for existing is that it
 * is measured on the *created tree* rather than on the template. Until the
 * contract's number has a machine-readable home outside the tool it constrains,
 * a third copy with the citation beside it is the honest arrangement.
 */
export const WIRING_LINE_BOUND = 250;

/** What one assertion is recorded as, and why. */
export interface RecordedAssertion {
  readonly status: AssertionState;
  /**
   * The contract or task this state waits on — T140's own done-when.
   *
   * Held to that by {@link expectationRefusals}: a non-`pass` entry whose
   * reason names neither a task nor a contract is a refusal, not a comparison.
   * *"Unimplemented"* is the entry a reader learns nothing from, and it is the
   * word the row names.
   */
  readonly reason: string;
}

/**
 * What one mode is recorded as.
 *
 * `unrun` is a state of its own and not an empty `recorded`: a mode nobody has
 * run yet owes no assertion states, and recording a *prediction* of them would
 * be the thing this file exists to refuse. The first run of such a mode drifts
 * — naming every assertion it measured — which is what makes the record arrive
 * from a measurement rather than from a guess.
 */
export interface ModeExpectation {
  readonly state: 'recorded' | 'unrun';
  readonly assertions?: Readonly<Record<string, RecordedAssertion>>;
}

export interface AcceptanceExpectation {
  readonly modes: Readonly<Record<string, ModeExpectation>>;
}

/** One outward reference the command's own derivation found in the created tree. */
export interface OutwardReference {
  readonly file: string;
  readonly specifier: string;
}

/**
 * A1 — the created tree names nothing above its own directory.
 *
 * The input is the command's own re-derivation over what it wrote, so this
 * assertion is about the *tree* rather than about the plan that produced it.
 * It is evaluated **before** the harness pins anything: publication's stand-in
 * writes `file:` specifiers naming a directory outside the instance, which are
 * outward references by construction and are the harness's, not the command's.
 */
export function evaluateA1(outward: readonly OutwardReference[]): AssertionResult {
  if (outward.length === 0) {
    return {
      id: 'A1',
      state: 'pass',
      detail: 'no file in the created tree names anything above its own directory',
    };
  }
  return {
    id: 'A1',
    state: 'fail',
    detail: `${String(outward.length)} outward reference${outward.length === 1 ? '' : 's'}: ${outward
      .slice(0, 5)
      .map((reference) => `${reference.file} -> ${reference.specifier}`)
      .join(', ')}`,
  };
}

/**
 * The generic "a process this criterion ran either worked or did not" verdict.
 *
 * `storefront-scaffold-assertions.ts`' `evaluateProcess`, with the id typed to
 * this criterion's own set. The last lines of the output rather than the first:
 * a failing install, build or migration says what went wrong at the end.
 */
export function evaluateProcess(
  id: AssertionId,
  code: number,
  output: string,
  passDetail: string,
): AssertionResult {
  if (code === 0) return { id, state: 'pass', detail: passDetail };
  return {
    id,
    state: 'fail',
    detail: `exit ${String(code)}: ${lastLines(output, 6)}`,
  };
}

function lastLines(output: string, count: number): string {
  return output
    .replace(/\[[0-9;]*m/g, '')
    .trim()
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-count)
    .join(' / ');
}

/**
 * What `mikro_orm_migrations` had to say, and the three answers are not one.
 *
 * `absent` is the table not being there at all, and it is a **finding rather
 * than a silence**: the database is this run's own and was created empty a
 * moment earlier, so a migrate step that exited 0 and left no migrations table
 * did nothing. `unreadable` is a connection or a query that failed, which is
 * the run not being able to see, and is the only one of the three that is
 * `unmeasured`.
 */
export type AppliedMigrations =
  | { readonly kind: 'read'; readonly names: readonly string[] }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly error: string };

/** What A3 observed: the migration process, and the two orders it can compare. */
export interface MigrationObservation {
  /** `null` when the build that produces the migrator never happened. */
  readonly migrateCode: number | null;
  readonly migrateOutput: string;
  /** The class names the instance own configuration put in execution order. */
  readonly computedOrder: readonly string[] | null;
  /** What the database recorded. */
  readonly applied: AppliedMigrations | null;
}

/**
 * A3 — the instance migrates a real PostgreSQL **in the computed order**.
 *
 * Two claims, and the second is why this is not `evaluateProcess`. A migration
 * run that exits 0 says the statements ran; it says nothing about whether they
 * ran in the order `migration-order.ts` computes over the *installed*
 * manifests, which is the subject `contracts/instance-migration-order.md`
 * settles and the reason R6.3 spells A3 the way it does. So the order the
 * instance own configuration computed is read out of that instance, and the
 * order the database recorded is read out of `mikro_orm_migrations`, and a
 * disagreement between the two is a red with the first divergent position
 * named.
 *
 * An exit-0 run whose order could not be read is **unmeasured**, never a pass:
 * the arithmetic half is the half a green would be claiming.
 */
export function evaluateA3(observed: MigrationObservation): AssertionResult {
  if (observed.migrateCode === null) {
    return {
      id: 'A3',
      state: 'unmeasured',
      detail: 'there was no migrator to run',
    };
  }
  if (observed.migrateCode !== 0) {
    return {
      id: 'A3',
      state: 'fail',
      detail: `the instance own migrate step exited ${String(observed.migrateCode)}: ${lastLines(
        observed.migrateOutput,
        8,
      )}`,
    };
  }
  if (observed.applied === null || observed.applied.kind === 'unreadable') {
    return {
      id: 'A3',
      state: 'unmeasured',
      detail:
        `the migration run exited 0 and this run could not read \`mikro_orm_migrations\` back` +
        `${observed.applied === null ? '' : `: ${observed.applied.error}`}`,
    };
  }
  if (observed.applied.kind === 'absent') {
    return {
      id: 'A3',
      state: 'fail',
      detail:
        'the instance own migrate step exited 0 and the database this run created a moment ' +
        'earlier holds no `mikro_orm_migrations` table at all, so nothing was migrated. An ' +
        'exit code is not evidence that a step ran. Last lines: ' +
        lastLines(observed.migrateOutput, 4),
    };
  }
  if (observed.applied.names.length === 0) {
    return {
      id: 'A3',
      state: 'fail',
      detail:
        '`mikro_orm_migrations` is empty after a migration run that exited 0, so no migration ' +
        'ran at all',
    };
  }
  if (observed.computedOrder === null) {
    return {
      id: 'A3',
      state: 'unmeasured',
      detail:
        `${String(observed.applied.names.length)} migrations are recorded as applied and this ` +
        `run could not read back the order the instance own configuration computed, so the ` +
        `half a pass would be claiming was not measured`,
    };
  }
  const divergence = firstDivergence(observed.computedOrder, observed.applied.names);
  if (divergence !== null) {
    return {
      id: 'A3',
      state: 'fail',
      detail:
        `the applied order diverges from the order the instance own configuration computed ` +
        `at position ${String(divergence.index)}: computed ${divergence.computed ?? '(nothing)'}, ` +
        `applied ${divergence.applied ?? '(nothing)'}`,
    };
  }
  return {
    id: 'A3',
    state: 'pass',
    detail:
      `${String(observed.applied.names.length)} migrations applied, in the order the instance ` +
      `own configuration computed over the manifests it installed`,
  };
}

function firstDivergence(
  computed: readonly string[],
  applied: readonly string[],
): { index: number; computed: string | null; applied: string | null } | null {
  const length = Math.max(computed.length, applied.length);
  for (let index = 0; index < length; index += 1) {
    if (computed[index] !== applied[index]) {
      return {
        index,
        computed: computed[index] ?? null,
        applied: applied[index] ?? null,
      };
    }
  }
  return null;
}

/** What A4 observed: one boot of the created instance. */
export interface BootObservation {
  /** `null` when there was nothing built to boot. */
  readonly started: boolean;
  /** The status the health route answered, or `null` when it never answered. */
  readonly healthStatus: number | null;
  /** The boot own `[i18n] reconcile complete` figures, when it printed one. */
  readonly reconcile: { installed: number; skipped: number; failed: number } | null;
  /** How many modules `/api/v1/storefront/module-presence` enumerated. */
  readonly enumerated: number | null;
  readonly output: string;
}

/**
 * A4 — it boots, health answers 200, and the reconcile accounts for every
 * module the presence route enumerates.
 *
 * **The arithmetic assertion, not `installed > 0`**, for `boot-gate.sh`'s
 * measured reason: with the runtime assets gone from a build the module
 * packages still carry their bundles inside `node_modules` and some of them
 * still install, so a cheerful non-zero `installed` stands over a platform
 * whose other modules serve raw keys. The population the reconciler walked has
 * to equal the population the platform enumerates, and the presence route is
 * the independent author of that number.
 */
export function evaluateA4(observed: BootObservation): AssertionResult {
  if (!observed.started) {
    return { id: 'A4', state: 'unmeasured', detail: 'there was nothing built to boot' };
  }
  if (observed.healthStatus === null) {
    return {
      id: 'A4',
      state: 'fail',
      detail: `the instance never answered on its health route: ${lastLines(observed.output, 8)}`,
    };
  }
  if (observed.healthStatus !== 200) {
    return {
      id: 'A4',
      state: 'fail',
      detail: `the health route answered ${String(observed.healthStatus)}, not 200`,
    };
  }
  if (observed.reconcile === null) {
    return {
      id: 'A4',
      state: 'fail',
      detail:
        'the boot log carries no `[i18n] reconcile complete` line at all, so no module ' +
        'installed any translation and the instance is serving raw i18n keys',
    };
  }
  if (observed.enumerated === null) {
    return {
      id: 'A4',
      state: 'unmeasured',
      detail:
        'the module-presence route did not answer, so there is no independent count to hold ' +
        'the reconcile line to and `installed > 0` is all a pass could mean',
    };
  }
  const accounted = observed.reconcile.installed + observed.reconcile.skipped + observed.reconcile.failed;
  if (observed.reconcile.failed > 0) {
    return {
      id: 'A4',
      state: 'fail',
      detail: `the boot reconcile reports failed=${String(observed.reconcile.failed)}`,
    };
  }
  if (accounted !== observed.enumerated) {
    return {
      id: 'A4',
      state: 'fail',
      detail:
        `the boot reconcile accounts for ${String(accounted)} modules ` +
        `(installed=${String(observed.reconcile.installed)} ` +
        `skipped=${String(observed.reconcile.skipped)} ` +
        `failed=${String(observed.reconcile.failed)}) and the presence route enumerates ` +
        `${String(observed.enumerated)}`,
    };
  }
  return {
    id: 'A4',
    state: 'pass',
    detail:
      `health 200 and the boot reconcile accounts for all ${String(observed.enumerated)} ` +
      `modules the presence route enumerates ` +
      `(installed=${String(observed.reconcile.installed)} ` +
      `skipped=${String(observed.reconcile.skipped)})`,
  };
}

/**
 * The last `[i18n] reconcile complete — installed=N skipped=M failed=K` line.
 *
 * The **last**, not the first: an admin route runs the same reconcile, and a
 * reader that took the first line would be answering about whichever boot phase
 * happened to print one — `scripts/lib/boot-gate-assert.sh`'s own rule, in the
 * language this criterion is written in.
 */
export function reconcileFigures(
  log: string,
): { installed: number; skipped: number; failed: number } | null {
  const lines = log
    .replace(/\[[0-9;]*m/g, '')
    .split('\n')
    .filter((line) => line.includes('[i18n] reconcile complete'));
  const last = lines[lines.length - 1];
  if (last === undefined) return null;
  const read = (field: string): number | null => {
    const match = new RegExp(`${field}=(\\d+)`).exec(last);
    return match === null ? null : Number(match[1]);
  };
  const installed = read('installed');
  const skipped = read('skipped');
  const failed = read('failed');
  if (installed === null || skipped === null || failed === null) return null;
  return { installed, skipped, failed };
}

/** What A10 observed: the refusal `endora new instance` gave an uncomposable set. */
export interface RefusalObservation {
  readonly exitCode: number;
  readonly output: string;
  /** Whether the target directory holds anything after the refusal. */
  readonly wroteAnything: boolean;
  /**
   * The sentences the installed manifests give for the modules the platform
   * cannot run without — derived from the packages this run resolved, never a
   * list in this file (D-100). A refusal quoting one of them is the platform's
   * own sentence; a refusal quoting none is the command's second copy.
   */
  readonly platformSentences: readonly string[];
}

/**
 * A10 — an uncomposable module set is refused **before writing**, with the
 * platform's own sentence.
 *
 * Three claims and all three are the assertion: the exit code is `1` (a refusal
 * the operator can act on, `instance-tree.md` §4 F2), the target directory is
 * untouched, and the sentence the operator reads is one an installed manifest
 * carries rather than one the command composed for itself. The third is what
 * R5.6 and D-100 are about — a second list is a second answer waiting to
 * disagree — and it is the one a criterion that only checked the exit code
 * would miss.
 */
export function evaluateA10(observed: RefusalObservation): AssertionResult {
  if (observed.platformSentences.length === 0) {
    return {
      id: 'A10',
      state: 'unmeasured',
      detail:
        'no installed manifest declares a reason for being required, so this run has no ' +
        'platform sentence to hold the refusal to and could only have checked the exit code',
    };
  }
  if (observed.exitCode !== 1) {
    return {
      id: 'A10',
      state: 'fail',
      detail:
        `the command exited ${String(observed.exitCode)} for a module set missing a required ` +
        `module; \`instance-tree.md\` §4 F2 is exit 1. Output: ${lastLines(observed.output, 4)}`,
    };
  }
  if (observed.wroteAnything) {
    return {
      id: 'A10',
      state: 'fail',
      detail: 'the command refused and the target directory is not empty — it wrote before validating',
    };
  }
  const quoted = observed.platformSentences.find((sentence) =>
    observed.output.includes(sentence),
  );
  if (quoted === undefined) {
    return {
      id: 'A10',
      state: 'fail',
      detail:
        'the refusal quotes none of the sentences the installed manifests give, so the ' +
        'operator is reading a second copy of a derived fact rather than the platform own ' +
        'answer (R5.6, D-100)',
    };
  }
  return {
    id: 'A10',
    state: 'pass',
    detail:
      'exit 1, nothing written, and the refusal carries the sentence the owning manifest ' +
      `declares: "${quoted.slice(0, 80)}${quoted.length > 80 ? '…' : ''}"`,
  };
}

/** One file the created tree holds, or one a package ships. */
export interface DigestedFile {
  readonly path: string;
  readonly digest: string;
}

export interface ShippedFiles {
  readonly packageName: string;
  /** Whether the package resolved at all in the created instance. */
  readonly resolved: boolean;
  readonly files: readonly DigestedFile[];
}

/**
 * A11 — the created tree holds no file of the platform's and none of the
 * shell's, **by name against what those packages ship**.
 *
 * The comparison is by **content digest** rather than by path, and that is the
 * stronger reading of R6.3's *"never against a list written into the
 * criterion"*: a copied file put somewhere else is the same violation, and a
 * path comparison would miss it while a list in this file would go stale the
 * first time either package added one.
 *
 * Zero-byte files are outside the population and the exclusion is stated rather
 * than discovered: the tree writes an empty `.gitkeep`, every empty file has
 * the same digest as every other, and *"this tree holds a file the platform
 * also ships, and it is nothing"* is a finding about the digest and not about
 * the tree.
 */
export function evaluateA11(
  tree: readonly DigestedFile[],
  shipped: readonly ShippedFiles[],
): AssertionResult {
  if (shipped.length === 0) {
    return {
      id: 'A11',
      state: 'unmeasured',
      detail:
        'neither the platform nor the admin shell resolved, so there is nothing to compare ' +
        'the created tree against and an empty intersection would be vacuous',
    };
  }
  const unresolved = shipped.filter((entry) => !entry.resolved);
  const empty = shipped.filter((entry) => entry.resolved && entry.files.length === 0);
  if (unresolved.length > 0 || empty.length > 0) {
    const clean = shipped.filter((entry) => entry.resolved && entry.files.length > 0);
    const cleanVerdict = evaluateA11(tree, clean);
    return {
      id: 'A11',
      state: 'unmeasured',
      detail:
        `${[...unresolved, ...empty].map((entry) => entry.packageName).join(', ')} ` +
        `${unresolved.length + empty.length === 1 ? 'does' : 'do'} not resolve in the created ` +
        `instance, so half of a two-part claim would be vacuously true. The half that has a ` +
        `subject: ${cleanVerdict.state} — ${cleanVerdict.detail}`,
    };
  }
  const byDigest = new Map<string, string>();
  for (const entry of shipped) {
    for (const file of entry.files) {
      if (!byDigest.has(file.digest)) byDigest.set(file.digest, `${entry.packageName}/${file.path}`);
    }
  }
  const collisions = tree
    .map((file) => ({ file, origin: byDigest.get(file.digest) }))
    .filter((candidate): candidate is { file: DigestedFile; origin: string } =>
      candidate.origin !== undefined,
    );
  if (collisions.length > 0) {
    return {
      id: 'A11',
      state: 'fail',
      detail:
        `${String(collisions.length)} file${collisions.length === 1 ? '' : 's'} in the created ` +
        `tree ${collisions.length === 1 ? 'is' : 'are'} byte-identical to one those packages ` +
        `ship: ${collisions
          .slice(0, 5)
          .map((collision) => `${collision.file.path} = ${collision.origin}`)
          .join(', ')}`,
    };
  }
  const total = shipped.reduce((sum, entry) => sum + entry.files.length, 0);
  return {
    id: 'A11',
    state: 'pass',
    detail:
      `none of the ${String(tree.length)} files the command wrote is byte-identical to any of ` +
      `the ${String(total)} ${shipped.map((entry) => entry.packageName).join(' and ')} ships`,
  };
}

/**
 * What A5 read: the built admin bundle, and who was entitled to be in it.
 *
 * `expected` is derived from the **installed packages' own `exports` maps** and
 * not from the registry the generator wrote, which is R6.3's own instruction —
 * *"asserted over the built bundle, not over the registry that produced it"*.
 * Two authors, deliberately: the generator says which layers it imported, the
 * packages say which layers they publish, and the bundle is the evidence. A
 * criterion that read the generator's artefact at both ends would be asserting
 * one program against itself, which is `evaluateA3`'s arrangement one surface
 * over — it recomputes the migration order rather than reading the one the
 * platform logged.
 */
export interface AdminBundleObservation {
  /** Did the instance's own `build` script produce an admin bundle? */
  readonly built: boolean;
  /** Module ids the built bundle names. */
  readonly named: readonly string[];
  /** Module ids whose installed package publishes an admin layer. */
  readonly expected: readonly string[];
  /** Every installed module id, whether or not it ships a screen. */
  readonly installed: readonly string[];
  /** Bytes of JavaScript read, so a bundle that is there and empty is visible. */
  readonly bytes: number;
}

/**
 * A5 — the admin bundle holds the admin layers of **exactly** the installed
 * modules.
 *
 * Both directions, and they are different defects: a missing id is a screen the
 * client installed and cannot reach, and an extra one is a module they did not
 * install advertising itself in their operator interface (which is also A7's
 * subject, asked of a wider population).
 */
export function evaluateA5(observed: AdminBundleObservation): AssertionResult {
  if (!observed.built) {
    return {
      id: 'A5',
      state: 'unmeasured',
      detail:
        'the instance\'s own `build` script produced no admin bundle, so there is nothing to ' +
        'read; whatever went wrong is reported by A3, which is the assertion that runs it',
    };
  }
  if (observed.bytes === 0) {
    return {
      id: 'A5',
      state: 'unmeasured',
      detail: 'the admin bundle is there and holds no JavaScript, so it is evidence of nothing',
    };
  }
  if (observed.expected.length === 0) {
    return {
      id: 'A5',
      state: 'unmeasured',
      detail:
        `none of the ${String(observed.installed.length)} installed module packages publishes ` +
        'an admin layer, so "exactly the installed modules" is satisfied by an empty set and ' +
        'says nothing about whether a screen would have been bundled',
    };
  }
  const missing = observed.expected.filter((id) => !observed.named.includes(id));
  const extra = observed.named.filter((id) => !observed.expected.includes(id));
  if (missing.length > 0 || extra.length > 0) {
    return {
      id: 'A5',
      state: 'fail',
      detail:
        `${String(observed.expected.length)} installed module packages publish an admin layer ` +
        `and the built bundle names ${String(observed.named.length)}` +
        (missing.length > 0 ? `; missing: ${missing.join(', ')}` : '') +
        (extra.length > 0 ? `; not installed and named anyway: ${extra.join(', ')}` : ''),
    };
  }
  return {
    id: 'A5',
    state: 'pass',
    detail:
      `the built bundle names exactly the ${String(observed.expected.length)} installed module ` +
      `packages that publish an admin layer, out of ${String(observed.installed.length)} ` +
      `installed, over ${String(Math.round(observed.bytes / 1024))} KiB of JavaScript`,
  };
}

/** What A6 read: the built documentation site, and who is entitled to be in it. */
export interface DocsSiteObservation {
  /** The member is there at all. `false` is the omission the command printed. */
  readonly present: boolean;
  /** Why the member is not there, verbatim from the command's own output. */
  readonly omission: string | null;
  /** The site produced routed HTML. */
  readonly built: boolean;
  /** What the build said when it did not. */
  readonly buildOutput: string;
  /** Module slugs whose **installed package** ships a documentation layer. */
  readonly expected: readonly string[];
  /** Module slugs the generated navigation names a prose page for. */
  readonly named: readonly string[];
  /** Those of them the built site actually serves a route for. */
  readonly routed: readonly string[];
  /** Routed HTML pages in the built site, as evidence it is a site at all. */
  readonly pages: number;
}

/**
 * A6 — the documentation site builds, and its navigation names the installed
 * modules' pages.
 *
 * **Three claims and not one**, which is why the observation carries three
 * lists. The site *builds*, which under `onBrokenLinks: 'throw'` already means
 * every link in it resolves. Its navigation *names* the pages of the modules
 * this client installed — both directions, exactly as A5 asks of the bundle: a
 * missing slug is a page the client paid for and cannot find, and an extra one
 * is a module they did not install advertising itself. And each named page is
 * *routed*, because a sidebar entry and a served page are not the same thing:
 * Docusaurus excludes an underscore-prefixed file from routing by design
 * (D-200), so a navigation naming one is a link to nothing that the build does
 * not refuse.
 *
 * The expectation is read off each installed package's own `docs/` layer and
 * never off a list, so a module set that changes changes it in the same run.
 */
export function evaluateA6(observed: DocsSiteObservation): AssertionResult {
  if (!observed.present) {
    return {
      id: 'A6',
      state: 'unmeasured',
      detail:
        observed.omission ??
        'the created tree holds no `docs/` member and the command printed no omission for it',
    };
  }
  if (!observed.built) {
    return {
      id: 'A6',
      state: 'fail',
      detail: `the instance's own documentation build produced no site: ${observed.buildOutput}`,
    };
  }
  if (observed.expected.length === 0) {
    return {
      id: 'A6',
      state: 'unmeasured',
      detail:
        'none of the installed module packages ships a documentation layer, so "names the ' +
        'installed modules\' pages" is satisfied by an empty set and says nothing about ' +
        'whether a page would have been reachable',
    };
  }
  const missing = observed.expected.filter((slug) => !observed.named.includes(slug));
  const extra = observed.named.filter((slug) => !observed.expected.includes(slug));
  const unrouted = observed.named.filter((slug) => !observed.routed.includes(slug));
  if (missing.length > 0 || extra.length > 0 || unrouted.length > 0) {
    return {
      id: 'A6',
      state: 'fail',
      detail:
        `${String(observed.expected.length)} installed module packages ship a documentation ` +
        `layer and the built site's navigation names ${String(observed.named.length)}` +
        (missing.length > 0 ? `; missing: ${missing.join(', ')}` : '') +
        (extra.length > 0 ? `; not installed and named anyway: ${extra.join(', ')}` : '') +
        (unrouted.length > 0 ? `; named and served by no route: ${unrouted.join(', ')}` : ''),
    };
  }
  return {
    id: 'A6',
    state: 'pass',
    detail:
      `the built site serves ${String(observed.pages)} pages and its navigation names a routed ` +
      `page for exactly the ${String(observed.expected.length)} installed module packages that ` +
      `ship a documentation layer`,
  };
}

/** One package's contribution to the built stylesheet, and how it was found. */
export interface StylesheetWitness {
  readonly packageName: string;
  /** `shell` and `module` are the two the contract names; both must witness. */
  readonly kind: 'shell' | 'module';
  /** Utility-shaped class tokens this package alone uses. */
  readonly unique: number;
  /** Those of them the built stylesheet actually carries. */
  readonly witnesses: readonly string[];
}

/** What A13 read: the built stylesheet, and who is entitled to be in it. */
export interface AdminStylesheetObservation {
  readonly built: boolean;
  readonly bytes: number;
  readonly packages: readonly StylesheetWitness[];
}

/**
 * A13 — the built stylesheet carries a class that only an installed package
 * declares, one from the shell and one from a module's admin layer (FR-023,
 * SC-011).
 *
 * **A5 says the screens are in the bundle; this says they are visible**, and the
 * two are not the same claim: Tailwind is a static scan that reports nothing
 * about a source matching nothing, so a package the enumeration failed to name
 * builds green and renders with none of the utility classes only it declares.
 *
 * The witness is derived, never listed: a class this package uses and no other
 * installed package and no file of the admin project uses. A package with no
 * such class is **skipped and counted**, not failed — it has no subject, and
 * treating "I could not tell" as a failure would send a reader to repair a
 * scan that is working. A package that has one and whose class is absent from
 * the stylesheet is the defect this assertion exists for.
 */
export function evaluateA13(observed: AdminStylesheetObservation): AssertionResult {
  if (!observed.built || observed.bytes === 0) {
    return {
      id: 'A13',
      state: 'unmeasured',
      detail: observed.built
        ? 'the built admin stylesheet is empty, so it is evidence of nothing'
        : 'the instance\'s own `build` script produced no admin stylesheet to read',
    };
  }
  const withSubject = observed.packages.filter((entry) => entry.unique > 0);
  if (withSubject.length === 0) {
    return {
      id: 'A13',
      state: 'unmeasured',
      detail:
        `none of the ${String(observed.packages.length)} packages read uses a class no other ` +
        'package and no file of the admin project uses, so there is no class whose presence ' +
        'could only be explained by that package having been scanned',
    };
  }
  const silent = withSubject.filter((entry) => entry.witnesses.length === 0);
  if (silent.length > 0) {
    return {
      id: 'A13',
      state: 'fail',
      detail:
        `${String(silent.length)} of ${String(withSubject.length)} packages contributed no ` +
        `class to the built stylesheet, so their screens render unstyled: ` +
        silent
          .slice(0, 5)
          .map((entry) => `${entry.packageName} (${String(entry.unique)} of its own)`)
          .join(', '),
    };
  }
  for (const kind of ['shell', 'module'] as const) {
    if (!withSubject.some((entry) => entry.kind === kind)) {
      return {
        id: 'A13',
        state: 'unmeasured',
        detail:
          `no ${kind} package offered a class of its own, and SC-011 asks for one from the ` +
          'shell and one from a module\'s admin layer — a verdict over one of the two would ' +
          'be answering half the assertion',
      };
    }
  }
  const sample = withSubject
    .slice(0, 2)
    .map((entry) => `${entry.packageName}: .${entry.witnesses[0]!}`)
    .join(', ');
  return {
    id: 'A13',
    state: 'pass',
    detail:
      `${String(Math.round(observed.bytes / 1024))} KiB of built stylesheet carries a class ` +
      `only its own package declares for each of ${String(withSubject.length)} packages, the ` +
      `shell and ${String(withSubject.filter((e) => e.kind === 'module').length)} module ` +
      `admin layers among them — ${sample}`,
  };
}

/** What A14 measured on the created tree: the wiring files, and their lines. */
export interface WiringObservation {
  /** One entry per file the command classified as wiring, with its line count. */
  readonly files: readonly { path: string; lines: number }[];
  /** How many wiring files the command said it wrote. */
  readonly declared: number;
}

/**
 * A14 — the wiring the **created tree** holds is under R1.4's bound.
 *
 * `instance-tree.md` §6 in full: *"measured on the created tree rather than on
 * the template, so a scaffold that expanded a file after rendering is caught"*.
 * The population is the command's own classification — the `— wiring` lines it
 * prints as it writes — and the count is taken off the disk, which is the whole
 * difference from `wiringLineCount`, the plan-side figure the command itself
 * prints and `packages/cli/test/new-instance.test.ts` asserts.
 *
 * A tree holding fewer wiring files than the command said it wrote is
 * **unmeasured**, not a pass: the bound would be satisfied by the files that
 * are missing.
 */
export function evaluateA14(observed: WiringObservation): AssertionResult {
  if (observed.declared === 0) {
    return {
      id: 'A14',
      state: 'unmeasured',
      detail:
        'the command classified no file as wiring, so the bound is satisfied by an empty set ' +
        'and says nothing',
    };
  }
  if (observed.files.length !== observed.declared) {
    return {
      id: 'A14',
      state: 'unmeasured',
      detail:
        `the command said it wrote ${String(observed.declared)} wiring files and ` +
        `${String(observed.files.length)} of them are on disk, so a count over what is there ` +
        `would be short by whatever is not`,
    };
  }
  const total = observed.files.reduce((sum, file) => sum + file.lines, 0);
  if (total >= WIRING_LINE_BOUND) {
    return {
      id: 'A14',
      state: 'fail',
      detail:
        `the created tree holds ${String(total)} lines of wiring across ` +
        `${String(observed.files.length)} files, against R1.4's bound of ` +
        `${String(WIRING_LINE_BOUND)}. Largest: ${observed.files
          .slice()
          .sort((left, right) => right.lines - left.lines)
          .slice(0, 3)
          .map((file) => `${file.path} (${String(file.lines)})`)
          .join(', ')}`,
    };
  }
  return {
    id: 'A14',
    state: 'pass',
    detail:
      `${String(total)} lines of wiring across ${String(observed.files.length)} files on disk, ` +
      `under R1.4's bound of ${String(WIRING_LINE_BOUND)}`,
  };
}

/** The run's exit code: 0 all pass, 1 something failed, 2 something could not be measured. */
export function exitCodeFor(results: readonly AssertionResult[]): number {
  if (results.some((result) => result.state === 'fail')) return 1;
  return results.some((result) => result.state === 'unmeasured') ? 2 : 0;
}

/**
 * The reasons this expectation cannot be compared against, if any.
 *
 * T140's done-when in full: *"unmet assertions are red on purpose and
 * `expected-state.json` names the **contract or task** each one waits on, never
 * 'unimplemented'"*. That is a rule about the record, so it is enforced on the
 * record — a non-`pass` entry has to name a task id or a contract, and an entry
 * whose reason is *"unimplemented"*, *"not implemented"*, *"TODO"* or *"not
 * started"* and nothing else is refused by name, because those are the four
 * spellings of the sentence the row calls out.
 *
 * It is exit **2** rather than a drift: a record this file cannot read is not a
 * comparison, in either direction.
 */
export function expectationRefusals(expectation: AcceptanceExpectation): readonly string[] {
  const refusals: string[] = [];
  const modes = Object.entries(expectation.modes ?? {});
  if (modes.length === 0) {
    refusals.push('the expectation records no mode at all, so no run can be compared to it');
  }
  for (const [mode, recorded] of modes) {
    if (recorded.state === 'unrun') continue;
    if (recorded.state !== 'recorded') {
      refusals.push(
        `the "${mode}" mode is recorded with state "${String(recorded.state)}", which is ` +
          `neither \`recorded\` nor \`unrun\``,
      );
      continue;
    }
    const assertions = Object.entries(recorded.assertions ?? {});
    if (assertions.length === 0) {
      refusals.push(`the "${mode}" mode is \`recorded\` and records no assertion`);
      continue;
    }
    for (const [id, entry] of assertions) {
      if (entry.status === 'pass') continue;
      const reason = (entry.reason ?? '').trim();
      if (reason.length === 0) {
        refusals.push(`${mode}/${id} is ${entry.status} and carries no reason`);
        continue;
      }
      if (EMPTY_REASONS.test(reason)) {
        refusals.push(
          `${mode}/${id} is ${entry.status} and its reason is "${reason}" — the row's own ` +
            `words are "never unimplemented": name the contract or the task it waits on`,
        );
        continue;
      }
      if (!NAMES_A_BLOCKER.test(reason)) {
        refusals.push(
          `${mode}/${id} is ${entry.status} and its reason names neither a task (T###) nor a ` +
            `contract (a \`.md\` or a \`specs/\` path)`,
        );
      }
    }
  }
  return refusals;
}

const EMPTY_REASONS = /^(unimplemented|not implemented|todo|not started)\.?$/i;
const NAMES_A_BLOCKER = /\bT\d{3}\b|\.md\b|\bspecs\//;

/**
 * The recorded expectation for the mode this run took, compared in **both**
 * directions.
 *
 * A newly-red assertion fails, and so does a newly-green one nobody recorded:
 * an unrecorded pass is a criterion whose meaning has moved without anybody
 * reading it, which is how a ratchet stops ratcheting.
 */
export function compareToExpectation(
  results: readonly AssertionResult[],
  expectation: AcceptanceExpectation,
  mode: AcceptanceMode,
): readonly string[] {
  const recorded = expectation.modes[mode];
  if (recorded === undefined) {
    return [
      `this run installed in the "${mode}" mode and the expectation records no such mode. A ` +
        `mode with no record is a run nothing is compared against, which is the silent green ` +
        `the two-way rule exists to refuse.`,
    ];
  }
  if (recorded.state === 'unrun') {
    if (results.length === 0) return [];
    return [
      ...results.map(
        (result) =>
          `${result.id}: the "${mode}" mode is recorded as unrun and this run measured ` +
          `${result.state}`,
      ),
      `record the "${mode}" mode's states from this run — it is the first measurement of that ` +
        `supply route, and the record is meant to come from one rather than from a prediction ` +
        `written before it was possible to run.`,
    ];
  }
  const assertions = recorded.assertions ?? {};
  const drift: string[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    seen.add(result.id);
    const expected = assertions[result.id];
    if (expected === undefined) {
      drift.push(
        `${result.id} is not recorded in the expectation's "${mode}" mode (it is ${result.state})`,
      );
      continue;
    }
    if (expected.status !== result.state) {
      drift.push(`${result.id}: recorded ${expected.status}, measured ${result.state}`);
    }
  }
  for (const id of Object.keys(assertions)) {
    if (!seen.has(id)) drift.push(`${id} is recorded but this run did not evaluate it`);
  }
  return drift;
}

export function exitCodeForExpectation(drift: readonly string[]): number {
  return drift.length === 0 ? 0 : 1;
}

/**
 * Every assertion this criterion owes, with the ones no step answered filled in
 * as `unmeasured`.
 *
 * `acceptance/assertions.ts`' rule: an id missing from the output is the one
 * shape of vacuous result the catalogue exists to prevent, so the report is
 * built over the catalogue rather than over whatever the run happened to push.
 */
export function completeResults(
  results: readonly AssertionResult[],
): readonly AssertionResult[] {
  const answered = new Map(results.map((result) => [result.id, result]));
  return ASSERTION_IDS.map(
    (id) =>
      answered.get(id) ?? {
        id,
        state: 'unmeasured' as const,
        detail: 'no step of this run answered this assertion',
      },
  );
}

/**
 * One line per assertion, then the verdict — with the supply route on it.
 *
 * The mode is on the arithmetic line rather than in a note because the states
 * mean different things under the two: `A2 PASS` under `tarball` says an
 * install from packed files worked, and under `registry` it says published
 * versions resolved. A report that did not say which was read would be two
 * claims under one sentence.
 */
export function formatReport(
  results: readonly AssertionResult[],
  notes: readonly string[],
  mode: AcceptanceMode,
): string {
  const lines = results.map(
    (result) =>
      `[instance-acceptance] ${result.id} ${result.state.toUpperCase()} — ${result.detail}`,
  );
  for (const note of notes) lines.push(`[instance-acceptance] note: ${note}`);
  const pass = results.filter((result) => result.state === 'pass').length;
  const fail = results.filter((result) => result.state === 'fail').length;
  const unmeasured = results.filter((result) => result.state === 'unmeasured').length;
  lines.push(
    `[instance-acceptance] mode=${mode} pass=${String(pass)} fail=${String(fail)} ` +
      `unmeasured=${String(unmeasured)} of ${String(results.length)}`,
  );
  return lines.join('\n');
}

/**
 * The `@endora-commerce/*` closure the instance will really install.
 *
 * The manifest the command writes names the module set and the platform. A
 * `pnpm install` resolves more than that: a module package peers on its
 * siblings' `./ports` types, `auto-install-peers` is on by default, and a
 * non-optional peer is fetched whether or not the instance declared it. The
 * tarball mode has to pin **that** set, or the install reaches a registry for a
 * package nobody published — and which packages those are is derived from the
 * manifests, never written down here.
 *
 * The extras are returned apart from the declared set, because they are a
 * finding as well as an input: a module package arriving as a peer is composed
 * by the platform's runtime discovery exactly as a declared one is, so the set
 * an instance runs is wider than the set its manifest names.
 */
export function endoraClosure(
  declared: readonly string[],
  manifests: ReadonlyMap<string, PackageDependencyDeclaration>,
): { readonly all: readonly string[]; readonly extras: readonly string[] } {
  const seen = new Set<string>();
  const queue = [...declared];
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const manifest = manifests.get(name);
    if (manifest === undefined) continue;
    for (const dependency of manifest.dependencies) {
      if (dependency.startsWith('@endora-commerce/')) queue.push(dependency);
    }
    for (const peer of manifest.requiredPeers) {
      if (peer.startsWith('@endora-commerce/')) queue.push(peer);
    }
  }
  const all = [...seen].sort();
  const declaredSet = new Set(declared);
  return { all, extras: all.filter((name) => !declaredSet.has(name)) };
}

export interface PackageDependencyDeclaration {
  readonly dependencies: readonly string[];
  /** Peers pnpm's `auto-install-peers` would fetch — the non-optional ones. */
  readonly requiredPeers: readonly string[];
}

/**
 * The `.npmrc` the **host** directory installs the `endora` binary through.
 *
 * The host is not an instance: its file is this harness's own, and the
 * instance's is written by `endora new instance --registry` — asserting *that*
 * one is A2's job. So the two are different files with different authors, and
 * exactly one thing about them may not differ: **how a credential is keyed**.
 *
 * ## Why the derivation is imported and not written here
 *
 * It was written here, and the second copy was the defect. `authKeys` exists
 * because a registry does not have to serve its tarballs under its metadata
 * path — GitLab serves a tarball from the owning project — so the endpoint key
 * covers the packument and nothing else, that one fetch goes out
 * unauthenticated, and the registry answers an absent credential with **404**,
 * in the same sentence it gives for a package that was never published. That
 * was measured, repaired and written down at length in
 * `packages/cli/src/new-storefront/npmrc.ts` on 2026-09-06; this criterion
 * re-derived one auth line by hand five days later and reproduced the symptom
 * byte for byte on the first pipeline that resolved the registry variables:
 *
 * ```
 * ERR_PNPM_FETCH_404  GET <endpoint> Not Found - 404
 * No authorization header was set for the request.
 * ```
 *
 * Two answers to one question, waiting to disagree — and they did. There is one
 * now, and it is the product's.
 *
 * ## The token is a reference and never a value
 *
 * `${ENDORA_NPM_TOKEN}` is expanded by pnpm at read time, so no file on disk
 * and no CI artefact holds the secret. It is the spelling `.gitlab-ci.yml`'s
 * `publish:packages` uses and the one the scaffolded `.npmrc` carries.
 *
 * A malformed endpoint **throws** rather than writing a file that configures
 * nothing: the caller turns that into exit 2, because a run that could not
 * reach the registry it was pointed at has measured neither a pass nor a
 * failure of the criterion.
 *
 * @param registry the endpoint, or `null` in the tarball mode — which writes no
 *   registry line at all, every fetch there being a `file:` specifier.
 * @param scope the one scope the host installs, e.g. `@endora-commerce`.
 */
export function hostNpmrc(registry: string | null, scope: string): string {
  const lines = [
    // The host must not be adopted by a workspace above the temporary
    // directory, and a peer range this checkout already tolerates is not this
    // criterion's subject. Both belong to neither mode.
    'ignore-workspace=true',
    'strict-peer-dependencies=false',
  ];
  if (registry !== null) {
    const endpoint = normalizeRegistry(registry);
    lines.push(`${scope}:registry=${endpoint}`);
    for (const key of authKeys(endpoint)) lines.push(`${key}:_authToken=\${${TOKEN_VARIABLE}}`);
  }
  return `${lines.join('\n')}\n`;
}
