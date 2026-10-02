/**
 * S1–S7 — what "each component can be stood up on a machine of its own" means,
 * as judgements over what a run observed
 * (`specs/110-instance-repository/contracts/instance-tree.md` §7.4;
 * `specs/138-separate-components/spec.md` FR-022).
 *
 * Pure: every function takes what the runner saw and answers one verdict. The
 * runner (`separate-components.ts`) starts processes and reads files; nothing
 * here does, which is what lets each assertion be shown red on a fixture
 * (`test/unit/acceptance/separate-components-assertions.test.ts`).
 */

export type VerdictStatus = 'pass' | 'fail' | 'unmeasured';

export interface Verdict {
  readonly id: string;
  readonly title: string;
  readonly status: VerdictStatus;
  readonly detail: string;
}

/** The ports a development install uses, which no process of this proof may listen on. */
export const DEVELOPMENT_PORTS: readonly number[] = [3000, 3001, 3002, 5432, 6379, 7700];

/**
 * The step ids a run with no `--only` planned before `--only` existed —
 * recorded on `feat/storefront-from-registry` at `609c03c70`, with every
 * optional step present (`packages/cli/test/install.test.ts`, SC-003).
 */
export const STEP_IDS_BEFORE_138: readonly string[] = [
  'install',
  'services',
  'setup',
  'admin',
  'demo',
  'storefront-install',
];

function verdict(id: string, title: string, problems: readonly string[], met: string): Verdict {
  return problems.length === 0
    ? { id, title, status: 'pass', detail: met }
    : { id, title, status: 'fail', detail: problems.join('; ') };
}

const same = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((entry, index) => entry === right[index]);

/**
 * The step ids a run echoed, in order — off its own output.
 *
 * `endora install` prints `[n/N] <command>` before each step it runs and, under
 * `--dry-run`, the same commands as a list. The id is not printed, so it is
 * read back from the command: each of the instance's root scripts names its
 * step, and `install` is the instance's the first time and the storefront's
 * after it — or at once, in a run that wrote no instance tree.
 */
export function stepIdsOf(output: string): readonly string[] {
  const wroteTree = /^\s+(?:wrote|would write) \d+ files across /m.test(output);
  const commands: string[] = [];
  let inDryList = false;
  for (const line of output.split('\n')) {
    const echoed = /^\[\d+\/\d+\] (.+)$/.exec(line);
    if (echoed !== null) {
      commands.push(echoed[1]!.trim());
      continue;
    }
    if (line.startsWith('The pipeline it would run, in order:')) {
      inDryList = true;
      continue;
    }
    if (inDryList) {
      const listed = /^ {2}(\S.*?) {3}# /.exec(line);
      if (listed === null) inDryList = false;
      else commands.push(listed[1]!.trim());
    }
  }
  let installs = 0;
  return commands.map((command) => {
    // `pnpm …`, `corepack pnpm@x …` and `npx --yes pnpm@x …` are one runner.
    const argv = command.replace(/^(?:corepack |npx --yes )?pnpm(?:@\S+)? /, '');
    if (argv === 'install') {
      installs += 1;
      return wroteTree && installs === 1 ? 'install' : 'storefront-install';
    }
    if (argv === 'run dev:services') return 'services';
    if (argv === 'run setup') return 'setup';
    if (argv.startsWith('run admin:create')) return 'admin';
    if (argv === 'run cli demo seed') return 'demo';
    if (argv === 'run build:admin') return 'build-admin';
    return `unknown: ${command}`;
  });
}

export interface S1Observation {
  readonly exitCode: number;
  readonly stepIds: readonly string[];
  /** Whether the run started the development services itself. */
  readonly services: boolean;
  /** Whether the run was asked for demo rows — what S4 renders a product from. */
  readonly demo: boolean;
  readonly adminDirExists: boolean;
  readonly storefrontWritten: boolean;
  /** The health route's status on the API's own port, or `null` when nothing answered. */
  readonly health: number | null;
  readonly port: number;
}

