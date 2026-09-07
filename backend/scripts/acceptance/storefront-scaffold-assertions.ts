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

/** What one A6 boot answered: a status line, or `null` where it never answered. */
export interface BootObservation {
  /** The backend the run configured, or `null` where it configured none. */
  readonly backend: string | null;
  /** The status `/` answered with under that configuration. */
  readonly status: number | null;
  /** The status `/` answered with while pointed at an address nothing listens on. */
  readonly probeStatus: number | null;
  /** That address, so the report names what was probed. */
  readonly probeAddress: string;
  /** The server's own output, for a boot that never answered. */
  readonly output?: string;
}

/**
 * A6 — the built storefront boots, **and the run can tell what it booted
 * against**.
 *
 * The second half is not decoration. The storefront's fetchers read their
 * backend out of the environment and fall back to a compiled-in
 * `http://localhost:3001` when nothing names one, so a criterion that only reads
 * the status line answers *"something served a page"* while claiming *"it served
 * against the backend this run booted"*. Those came apart on `master`: the
 * harness configured `PUBLIC_API_BASE_URL`, a variable no file in the storefront
 * has ever read, and A6 was therefore green whenever the run's backend happened
 * to sit on the fallback address and red whenever it sat anywhere else — for a
 * reason that is the harness's and not the criterion's. It cost one whole
 * investigation before anybody looked at which variable the subject reads.
 *
 * So a pass takes two boots. The configured one has to answer below 500, and a
 * **probe** with the same variables pointed at an address nothing listens on has
 * to answer 5xx. A probe that answers anything else is `unmeasured` — never a
 * pass, never a red criterion — because the run has just demonstrated that its
 * configuration reaches nothing, which is exit 2's whole subject (issue #113).
 *
 * Its bound, stated rather than discovered: the probe reads a storefront whose
 * `/` fails when its backend is unreachable. A home page made resilient to that
 * would make this assertion refuse rather than pass, which is the correct
 * direction — at that point `/`'s status no longer says which backend was
 * reached, and the criterion needs a different observation rather than a
 * cheerful one.
 */
export function evaluateA6(observed: BootObservation): AssertionResult {
  const id = 'A6';
  if (observed.backend === null || observed.backend.length === 0) {
    return {
      id,
      state: 'unmeasured',
      detail:
        'no backend was configured, so a boot would measure the storefront\'s error page rather ' +
        'than the storefront',
    };
  }
  if (observed.status === null) {
    return {
      id,
      state: 'fail',
      detail: `next start did not answer in time: ${(observed.output ?? '').slice(-400)}`,
    };
  }
  if (observed.status >= 500) {
    return {
      id,
      state: 'fail',
      detail:
        `next start answered / with ${String(observed.status)} against ${observed.backend}` +
        (observed.output === undefined ? '' : `: ${observed.output.slice(-400)}`),
    };
  }
  if (observed.probeStatus === null) {
    return {
      id,
      state: 'unmeasured',
      detail:
        `next start answered / with ${String(observed.status)} against ${observed.backend}, and ` +
        `the discrimination probe never answered at all — so nothing here distinguishes that ` +
        `answer from the storefront's compiled-in fallback address`,
    };
  }
  if (observed.probeStatus < 500) {
    return {
      id,
      state: 'unmeasured',
      detail:
        `next start answered / with ${String(observed.status)} against ${observed.backend}, and ` +
        `also with ${String(observed.probeStatus)} while configured for ${observed.probeAddress}, ` +
        `where nothing listens. The configuration this run wrote therefore reaches nothing, and ` +
        `the first answer is the storefront's compiled-in fallback rather than a measurement of ` +
        `the backend`,
    };
  }
  return {
    id,
    state: 'pass',
    detail:
      `next start answered / with ${String(observed.status)} against ${observed.backend}, and ` +
      `with ${String(observed.probeStatus)} against ${observed.probeAddress} where nothing ` +
      `listens — so the answer is the configured backend's and not a fallback's`,
  };
}

/** The origin an unconfigured storefront names — `storefront/lib/seo/site-url.ts`. */
export const COMPILED_IN_SITE_ORIGIN = 'http://localhost:3000';

/** What A7 read out of the page the built instance served. */
export interface CanonicalObservation {
  /** The public origin the run configured, or `null` where it configured none. */
  readonly configured: string | null;
  /** The `href` of the served page's canonical link, or `null` if it carried none. */
  readonly canonical: string | null;
  /** The path whose page was read, for the message. */
  readonly path: string;
}

