/**
 * The verdicts of the `public` acceptance mode, separated from everything that
 * runs a process (`specs/136-open-source-publication/spec.md` §6.4, GAP-8,
 * FR-070; plan W5.4).
 *
 * ## The third mode, and why it has assertions of its own
 *
 * `acceptance:instance` measures `endora new instance` over two supply routes —
 * packed tarballs and the private registry — with one assertion list, A1…A16.
 * `public` is §6.4's third row and asks a different question: **can a stranger
 * install it**. It runs the one-shot a stranger runs, `npx
 * create-endora-commerce@<version>`, on a GitHub-hosted runner with no
 * `.npmrc`, no credential and nothing of this repository installed, and it
 * asserts §6.4's five properties and nothing else:
 *
 *   P1  an administrator logs in (`POST /api/v1/auth/admin/login` → 200);
 *   P2  with `--demo`, the storefront renders a catalogue;
 *   P3  every `@endora-commerce/*` entry in the generated lockfile resolves from
 *       `registry.npmjs.org`;
 *   P4  no installed package declares `SEE LICENSE IN`;
 *   P5  the number of commands the stranger typed, counted (123 SC-001).
 *
 * A1…A16 are not repeated here: they are about the tree `new instance` writes
 * and are measured by the modes that can see this checkout. The ids are `P`
 * rather than the next free `A` so the two lists cannot be read as one.
 *
 * ## No workspace import, deliberately
 *
 * The harness runs from a bare checkout with `npx tsx`, because a runner that
 * had run `pnpm install` over this repository would have pnpm, a store and our
 * packages on it — which is not a stranger's machine. So this file and
 * `instance-public.ts` import node builtins and each other only, and
 * `test/unit/acceptance/instance-public-assertions.test.ts` holds them to it.
 *
 * ## Exit codes
 *
 * R6.4's: **0** met, **1** measured and red, **2** could not be measured. A
 * step that did not run is `unmeasured`, never a pass.
 */

/** One assertion's outcome. `unmeasured` is neither a pass nor a failure. */
export type PublicAssertionState = 'pass' | 'fail' | 'unmeasured';

export type PublicAssertionId = 'P1' | 'P2' | 'P3' | 'P4' | 'P5';

export interface PublicAssertionResult {
  readonly id: PublicAssertionId;
  readonly state: PublicAssertionState;
  readonly detail: string;
}

export const PUBLIC_ASSERTION_CATALOGUE: Readonly<Record<PublicAssertionId, string>> = {
  P1: 'an administrator logs in to the instance the stranger installed: POST /api/v1/auth/admin/login answers 200',
  P2: 'with --demo, the storefront the one-shot wrote renders a catalogue with a product in it',
  P3: 'every @endora-commerce/* entry in the generated lockfile resolves from registry.npmjs.org',
  P4: 'no installed package declares SEE LICENSE IN — terms of its own do not reach a stranger from npmjs',
  P5: 'the commands the stranger typed are counted: at most 5 (123 SC-001), with 2 the target (136 SC-004)',
};

export const PUBLIC_ASSERTION_IDS = Object.keys(PUBLIC_ASSERTION_CATALOGUE) as readonly PublicAssertionId[];

/** The registry a stranger has when they have configured nothing. */
export const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org/';

const PUBLIC_NPM_HOSTS: ReadonlySet<string> = new Set(['registry.npmjs.org', 'registry.npmjs.com']);

/** 123 SC-001's pass line, and 136 SC-004's target. */
const COMMAND_PASS_LINE = 5;
const COMMAND_TARGET = 2;

/**
 * Environment variables that carry a registry credential. Any non-empty one is
 * a refusal, and only its name is ever printed.
 */