export function assertS1(observed: S1Observation): Verdict {
  const expected = [
    'install',
    ...(observed.services ? ['services'] : []),
    'setup',
    'admin',
    ...(observed.demo ? ['demo'] : []),
  ];
  const problems = [
    ...(observed.exitCode === 0 ? [] : [`the run exited ${String(observed.exitCode)}`]),
    ...(observed.adminDirExists ? ['the tree holds an admin/ member'] : []),
    ...(observed.storefrontWritten ? ['a storefront was written'] : []),
    ...(same(observed.stepIds, expected)
      ? []
      : [`the steps were ${observed.stepIds.join(', ') || 'none'}, expected ${expected.join(', ')}`]),
    ...(observed.health === 200
      ? []
      : [`the health route answered ${observed.health === null ? 'nothing' : String(observed.health)}`]),
    ...(DEVELOPMENT_PORTS.includes(observed.port)
      ? [`the API listens on ${String(observed.port)}, a development default`]
      : []),
  ];
  return verdict(
    'S1',
    '`--only api`: a headless instance, migrated, answering on a port of its own',
    problems,
    `steps ${observed.stepIds.join(', ')}; no admin/, no storefront; health 200 on ${String(observed.port)}`,
  );
}

export interface S2Observation {
  readonly exitCode: number;
  readonly stepIds: readonly string[];
  readonly distExists: boolean;
  readonly apiOrigin: string;
  readonly bundleNamesApiOrigin: boolean;
  /** Whether the bundle still carries the compiled-in `localhost:3001`. */
  readonly bundleNamesDefaultOrigin: boolean;
  /** The service addresses present in the environment the run was given. */
  readonly serviceAddressesInEnvironment: readonly string[];
  /** Containers the run started under its own Compose project. */
  readonly containersStartedForIt: readonly string[];
}

export function assertS2(observed: S2Observation): Verdict {
  const expected = ['install', 'build-admin'];
  const problems = [
    ...(observed.exitCode === 0 ? [] : [`the run exited ${String(observed.exitCode)}`]),
    ...(same(observed.stepIds, expected)
      ? []
      : [`the steps were ${observed.stepIds.join(', ') || 'none'}, expected ${expected.join(', ')}`]),
    ...(observed.distExists ? [] : ['admin/dist does not exist']),
    ...(observed.bundleNamesApiOrigin ? [] : [`no built script names ${observed.apiOrigin}`]),
    ...(observed.bundleNamesDefaultOrigin ? ['the bundle still names localhost:3001'] : []),
    ...(observed.serviceAddressesInEnvironment.length === 0
      ? []
      : [`the run was handed ${observed.serviceAddressesInEnvironment.join(', ')}`]),
    ...(observed.containersStartedForIt.length === 0
      ? []
      : [`containers were started for it: ${observed.containersStartedForIt.join(', ')}`]),
  ];
  return verdict(
    'S2',
    '`--only admin --api-url <S1>`: a bundle bound to that origin, with no database and no service',
    problems,
    `steps install, build-admin; admin/dist names ${observed.apiOrigin} and not localhost:3001; no service address given, no container started`,
  );
}

export interface S3Observation {
  /** The origin the admin is served at. */
  readonly origin: string;
  /** The built bundle's own page, fetched from that origin — it is really being served there. */
  readonly adminIndex: { readonly status: number | null };
  readonly preflight: { readonly allowOrigin: string | null; readonly allowCredentials: string | null };
  readonly login: {
    readonly status: number;
    readonly allowOrigin: string | null;
    readonly allowCredentials: string | null;
    readonly sessionCookie: boolean;
  };
  /** The next request, carrying the cookie the sign-in set. */
  readonly authenticated: { readonly status: number };
  /** The same request with no cookie — the control that makes 200 mean something. */
  readonly anonymous: { readonly status: number };
  readonly foreignPreflight: { readonly origin: string; readonly allowOrigin: string | null };
}