/**
 * A7 — the served page's canonical names the origin this run configured.
 *
 * **This is the assertion that measures the defect rather than its shape.**
 * `NEXT_PUBLIC_SITE_URL` was declared required and set by nothing in the
 * deployment path — not the Dockerfile's build arguments, not
 * `build:storefront`, not `.env.example` — so every image this repository built
 * served canonicals, a sitemap and a `robots.txt` naming
 * {@link COMPILED_IN_SITE_ORIGIN}, and the build reported success. Four files
 * gaining a line proves none of that. What proves it is a storefront that was
 * *built* with the variable and *serves* a canonical carrying its value.
 *
 * It is a separate assertion from A6 rather than a clause inside it because the
 * two ask different questions of one boot — A6 is *which backend did this
 * instance reach*, A7 is *which origin does it tell a crawler it is served at* —
 * and folding the second into the first would let either go red for the other's
 * reason.
 *
 * **The discrimination is in the value, not in a second boot.** The origin the
 * run configures is deliberately not the compiled-in one, so a canonical
 * carrying it cannot be the fallback's; a canonical that *is* the fallback is a
 * red criterion naming both. That is cheaper than A6's probe and no weaker
 * here, because the fallback is a constant in the subject's own source rather
 * than an address that might coincidentally answer.
 *
 * Its bound, stated rather than discovered: it reads the page's `<link
 * rel="canonical">`, so a storefront that stopped emitting one is `unmeasured`
 * — never a pass — and a storefront whose home page stopped being indexable
 * would need a different page rather than a cheerful green.
 */
export function evaluateA7(observed: CanonicalObservation): AssertionResult {
  const id = 'A7';
  if (observed.configured === null || observed.configured.length === 0) {
    return {
      id,
      state: 'unmeasured',
      detail:
        'no public origin was configured, so a canonical naming the compiled-in fallback ' +
        'would be correct behaviour rather than a finding',
    };
  }
  if (observed.canonical === null) {
    return {
      id,
      state: 'unmeasured',
      detail:
        `${observed.path} carried no <link rel="canonical">, so there is nothing here that ` +
        `says which origin the instance was built with. A7 measures a canonical; a page ` +
        `without one needs a different page, not a pass`,
    };
  }
  let origin: string;
  try {
    origin = new URL(observed.canonical).origin;
  } catch {
    return {
      id,
      state: 'fail',
      detail: `${observed.path} served a canonical this run cannot parse as a URL: ${observed.canonical}`,
    };
  }
  const expected = new URL(observed.configured).origin;
  if (origin !== expected) {
    return {
      id,
      state: 'fail',
      detail:
        `${observed.path} served a canonical at ${origin} while the instance was built with ` +
        `${expected}` +
        (origin === new URL(COMPILED_IN_SITE_ORIGIN).origin
          ? ` — which is the compiled-in fallback, so NEXT_PUBLIC_SITE_URL reached neither the ` +
            `build nor the page`
          : ''),
    };
  }
  return {
    id,
    state: 'pass',
    detail:
      `${observed.path} served <link rel="canonical" href="${observed.canonical}">, whose ` +
      `origin is the ${expected} this run built the instance with and not the ` +
      `${COMPILED_IN_SITE_ORIGIN} it falls back to when nothing names one`,
  };
}