const CREDENTIAL_ENVIRONMENT = ['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'ENDORA_NPM_TOKEN'] as const;

/**
 * Environment variables that redirect the registry. A value naming npmjs is not
 * a redirect: `npm exec` exports its effective configuration into the
 * environment of what it runs, so the harness — itself started by `npx` —
 * would otherwise refuse the default it is checking for.
 *
 * `npm_config_userconfig` is deliberately absent for the same reason: npm sets
 * it on every `npx`, to the default path. What matters is whether the file it
 * names exists, and that is the caller's `npmrcFiles`.
 */
const REGISTRY_ENVIRONMENT = ['ENDORA_NPM_REGISTRY', 'NPM_CONFIG_REGISTRY', 'npm_config_registry'] as const;

function isPublicNpm(url: string | null | undefined): boolean {
  if (url === null || url === undefined) return false;
  try {
    return PUBLIC_NPM_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Why this machine is not a stranger's, if it is not.
 *
 * Exit 2 rather than a finding: a run on a configured machine has measured
 * something §6.4 does not rule about. The value of a credential is never
 * printed, only its name.
 */
export function cleanMachineRefusals(observed: {
  readonly npmrcFiles: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly npmRegistry: string | null;
}): readonly string[] {
  const refusals: string[] = [];
  for (const file of observed.npmrcFiles) {
    refusals.push(
      `${file} exists, and npm and pnpm both read it. A stranger's machine has none, so a run ` +
        "that found one would be measuring this runner's configuration rather than the published " +
        'packages',
    );
  }
  const credentials = CREDENTIAL_ENVIRONMENT.filter((name) => (observed.env[name] ?? '').length > 0);
  if (credentials.length > 0) {
    refusals.push(
      `${credentials.join(', ')} ${credentials.length === 1 ? 'is' : 'are'} set. The mode runs ` +
        'with no registry credential; the workflow passes none, so one arriving here came from ' +
        'somewhere this run cannot account for',
    );
  }
  const redirects = REGISTRY_ENVIRONMENT.filter((name) => {
    const value = observed.env[name] ?? '';
    return value.length > 0 && !isPublicNpm(value);
  });
  if (redirects.length > 0) {
    refusals.push(
      `${redirects.join(', ')} ${redirects.length === 1 ? 'names' : 'name'} a registry other than ` +
        `${PUBLIC_NPM_REGISTRY}. A stranger has configured none`,
    );
  }
  if (!isPublicNpm(observed.npmRegistry)) {
    refusals.push(
      `npm's default registry reads ${observed.npmRegistry ?? '(nothing)'} and not ` +
        `${PUBLIC_NPM_REGISTRY}. Everything this mode asserts about where a package came from ` +
        'assumes the default a stranger has',
    );
  }
  return refusals;
}

/**
 * Variables npm or pnpm export into what they run, matched case-insensitively
 * since npm reads `NPM_CONFIG_*` as well. `npx` exports its whole effective
 * configuration as `npm_config_*` — including `npm_config_package` — and pnpm
 * does the same plus `pnpm_config_*`, so a command started under either one
 * runs with that one's settings rather than the defaults a stranger has.
 */
const INHERITED_PACKAGE_MANAGER_PREFIXES = /^(npm|pnpm)_(config|package|lifecycle)_/i;
const INHERITED_PACKAGE_MANAGER_NAMES: ReadonlySet<string> = new Set([
  'npm_execpath',
  'npm_node_execpath',
  'npm_command',
  'init_cwd',
  'node',
  'color',
  'pnpm_script_src_dir',
]);

/**
 * The user config is the one npm variable kept: {@link cleanMachineRefusals}
 * judged this machine clean by reading the file it names, so the commands run
 * afterwards must read that file and no other.
 */
const KEPT_PACKAGE_MANAGER_NAMES: ReadonlySet<string> = new Set(['npm_config_userconfig']);

/** A `PATH` entry that `npm exec` / `npm run` prepended for the duration of its child. */
function isPackageManagerPathEntry(entry: string): boolean {
  const normalised = entry.replace(/\/+$/, '');
  return normalised.endsWith('/node_modules/.bin') || normalised.endsWith('/node-gyp-bin');
}

/**
 * The environment the stranger's commands run in: the harness's own, minus
 * everything the `npx` (or pnpm) that started the harness exported into it.
 *
 * The workflow starts the harness with `npx --package=tsx@4 -- tsx …`, and
 * that `npx` exports `npm_config_package=tsx@4`. Inherited by the one-shot's
 * `npx --yes create-endora-commerce@<version>`, it made npm run
 * `create-endora-commerce@<version>` as a command inside the tsx package —
 * exit 127, and nothing measured (run 36834341414). A stranger types those
 * commands into a shell no package manager started, so every such variable is
 * dropped, not just the one that broke: configuration, package and lifecycle
 * variables, npm's exec bookkeeping, and the `node_modules/.bin` directories
 * it put on `PATH`. `HOME`, the rest of `PATH`, `npm_config_userconfig` and
 * every unrelated variable are kept.
 */
export function strangerEnvironment(
  inherited: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const stranger: Record<string, string> = {};
  for (const [name, value] of Object.entries(inherited)) {
    if (value === undefined) continue;
    if (!KEPT_PACKAGE_MANAGER_NAMES.has(name)) {
      if (INHERITED_PACKAGE_MANAGER_PREFIXES.test(name)) continue;
      if (INHERITED_PACKAGE_MANAGER_NAMES.has(name.toLowerCase())) continue;
    }
    stranger[name] =
      name === 'PATH'
        ? value
            .split(':')
            .filter((entry) => !isPackageManagerPathEntry(entry))
            .join(':')
        : value;
  }
  return stranger;
}

/** Who installs as whom: the one-shot's inputs. */
export interface OneShotInput {
  readonly packageName: string;
  readonly version: string;
  readonly dir: string;
  readonly admin: {
    readonly email: string;
    readonly password: string;
    readonly firstName: string;
    readonly lastName: string;
  };
}

/**
 * The first command: the one-shot, every answer a flag.
 *
 * **There is no `--no-storefront` in it, and there used to be.** `endora
 * install` copied the reference storefront out of a checkout of the platform
 * repository and refused it anywhere else, naming that flag
 * (`specs/110-instance-repository/contracts/cli-product.md` R3.1c) — and a clean
 * runner is anywhere else, so a stranger had to type it and P2 could not be
 * measured. The CLI now carries the reference storefront it was built from, so
 * the command a stranger types writes the shop too, and P2 is judged on it. A
 * published version older than that change refuses this command outright,
 * which is P1 failing for the reason it should.
 */
/**
 * The password as one argument, `--admin-password=<value>`.
 *
 * A random `base64url` password starts with `-` about one time in 64, and as a
 * separate argument `node:util`'s `parseArgs` — the CLI's parser — reads it as
 * a flag with its value missing and refuses the command, which turned P1 red
 * on runs that had nothing wrong with them. The `=` form carries any value.
 */
export function adminPasswordFlag(password: string): string {
  return `--admin-password=${password}`;
}

/** A typed command cut before its password, for printing: the rest of it is the secret. */
export function withoutPassword(command: string): string {
  return command.split(/ --admin-password[= ]/)[0]!;
}

export function oneShotCommand(input: OneShotInput): string {
  return [
    `npx --yes ${input.packageName}@${input.version} ${input.dir}`,
    '--non-interactive',
    '--demo',
    `--admin-email ${input.admin.email}`,
    adminPasswordFlag(input.admin.password),
    `--admin-first-name ${input.admin.firstName}`,
    `--admin-last-name ${input.admin.lastName}`,
  ].join(' ');
}

/**
 * The `… run dev:all` line the one-shot printed, as a command — its trailing
 * `# …` comment dropped — or `null` when it printed none.
 *
 * The CLI decides the spelling: `pnpm run dev:all` where `pnpm` is on PATH,
 * the pinned pnpm through `npx` where it is not. A copy of either written here
 * would be a second answer to one question, and the first time they disagreed
 * (W5.5 against `0.100.1`, run 36868691058) this harness typed a command no
 * stranger had been told to type, and measured its own assumption.
 */
export function printedDevAllCommand(output: string): string | null {
  for (const line of output.split('\n')) {
    const match = /^\s*(cd \S+ && \S.*?\brun dev:all\b.*?)(?:\s+#.*)?\s*$/.exec(line);
    if (match !== null) return match[1]!.trim();
  }
  return null;
}

/**
 * What the stranger types, in order — the list P5 counts and the harness runs.
 *
 * Data rather than a sequence of calls, so the count is of the commands that
 * actually ran rather than of a description of them. Two, as §6.2's *"Endora
 * after this programme"* row states the target: the one-shot, then **the
 * command it printed** to start every layer ({@link printedDevAllCommand}).
 * When it printed none, the list is one command long — the sequence did not
 * reach its end, which P5 reports as unmeasured and P1 as a failure.
 */
export function strangerCommands(
  input: OneShotInput & { readonly installOutput: string },
): readonly string[] {
  const devAll = printedDevAllCommand(input.installOutput);
  return devAll === null ? [oneShotCommand(input)] : [oneShotCommand(input), devAll];
}

/**
 * P5. `completed` is whether the sequence reached its end — a count of the
 * commands before a failure is not a count of the commands to a running shop.
 */
export function evaluateCommandCount(
  typed: readonly string[],
  completed = true,
): PublicAssertionResult {
  if (!completed) {
    return {
      id: 'P5',
      state: 'unmeasured',
      detail:
        `the sequence stopped after ${String(typed.length)} command(s) without reaching its end, ` +
        'so how many it takes to a running shop is not known from this run',
    };
  }
  if (typed.length === 0) {
    return {
      id: 'P5',
      state: 'unmeasured',
      detail: 'the harness typed no command at all, so there is no count to report',
    };
  }
  const count = typed.length;
  return {
    id: 'P5',
    state: count <= COMMAND_PASS_LINE ? 'pass' : 'fail',
    detail:
      `${String(count)} command(s) typed; the pass line is ${String(COMMAND_PASS_LINE)} ` +
      `(123 SC-001) and the target is ${String(COMMAND_TARGET)} (136 SC-004): ` +
      typed.map((command, index) => `(${String(index + 1)}) ${withoutPassword(command)}`).join('; '),
  };
}

/** P1. */
export function evaluateLogin(observed: {
  readonly healthStatus: number | null;
  readonly loginStatus: number | null;
  readonly body: string;
  /**
   * Set when the one-shot itself failed. That is a **failure** of P1, not an
   * unmeasured one: the version is published (the harness refuses one that is
   * not, before typing anything), so a stranger who types the command and gets
   * no administrator has met the product failing, which is this mode's subject.
   */
  readonly installFailed?: string | undefined;
}): PublicAssertionResult {
  if (observed.installFailed !== undefined) {
    return {
      id: 'P1',
      state: 'fail',
      detail: `the stranger never reached a login: ${observed.installFailed}`,
    };
  }
  if (observed.healthStatus !== 200) {
    return {
      id: 'P1',
      state: 'fail',
      detail:
        `the stranger's second command started nothing that answered its health check ` +
        `(${observed.healthStatus === null ? 'no answer' : `status ${String(observed.healthStatus)}`}): ` +
        observed.body.slice(0, 400),
    };
  }
  if (observed.loginStatus !== 200) {
    return {
      id: 'P1',
      state: 'fail',
      detail:
        `POST /api/v1/auth/admin/login answered ${String(observed.loginStatus)} for the ` +
        `administrator the one-shot created: ${observed.body.slice(0, 400)}`,
    };
  }
  return { id: 'P1', state: 'pass', detail: 'POST /api/v1/auth/admin/login answered 200' };
}

/** P2. */
export function evaluateStorefront(observed: {
  /** Whether the one-shot itself exited 0. */
  readonly installed: boolean;
  /** Whether the stranger's second command was typed and the API answered. */
  readonly started: boolean;
  readonly written: boolean;
  readonly status?: number | null | undefined;
  readonly html?: string | undefined;
}): PublicAssertionResult {
  if (!observed.installed) {
    return {
      id: 'P2',
      state: 'unmeasured',
      detail: 'the one-shot did not finish, so there is no storefront to ask for a catalogue — P1 says why',
    };
  }
  if (!observed.written) {
    // Not `unmeasured` any more: the command was typed without `--no-storefront`
    // and exited 0, so a missing storefront is the product writing less than it
    // was asked for.
    return {
      id: 'P2',
      state: 'fail',
      detail:
        'the one-shot exited 0 and wrote no storefront beside the instance, though it was typed ' +
        'without --no-storefront',
    };
  }
  if (!observed.started) {
    return {
      id: 'P2',
      state: 'unmeasured',
      detail:
        'the storefront was written, and the command that starts every layer did not bring the ' +
        'API up, so the catalogue was never asked for — P1 says why',
    };
  }
  if (observed.status !== 200) {
    return {
      id: 'P2',
      state: 'fail',
      detail:
        `the storefront catalogue answered ${String(observed.status ?? 'nothing')}` +
        ((observed.html ?? '').length > 0 ? `: ${(observed.html ?? '').slice(0, 300)}` : ''),
    };
  }
  if (!/href="\/p\/[^"]+"/.test(observed.html ?? '')) {
    return {
      id: 'P2',
      state: 'fail',
      detail:
        'the storefront catalogue answered 200 and links no product — a demo that seeded ' +
        'nothing, or a catalogue that could not read it',
    };
  }
  return { id: 'P2', state: 'pass', detail: 'the catalogue answered 200 and links a product' };
}

/** One entry of a pnpm lockfile's `packages:` section. */
export interface LockfileEntry {
  readonly name: string;
  readonly version: string;
  readonly integrity: boolean;
  /** The resolution's `tarball`, when it has one. */
  readonly tarball: string | null;
  /** Whether it resolved from a directory rather than a registry. */
  readonly directory: boolean;
}

/**
 * The `packages:` section of a pnpm v9 lockfile.
 *
 * Not a YAML parser, for `ci-jobs.ts`' reason: this repository has no YAML
 * dependency, and the lockfile is written by pnpm to one fixed shape — a
 * two-space key per package, a four-space `resolution:` in flow style below it.
 * An entry whose resolution is not on the line after its key is read as
 * having none, which fails P3 rather than passing it.
 */
export function lockfileEntries(text: string): readonly LockfileEntry[] {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf('packages:');
  if (start === -1) return [];
  const entries: LockfileEntry[] = [];
  let current: { name: string; version: string } | null = null;
  let resolution: string | null = null;
  const flush = (): void => {
    if (current === null) return;
    const body = resolution ?? '';
    const tarball = /\btarball:\s*([^,}\s]+)/.exec(body)?.[1] ?? null;
    entries.push({
      name: current.name,
      version: current.version,
      integrity: /\bintegrity:\s*\S/.test(body),
      tarball,
      directory: /\bdirectory:/.test(body) || /\btype:\s*directory\b/.test(body),
    });
    current = null;
    resolution = null;
  };
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const key = /^ {2}'?((?:@[^/@'\s]+\/)?[^@'\s]+)@([^':\s(]+)[^':]*'?:\s*$/.exec(line);
    if (key !== null) {
      flush();
      current = { name: key[1]!, version: key[2]! };
      continue;
    }
    const found = /^ {4}resolution:\s*(.+)$/.exec(line);
    if (found !== null && current !== null) resolution = found[1]!;
  }
  flush();
  return entries;
}