export function assertS3(observed: S3Observation): Verdict {
  const problems = [
    ...(observed.adminIndex.status === 200
      ? []
      : [
          `the admin bundle answered ${observed.adminIndex.status === null ? 'nothing' : String(observed.adminIndex.status)} at ${observed.origin}`,
        ]),
    ...(observed.preflight.allowOrigin === observed.origin
      ? []
      : [`the preflight answered access-control-allow-origin: ${String(observed.preflight.allowOrigin)}`]),
    ...(observed.preflight.allowCredentials === 'true'
      ? []
      : ['the preflight did not allow credentials']),
    ...(observed.login.status === 200 ? [] : [`the sign-in answered ${String(observed.login.status)}`]),
    ...(observed.login.allowOrigin === observed.origin && observed.login.allowCredentials === 'true'
      ? []
      : ['the sign-in answer is not readable, with credentials, from that origin']),
    ...(observed.login.sessionCookie ? [] : ['the sign-in set no session cookie']),
    ...(observed.authenticated.status === 200
      ? []
      : [`the request carrying the cookie answered ${String(observed.authenticated.status)}`]),
    ...(observed.anonymous.status === 200
      ? ['the same request with no cookie is 200 too, so the cookie proved nothing']
      : []),
    ...(observed.foreignPreflight.allowOrigin === null
      ? []
      : [
          `the preflight from ${observed.foreignPreflight.origin}, outside the list, was answered ` +
            `access-control-allow-origin: ${observed.foreignPreflight.allowOrigin}`,
        ]),
  ];
  return verdict(
    'S3',
    'from the admin\'s own origin, an administrator signs in to the API and the cookie is honoured',
    problems,
    `the bundle is served at ${observed.origin}; from that origin: preflight allowed with credentials, sign-in 200 with a session cookie, ` +
      `the next request 200 (${String(observed.anonymous.status)} without the cookie); ` +
      `${observed.foreignPreflight.origin} gets no allow-origin`,
  );
}

export interface S4Observation {
  readonly exitCode: number;
  readonly stepIds: readonly string[];
  /** Whether anything of an instance — a `backend/`, a workspace file — is in `<dir>`. */
  readonly instanceTreeExists: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly expected: {
    readonly apiOrigin: string;
    readonly siteOrigin: string;
    readonly salesChannel: string;
    readonly secret: string;
  };
  readonly port: number;
  readonly home: { readonly status: number | null };
  /** A product the catalogue linked and the page it rendered, or `null` when it linked none. */
  readonly product: { readonly link: string; readonly status: number; readonly heading: string } | null;
}

export function assertS4(observed: S4Observation): Verdict {
  const five: readonly (readonly [string, string])[] = [
    ['NEXT_PUBLIC_API_BASE_URL', observed.expected.apiOrigin],
    ['BACKEND_BASE_URL', observed.expected.apiOrigin],
    ['NEXT_PUBLIC_SITE_URL', observed.expected.siteOrigin],
    ['NEXT_PUBLIC_SALES_CHANNEL_CODE', observed.expected.salesChannel],
    ['REVALIDATE_SECRET', observed.expected.secret],
  ];
  const wrong = five
    .filter(([name, value]) => observed.env[name] !== value)
    // A secret is named, never shown — in a refusal as much as anywhere.
    .map(([name]) => (observed.env[name] === undefined ? `${name} is not set` : `${name} is not the value given`));
  const problems = [
    ...(observed.exitCode === 0 ? [] : [`the run exited ${String(observed.exitCode)}`]),
    ...(observed.instanceTreeExists ? ['an instance tree was written'] : []),
    ...(same(observed.stepIds, ['storefront-install'])
      ? []
      : [`the steps were ${observed.stepIds.join(', ') || 'none'}, expected storefront-install`]),
    ...wrong,
    ...(DEVELOPMENT_PORTS.includes(observed.port)
      ? [`the storefront listens on ${String(observed.port)}, a development default`]
      : []),
    ...(observed.home.status === 200
      ? []
      : [`the home page answered ${observed.home.status === null ? 'nothing' : String(observed.home.status)}`]),
    ...(observed.product === null
      ? ["the catalogue links no product, so nothing of the API's data was rendered"]
      : observed.product.status === 200 && observed.product.heading.trim().length > 0
        ? []
        : [`${observed.product.link} answered ${String(observed.product.status)} and rendered no heading`]),
  ];
  return verdict(
    'S4',
    '`--only storefront`: no instance, its five values, and a page rendered from S1\'s data',
    problems,
    `step storefront-install; the five values as given; home 200 on ${String(observed.port)}; ` +
      `${observed.product?.link ?? ''} renders "${observed.product?.heading ?? ''}"`,
  );
}

export interface S5Observation {
  readonly withTheSecret: { readonly status: number };
  readonly withAnother: { readonly status: number };
  readonly apiSecret: string | undefined;
  readonly storefrontSecret: string | undefined;
}

