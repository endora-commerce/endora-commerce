/**
 * The verdicts of the storefront-scaffold criterion, separated from everything
 * that runs a build.
 *
 * The split is `acceptance/assertions.ts`': the judgement is pure and unit
 * tested over fixture text, so a red proof per finding costs no docker, no
 * install and no `next build`. Importing this file starts nothing.
 */

/** One assertion's outcome. `unmeasured` is neither a pass nor a failure. */
export type AssertionState = 'pass' | 'fail' | 'unmeasured';

export interface AssertionResult {
  readonly id: string;
  readonly state: AssertionState;
  readonly detail: string;
}

/**
 * How the instance got its `@endora-commerce/*` packages.
 *
 * `tarball` packs each one out of this checkout and pins it through
 * `pnpm.overrides` — publication's stand-in, the only mode that works before the
 * first publish, and therefore the default. `registry` installs the semver
 * ranges the scaffold wrote, from a real registry, through the `.npmrc`
 * `endora new storefront --registry` emits (feature 104, § 1.6).
 *
 * The two are one criterion asked of two supply routes, not two criteria: the
 * six assertions are identical and only the install differs.
 */
export type AcceptanceMode = 'tarball' | 'registry';

/**
 * What one mode is recorded as.
 *
 * `unrun` is a state of its own and not an empty `recorded`: a mode nobody has
 * run yet owes no assertion states, and recording a *prediction* of them would
 * be the thing this file exists to refuse. The first run of such a mode drifts —
 * naming every assertion it measured — which is what makes the record arrive
 * from a measurement rather than from a guess.
 */
export interface ModeExpectation {
  readonly state: 'recorded' | 'unrun';
  readonly assertions?: Readonly<Record<string, AssertionState>>;
}

export interface AcceptanceExpectation {
  readonly modes: Readonly<Record<string, ModeExpectation>>;
}

/**
 * A1 — the scaffold names nothing above its own directory.
 *
 * The input is the command's own re-derivation over what it wrote, so this
 * assertion is about the *copy* rather than about the plan that produced it.
 */
export function evaluateA1(outward: readonly { file: string; specifier: string }[]): AssertionResult {
  return outward.length === 0
    ? {
        id: 'A1',
        state: 'pass',
        detail: 'no declaration in the copy names a path above its own directory',
      }
    : {
        id: 'A1',
        state: 'fail',
        detail: `${String(outward.length)} declarations still name a path above the scaffold: ${outward
          .map((entry) => `${entry.file} -> ${entry.specifier}`)
          .join('; ')}`,
      };
}

/**
 * A2 — the copy carries no `workspace:` range.
 *
 * Asked of the written manifest rather than of the rewrite's return value: the
 * rewrite reporting three rewrites and the file holding a fourth is exactly the
 * disagreement worth catching.
 */
export function evaluateA2(manifestText: string): AssertionResult {
  const manifest = JSON.parse(manifestText) as Record<string, Record<string, string> | undefined>;
  const remaining: string[] = [];
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (typeof range === 'string' && range.startsWith('workspace:')) {
        remaining.push(`${field}.${name}=${range}`);
      }
    }
  }
  return remaining.length === 0
    ? { id: 'A2', state: 'pass', detail: 'every dependency range is published semver' }
    : {
        id: 'A2',
        state: 'fail',
        detail: `the scaffold still declares ${remaining.join(', ')}, which nothing outside a pnpm workspace resolves`,
      };
}

/**
 * A4 — the install left no path back into the repository.
 *
 * The whole point of the criterion is to leave the monorepo, and a symlink into
 * it satisfies every other assertion while proving nothing: the package's code
 * would be the checkout's, resolved through a link pnpm would not create for a
 * real consumer. Both directions of "inside" are wrong here, so the test is on
 * the *resolved* path.
 */