const SCOPE_PREFIX = '@endora-commerce/';

/** P3. */
export function evaluateLockfile(observed: {
  readonly lockfile: string | null;
  /** The instance's own `.npmrc`, when the one-shot wrote one. */
  readonly instanceNpmrc: string | null;
}): PublicAssertionResult {
  if (observed.lockfile === null) {
    return {
      id: 'P3',
      state: 'unmeasured',
      detail: 'the instance has no pnpm-lock.yaml, so no install finished for this to read',
    };
  }
  const ours = lockfileEntries(observed.lockfile).filter((entry) =>
    entry.name.startsWith(SCOPE_PREFIX),
  );
  if (ours.length === 0) {
    return {
      id: 'P3',
      state: 'unmeasured',
      detail:
        `the lockfile's packages section names no ${SCOPE_PREFIX}* entry, so either the install ` +
        'resolved none of ours or this reader no longer recognises the format — neither is a pass',
    };
  }
  const findings: string[] = [];
  if (observed.instanceNpmrc !== null) {
    const registries = [...observed.instanceNpmrc.matchAll(/registry\s*=\s*(\S+)/g)]
      .map((match) => match[1]!)
      .filter((url) => {
        try {
          return !PUBLIC_NPM_HOSTS.has(new URL(url).hostname.toLowerCase());
        } catch {
          return true;
        }
      });
    if (registries.length > 0) {
      findings.push(`the instance's .npmrc names ${registries.join(', ')}`);
    }
  }
  for (const entry of ours) {
    const id = `${entry.name}@${entry.version}`;
    if (entry.directory) {
      findings.push(`${id} resolved from a directory`);
      continue;
    }
    if (entry.tarball !== null) {
      let host: string | null = null;
      try {
        const url = new URL(entry.tarball);
        host = url.protocol === 'file:' ? null : url.hostname.toLowerCase();
      } catch {
        host = null;
      }
      if (host === null) {
        findings.push(`${id} resolved from ${entry.tarball}`);
      } else if (!PUBLIC_NPM_HOSTS.has(host)) {
        findings.push(`${id} resolved from ${host}`);
      }
      continue;
    }
    if (!entry.integrity) {
      findings.push(`${id} carries no resolution this reader recognises`);
    }
  }
  if (findings.length > 0) {
    return {
      id: 'P3',
      state: 'fail',
      detail: `${String(findings.length)} of ${String(ours.length)} of ours did not come from npmjs: ${findings.slice(0, 10).join('; ')}`,
    };
  }
  return {
    id: 'P3',
    state: 'pass',
    detail:
      `${String(ours.length)} ${SCOPE_PREFIX}* entries, every one an integrity resolution from ` +
      'the default registry on a machine whose default is npmjs',
  };
}