export function assertS5(observed: S5Observation): Verdict {
  const accepted = observed.withTheSecret.status >= 200 && observed.withTheSecret.status < 300;
  const refused = observed.withAnother.status === 401 || observed.withAnother.status === 403;
  const problems = [
    ...(accepted ? [] : [`the revalidation route answered the API's secret with ${String(observed.withTheSecret.status)}`]),
    ...(refused ? [] : [`the revalidation route answered another value with ${String(observed.withAnother.status)}`]),
    ...(observed.apiSecret === undefined ? ["the API's .env holds no REVALIDATE_SECRET"] : []),
    ...(observed.storefrontSecret === undefined ? ["the storefront's .env holds no REVALIDATE_SECRET"] : []),
    ...(observed.apiSecret !== undefined &&
    observed.storefrontSecret !== undefined &&
    observed.apiSecret !== observed.storefrontSecret
      ? ['the two .env files hold different values']
      : []),
  ];
  return verdict(
    'S5',
    'the storefront honours the API\'s secret and no other, and the two files hold one value',
    problems,
    `the route answered the secret ${String(observed.withTheSecret.status)} and another value ` +
      `${String(observed.withAnother.status)}; both .env files hold the same value`,
  );
}

export interface S6Observation {
  readonly stepIds: readonly string[];
  readonly services: boolean;
  readonly demo: boolean;
  readonly storefront: boolean;
}

export function assertS6(observed: S6Observation): Verdict {
  const optional: Readonly<Record<string, boolean>> = {
    services: observed.services,
    demo: observed.demo,
    'storefront-install': observed.storefront,
  };
  const recorded = STEP_IDS_BEFORE_138.filter((id) => optional[id] ?? true);
  return verdict(
    'S6',
    'with no `--only`, the planned steps are the ones recorded before the flag existed',
    same(observed.stepIds, recorded)
      ? []
      : [`planned ${observed.stepIds.join(', ') || 'none'}, recorded ${recorded.join(', ')}`],
    `planned ${observed.stepIds.join(', ')}`,
  );
}

export interface S7Case {
  /** The arguments, as typed. */
  readonly name: string;
  readonly exitCode: number;
  readonly output: string;
  /** What the refusal has to name: the flag that is missing, or the one that contradicts. */
  readonly mustName: readonly string[];
  /** Whether the target directory exists afterwards. */
  readonly wrote: boolean;
}

export function assertS7(cases: readonly S7Case[]): Verdict {
  const title = 'a selection that is incomplete or contradicts itself exits 1 in one refusal, writing nothing';
  if (cases.length === 0) {
    return { id: 'S7', title, status: 'unmeasured', detail: 'no case was run' };
  }
  const problems = cases.flatMap((entry) => {
    const refusals = entry.output.split('cannot run yet').length - 1;
    const unnamed = entry.mustName.filter((name) => !entry.output.includes(name));
    return [
      ...(entry.exitCode === 1 ? [] : [`\`${entry.name}\` exited ${String(entry.exitCode)}`]),
      ...(refusals === 1 ? [] : [`\`${entry.name}\` printed ${String(refusals)} refusals`]),
      ...(unnamed.length === 0 ? [] : [`\`${entry.name}\` does not name ${unnamed.join(', ')}`]),
      ...(entry.wrote ? [`\`${entry.name}\` left its target directory on disk`] : []),
    ];
  });
  return verdict('S7', title, problems, `${String(cases.length)} cases, each exit 1 in one refusal with nothing written`);
}

/**
 * The run against the recorded state — `--against-expectation`.
 *
 * Drift is reported in **both** directions, as the other acceptance ratchets
 * do: a regression is a branch that broke the criterion, and an improvement is
 * a record that no longer describes the tree. An assertion that was not
 * measured is exit 2 — neither colour — whatever the record says of it.
 */
export function compareToExpected(
  verdicts: readonly Verdict[],
  expected: Readonly<Record<string, VerdictStatus>>,
): { readonly exitCode: 0 | 1 | 2; readonly drift: readonly string[] } {
  const observed = new Map(verdicts.map((entry) => [entry.id, entry.status] as const));
  const ids = [...new Set([...Object.keys(expected), ...observed.keys()])].sort();
  const unmeasured = ids.filter((id) => (observed.get(id) ?? 'unmeasured') === 'unmeasured');
  const drift = ids
    .filter((id) => !unmeasured.includes(id) && observed.get(id) !== expected[id])
    .map((id) => `${id}: recorded ${expected[id] ?? 'nothing'}, observed ${observed.get(id)!}`);
  return { exitCode: unmeasured.length > 0 ? 2 : drift.length > 0 ? 1 : 0, drift };
}