/** The `href` of a page's canonical link, or `null` where it carries none. */
export function canonicalHrefIn(html: string): string | null {
  // Read as text rather than parsed: the criterion has no DOM, the subject is
  // Next's own emitted `<link>`, and attribute order is not ours to assume — so
  // the tag is found by its `rel` and the `href` is read out of the same tag.
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\brel\s*=\s*["']?canonical\b/i.test(tag)) continue;
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (href === null) continue;
    const value = href[1] ?? href[2] ?? href[3];
    if (value !== undefined && value.length > 0) return value;
  }
  return null;
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

/**
 * A required input no derivation in this repository can answer, with the reason
 * and the condition that retires it.
 *
 * It is here rather than in the criterion's own file so that the fast suite can
 * hold it to its two-way rule without importing a module whose top level runs an
 * install and a `next build`.
 *
 * **It is empty, and the entry it held retired exactly as written.** That entry
 * was `NEXT_PUBLIC_SITE_URL`: declared **required** by
 * `storefront/environment-inputs.mjs` and supplied by nothing in this tree — not
 * `storefront/.env.example`, not `storefront/Dockerfile`'s build arguments, not
 * `.gitlab-ci.yml`'s `build:storefront`, not `deploy/compose.prod.yml` — so
 * every deployment this repository built served canonicals, a sitemap and a
 * `robots.txt` naming the `http://localhost:3000` that
 * `storefront/lib/seo/site-url.ts` falls back to. The stand-in's own retiring
 * condition was *the moment any derivation reaches the variable*, and the four
 * deployment-path edits plus `planScaffoldInputs`' storefront-address
 * derivation are that moment. The guard did the remembering: with the entry
 * left in place the fast suite reports it as `staleStandIns` and the criterion
 * refuses.
 *
 * Keeping the empty map is the point. It is a two-way rule with nothing in it,
 * so the next required input this repository cannot answer has a home that
 * demands a reason and a retiring condition, rather than a value somebody
 * invents at the call site.
 */
export const SCAFFOLD_INPUT_STAND_INS: Readonly<Record<string, string>> = {};

/** What the criterion will put on the `endora new storefront` command line. */
export interface ScaffoldInputPlan {
  /** Variable name to value, for every required input this run supplies. */
  readonly values: ReadonlyMap<string, string>;
  /** Required, and no derivation and no stand-in answers it. A refusal. */
  readonly unanswerable: readonly string[];
  /** A stand-in a derivation has caught up with, or one nothing asks for. */
  readonly staleStandIns: readonly string[];
}

export interface ScaffoldInputRequest {
  /** The inputs the command will demand, in declaration order. */
  readonly required: readonly string[];
  /** Of those, the ones whose value is the backend's address — `addressOf`. */
  readonly backendAddressVariables: readonly string[];
  /** Of those, the ones whose value is the storefront's own public address. */
  readonly storefrontAddressVariables: readonly string[];
  /** The backend this run booted, or `null` where it booted none. */
  readonly backend: string | null;
  /** The public origin this run tells the instance it is served at. */
  readonly storefront: string | null;
  /** The copy's own worked example of its environment. */
  readonly envExample: ReadonlyMap<string, string>;
  readonly standIns: Readonly<Record<string, string>>;
}

/**
 * Which value each required input gets, and which the run cannot answer.
 *
 * **The population is the declaration, never a list here.** The criterion
 * invoked `endora new storefront` with no inputs at all for as long as the
 * storefront's variables carried invented defaults; the moment feature 117
 * removed them the command refused, the criterion exited 2, and every assertion
 * went unrun. A list of five names written into the harness would have fixed
 * that run and gone stale at the sixth, so what it supplies is derived from the
 * same declaration the command resolves against.
 *
 * Three value derivations, in order, and all three are the tree's own:
 *
 *   1. a variable whose `addressOf` is `backend` gets the backend this run
 *      booted — the translation that already existed;
 *   2. a variable whose `addressOf` is `storefront` gets the origin this run
 *      tells the instance it is served at, which is what makes A7 an
 *      observation rather than a tautology: it is not the address any
 *      unconfigured storefront falls back to;
 *   3. anything else gets the value the copy's `.env.example` declares for it,
 *      which is what that file is: the storefront's worked example of its own
 *      environment.
 *
 * **(1) and (2) used to be one rule keyed on the shape of the value** — *an
 * absolute `http(s)` URL in `.env.example`* — which was right only while that
 * file happened to declare no address but the backend's. It now declares
 * `NEXT_PUBLIC_SITE_URL`, so under the old predicate this criterion would have
 * pointed the shop's canonical origin at its API host and called the result a
 * measurement. `addressOf` is the copy's own statement of what each value *is*.
 *
 * With no backend booted, (1) falls through to (3) rather than to nothing: the
 * scaffold still has to be given an address, A1–A5 are still measurable without
 * one, and A6 records `unmeasured` from `backend === null` as it always did.
 * (2) falls through the same way, and A7 is `unmeasured` with it.
 *
 * What is left over is {@link SCAFFOLD_INPUT_STAND_INS}, today empty, and what
 * is left over *after that* is `unanswerable` — a refusal, because a criterion
 * that invented a value for a required input would be configuring the instance
 * out of its own imagination and calling the result a measurement.
 */
export function planScaffoldInputs(request: ScaffoldInputRequest): ScaffoldInputPlan {
  const backendAddresses = new Set(request.backendAddressVariables);
  const storefrontAddresses = new Set(request.storefrontAddressVariables);
  const values = new Map<string, string>();
  const unanswerable: string[] = [];

  const configured = (value: string | null): string | undefined =>
    value !== null && value.length > 0 ? value : undefined;

  const derived = (name: string): string | undefined => {
    if (backendAddresses.has(name)) {
      const backend = configured(request.backend);
      if (backend !== undefined) return backend;
    }
    if (storefrontAddresses.has(name)) {
      const storefront = configured(request.storefront);
      if (storefront !== undefined) return storefront;
    }
    return request.envExample.get(name);
  };

  for (const name of request.required) {
    const value = derived(name) ?? request.standIns[name];
    if (value === undefined) {
      unanswerable.push(name);
      continue;
    }
    values.set(name, value);
  }

  const required = new Set(request.required);
  const staleStandIns = Object.keys(request.standIns).filter(
    (name) => !required.has(name) || derived(name) !== undefined,
  );

  return { values, unanswerable, staleStandIns };
}

/** What a process run **inside the instance** is given, and what it is not. */
export interface InstanceEnvironmentRequest {
  /** The harness's own environment — everything this criterion happens to carry. */
  readonly ambient: Readonly<Record<string, string | undefined>>;
  /** Every variable the instance's own declaration says its process reads. */
  readonly declared: readonly string[];
  /** What this run deliberately configures the instance with, and why it may. */
  readonly supplied: Readonly<Record<string, string>>;
}

export interface InstanceEnvironment {
  /**
   * Applied **over** the harness's environment by the caller's own spawn: a
   * withheld name maps to `undefined`, which `child_process` drops rather than
   * exports, so the child sees the variable unset.
   */
  readonly overlay: Readonly<Record<string, string | undefined>>;
  /** The declared names the harness carried and this run withheld, sorted. */
  readonly withheld: readonly string[];
}

/**
 * The environment for a process this criterion runs **inside the instance** —
 * the install, the build and the boot.
 *
 * **The harness's environment is not the client's, and A5 has never once passed
 * in CI because of it.** The criterion inherited `process.env` wholesale into
 * `pnpm install`, `pnpm run build` and `next start`. Next loads the copy's
 * `.env` and does *not* override a variable the process already carries, so any
 * name the instance declares that happens to sit in the harness's environment
 * displaces the value `endora new storefront` wrote — and the run then measures
 * the harness's configuration while reporting on the command's. That is the
 * failure mode in both directions: a red for a value the client would never set,
 * and a green for a value the command never produced.
 *
 * Measured, on this tree, one variable varied and nothing else: with
 * `NODE_ENV=development` exported — which `acceptance:storefront-scaffold` sets
 * job-wide, correctly, for the **backend** it boots — A5 fails with
 * *"<Html> should not be imported outside of pages/_document"*, byte-identical
 * to CI down to the chunk offset. `next build` inlines `process.env.NODE_ENV` as
 * `"production"` into the server bundle it emits, so the emitted `_document.js`
 * requires `pages.runtime.prod.js`, while the render worker reads the *real*
 * `NODE_ENV` and requires `pages.runtime.dev.js`: two module instances, two
 * `React.createContext()` calls, and an `<Html>` looking for a provider that was
 * installed on the other one. It is upstream and it is not ours — a four-file
 * `app/` with no dependency of this repository in it fails identically — and the
 * storefront's own declaration already says so: *"the toolchain sets it …
 * setting it by hand is how a production build ends up serving development
 * output"*.
 *
 * **The population is the instance's own declaration, never a list of variable
 * names here.** A deny-list would answer for the one variable somebody found and
 * go quiet for the next; `declaredVariablesOf` is the copy's statement of what
 * its own process reads, so the rule tightens by itself when the storefront
 * declares another. What is *supplied* is the harness's deliberate
 * configuration — the backend address A6 points the instance at — and it wins,
 * because a value this run chose is not a value it inherited. `NEXT_PUBLIC_SITE_URL`
 * is deliberately not among them, which is what keeps A7 an observation of the
 * chain the command wrote rather than of a variable the harness exported.
 */
export function instanceEnvironment(request: InstanceEnvironmentRequest): InstanceEnvironment {
  const withheld = [...new Set(request.declared)]
    .filter(
      (name) =>
        request.ambient[name] !== undefined &&
        !Object.prototype.hasOwnProperty.call(request.supplied, name),
    )
    .sort((left, right) => left.localeCompare(right));

  const overlay: Record<string, string | undefined> = {};
  for (const name of withheld) overlay[name] = undefined;
  for (const [name, value] of Object.entries(request.supplied)) overlay[name] = value;
  return { overlay, withheld };
}