/** One package an install left on disk. */
export interface InstalledManifest {
  readonly name: string;
  readonly version: string;
  readonly license: string | null;
}

const SEE_LICENSE_IN = /^\s*SEE LICENSE IN\b/i;

/** P4. */
export function evaluateLicences(installed: readonly InstalledManifest[]): PublicAssertionResult {
  if (installed.length === 0) {
    return {
      id: 'P4',
      state: 'unmeasured',
      detail: 'no installed package manifest was read, so there is no population to judge',
    };
  }
  const own = installed
    .filter((entry) => entry.license !== null && SEE_LICENSE_IN.test(entry.license))
    .map((entry) => `${entry.name}@${entry.version}`)
    .sort();
  if (own.length > 0) {
    return {
      id: 'P4',
      state: 'fail',
      detail: `${String(own.length)} installed package(s) declare SEE LICENSE IN: ${own.join(', ')}`,
    };
  }
  return {
    id: 'P4',
    state: 'pass',
    detail: `${String(installed.length)} installed package manifests read, none declares SEE LICENSE IN`,
  };
}

/** The run's exit code: 0 all pass, 1 something failed, 2 something could not be measured. */
export function publicExitCode(results: readonly PublicAssertionResult[]): number {
  if (results.some((result) => result.state === 'fail')) return 1;
  if (results.length === 0) return 2;
  return results.some((result) => result.state === 'unmeasured') ? 2 : 0;
}

/** The report, one line per assertion — every id, including one no step answered. */
export function formatPublicReport(
  results: readonly PublicAssertionResult[],
  notes: readonly string[],
): string {
  const byId = new Map(results.map((result) => [result.id, result]));
  const lines = ['[instance-acceptance:public] mode=public'];
  for (const note of notes) lines.push(`  note: ${note}`);
  for (const id of PUBLIC_ASSERTION_IDS) {
    const result = byId.get(id) ?? {
      id,
      state: 'unmeasured' as const,
      detail: 'no step of this run answered it',
    };
    lines.push(`  ${id} ${result.state.toUpperCase()} — ${PUBLIC_ASSERTION_CATALOGUE[id]}`);
    lines.push(`     ${result.detail}`);
  }
  const counts = (state: PublicAssertionState): number =>
    PUBLIC_ASSERTION_IDS.filter((id) => (byId.get(id)?.state ?? 'unmeasured') === state).length;
  lines.push(
    `[instance-acceptance:public] pass=${String(counts('pass'))} fail=${String(counts('fail'))} ` +
      `unmeasured=${String(counts('unmeasured'))} of ${String(PUBLIC_ASSERTION_IDS.length)}`,
  );
  return lines.join('\n');
}