export function evaluateA4(
  resolvedPaths: readonly { specifier: string; realPath: string }[],
  repoRoot: string,
): AssertionResult {
  const inside = resolvedPaths.filter(
    (entry) => entry.realPath === repoRoot || entry.realPath.startsWith(`${repoRoot}/`),
  );
  if (resolvedPaths.length === 0) {
    return {
      id: 'A4',
      state: 'unmeasured',
      detail: 'no @endora-commerce/* package resolved in the instance, so containment says nothing',
    };
  }
  return inside.length === 0
    ? {
        id: 'A4',
        state: 'pass',
        detail: `${String(resolvedPaths.length)} @endora-commerce/* packages resolve outside the checkout`,
      }
    : {
        id: 'A4',
        state: 'fail',
        detail: `${inside
          .map((entry) => `${entry.specifier} -> ${entry.realPath}`)
          .join('; ')} resolves inside the checkout, so this run measured the repository rather than an install`,
      };
}

/** A build, an install or a boot: exit 0 is a pass, anything else the tail of its output. */
export function evaluateProcess(
  id: string,
  code: number,
  output: string,
  passDetail: string,
): AssertionResult {
  if (code === 0) return { id, state: 'pass', detail: passDetail };
  return {
    id,
    state: 'fail',
    detail: `exit ${String(code)}: ${output.trim().split('\n').slice(-6).join(' / ')}`,
  };
}

/** The run's exit code: 0 all pass, 1 something failed, 2 something could not be measured. */
export function exitCodeFor(results: readonly AssertionResult[]): number {
  if (results.some((result) => result.state === 'unmeasured')) return 2;
  return results.some((result) => result.state === 'fail') ? 1 : 0;
}

/**
 * The recorded expectation for the mode this run took, compared in **both**
 * directions.
 *
 * A newly-red assertion fails, and so does a newly-green one nobody recorded:
 * an unrecorded pass is a criterion whose meaning has moved without anybody
 * reading it, which is how a ratchet stops ratcheting. That rule is unchanged by
 * the second mode; what the mode adds is *which* block it is asked of, and the
 * `unrun` state for a supply route no run has measured yet.
 */
export function compareToExpectation(
  results: readonly AssertionResult[],
  expectation: AcceptanceExpectation,
  mode: AcceptanceMode,
): readonly string[] {
  const recorded = expectation.modes[mode];
  if (recorded === undefined) {
    return [
      `this run installed in the "${mode}" mode and the expectation records no such mode. ` +
        `A mode with no record is a run nothing is compared against, which is the silent ` +
        `green the two-way rule exists to refuse.`,
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
      `record the "${mode}" mode's six states from this run — it is the first measurement of ` +
        `that supply route, and the record is meant to come from one rather than from a ` +
        `prediction written before it was possible to run.`,
    ];
  }
  if (recorded.state !== 'recorded') {
    return [
      `the "${mode}" mode is recorded with state "${String(recorded.state)}", which is neither ` +
        `\`recorded\` nor \`unrun\`. A state this file cannot read is not a comparison.`,
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
    if (expected !== result.state) {
      drift.push(`${result.id}: recorded ${expected}, measured ${result.state}`);
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
 * One line per assertion, then the verdict — with the supply route on it.
 *
 * The mode is on the arithmetic line rather than in a note because the six
 * states mean different things under the two: `A3 PASS` under `tarball` says an
 * install from packed files worked, and under `registry` it says a published
 * version resolved. A report that did not say which was read would be two
 * claims under one sentence.
 */
export function formatReport(
  results: readonly AssertionResult[],
  notes: readonly string[],
  mode: AcceptanceMode,
): string {
  const lines = results.map(
    (result) => `[storefront-acceptance] ${result.id} ${result.state.toUpperCase()} — ${result.detail}`,
  );
  for (const note of notes) lines.push(`[storefront-acceptance] note: ${note}`);
  const pass = results.filter((result) => result.state === 'pass').length;
  const fail = results.filter((result) => result.state === 'fail').length;
  const unmeasured = results.filter((result) => result.state === 'unmeasured').length;
  lines.push(
    `[storefront-acceptance] mode=${mode} pass=${String(pass)} fail=${String(fail)} ` +
      `unmeasured=${String(unmeasured)} of ${String(results.length)}`,
  );
  return lines.join('\n');
}
