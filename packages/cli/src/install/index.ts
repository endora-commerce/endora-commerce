/**
 * `endora install <dir>` — one command from nothing to an installed Endora
 * Commerce (`specs/125-first-mile-install/spec.md` §4.3, FR-140…FR-161).
 *
 * ## What it is, in one sentence
 *
 * The two `new` commands write trees and run nothing; between the second of
 * them and a shop there were **nine** further typed steps (§2.3). This verb
 * runs them, and it is deliberately the only place in the product where a
 * scaffold and a pipeline meet.
 *
 * ## It composes, and reimplements nothing (FR-143)
 *
 * `runNewInstance` and `runNewStorefront` are the writers. Nothing here renders
 * a template, resolves a module or decides a member: a second implementation of
 * any of those is D-100's failure mode with a new name, and the case in
 * `test/install.test.ts` that reads this file's own source is what keeps it
 * true. The four flags that belong to `new instance` — `--module`,
 * `--deployment`, `--registry`, `--topology` — are passed through unread.
 *
 * ## When it asks, and when it never does
 *
 * `cli-product.md` R2.5c is a **ceiling**: a prompt may be issued only when
 * both descriptors are TTYs and no `--non-interactive`, `--dry-run` or CI
 * marker is present. Below it, this command asks nothing at all and every
 * missing answer is part of the one refusal — the posture Phase 3 shipped, and
 * unchanged. At a terminal it runs the wizard (`wizard.ts`, spec §6), under
 * R2.5f — 125's PR-1(b), accepted by the owner on 2026-09-25 and placed as
 * D-269. The wizard is a thing that fills flags in: its question set is the
 * flag set, so what it hands the rest of this function is the same options a
 * fully-flagged `--non-interactive` run supplies (SC-107).
 *
 * ## Validate completely, then write — and then, only then, run
 *
 * `runNewInstance`'s discipline (R5.2), one layer up and with a third phase.
 * Every precondition is decided before the first byte is written: the target,
 * the Node version, a package-manager runner, a reachable Docker daemon unless
 * `--no-services`, a reference storefront unless `--no-storefront` — the
 * checkout's when there is one above, the one this CLI carries otherwise — and
 * every answer the pipeline will need. They are reported in **one** refusal naming
 * all of them (FR-157), because a client who has to run a command five times to
 * learn five things has been handed a puzzle.
 *
 * ## Where nothing of ours is installed, it provisions a host first (D-271)
 *
 * `new instance` reads the platform's and every module's manifest off the
 * packages installed beside the target or the working directory, and under
 * `npx` there are none there. So when the platform does not resolve, the first
 * step installs this CLI's release index into a temporary directory
 * (`host.ts`) and `new instance` is called with that directory as its working
 * directory — before the target is written, removed once it has been, kept and
 * named when anything fails. It is not a pipeline step: the instance is not
 * left with it, and a checkout or a pre-installed host never plans it.
 *
 * ## It stands up all three components, or the ones `--only` names
 *
 * `specs/138-separate-components/` (D-284): the API, the Admin UI and the
 * storefront may each be on a machine of its own, so one run can stand up any
 * non-empty subset and is told where the others are by origin. The selection
 * is resolved first (`selection.ts`) and everything below is a function of it —
 * which answers are owed, which flags answer nothing and are refused, whether
 * an instance is written at all. Without the API no step opens a connection to
 * anything: the admin alone is this same tree with `build:admin` run in it, and
 * the storefront alone writes no instance. A run that names no `--only` is the
 * run this file described before that feature, step for step.
 *
 * ## Every step prints the command it is about to run (FR-156)
 *
 * So an operator watching can reproduce any step by hand, and a failure names a
 * command rather than a phase. A failure exits with **that step's own** exit
 * code and prints what is left as a resumable list — the steps are the
 * instance's own root scripts, so the list is a sequence a client can finish by
 * typing.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { basename, delimiter, isAbsolute, join, resolve, sep } from 'node:path';

import { parseEnvFile, writeEnvFile } from '../inputs/env-file.js';
import {
  generateSecret,
  interactivityOf,
  mayPrompt,
  type InteractivityFacts,
} from '../inputs/resolve.js';
import { ownPackageManager, ownReleaseIndexPath } from '../lib/release-index.js';
import {
  developmentAddresses,
  developmentMailUrl,
  developmentPublishedPorts,
  DEV_COMPOSE_PATH,
} from '../new-instance/deploy.js';
import {
  MEMBER_VOCABULARY,
  memberRefusal,
  runNewInstance,
  type NewInstanceResult,
} from '../new-instance/index.js';
import { probePlatform } from '../new-instance/host.js';
import {
  resolveStorefrontSource,
  runNewStorefront,
  StorefrontHostError,
  type NewStorefrontResult,
} from '../new-storefront/index.js';

import { HOST_DIRECTORY_PREFIX, hostNpmrc, readReleaseIndex, writeHost } from './host.js';
import {
  COMPONENT_VOCABULARY,
  EVERYTHING,
  parseOrigin,
  questionIdsFor,
  resolveSelection,
  type Component,
  type QuestionId,
  type Selection,
} from './selection.js';
import {
  answeredByFlags,
  answersLine,
  askWizard,
  installQuestions,
  WizardClosedError,
  type WizardIo,
} from './wizard.js';

/** A refusal the operator can act on — exit 1. */
export class InstallInputError extends Error {
  override readonly name = 'InstallInputError';
}

/**
 * An input this run could not read — exit 2 — or a failed host install, which
 * exits with **that step's own** code like every other step (FR-156).
 */
export class InstallHostError extends Error {
  override readonly name = 'InstallHostError';
  readonly exitCode: number;

  constructor(message: string, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

/**
 * One step of the pipeline.
 *
 * Data rather than a call, because FR-155 is a statement about a **list** —
 * *"the pipeline it runs is the printed next-steps sequence and nothing else"*
 * — and a list is assertable where a sequence of `await`s is not. `--dry-run`
 * prints exactly this, which is R2.4's *"report what it would do"* with no
 * second derivation of what that is.
 */
export interface InstallStep {
  /** Stable across renderings; what a test and a resume list address. */
  readonly id:
    | 'host'
    | 'install'
    | 'services'
    | 'setup'
    | 'admin'
    | 'demo'
    | 'build-admin'
    | 'storefront-install';
  /**
   * The command as an operator would type it, echoed before it runs.
   *
   * It is what is **printed**, and `argv` is what **runs**. They differ in
   * exactly one step, the administrator's: `argv` says `--password-stdin` and
   * the password travels on {@link stdin}, while this — the form a person
   * types — says `--password=` with {@link PASSWORD_PLACEHOLDER} for the value.
   */
  readonly command: string;
  /** What it is for, in one clause. */
  readonly purpose: string;
  /** The binary, as this machine offers it — `pnpm`, or `corepack`. */
  readonly bin: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  /**
   * What is written to the command's standard input, when it reads one.
   *
   * The administrator's password, and nothing else. It is not in `argv`: an
   * argument is echoed by the package manager that runs the script (twice —
   * the instance's root script calls the backend's) and logged by the operator
   * CLI as the reason for the scope it opens, and the first real run of this
   * command printed the password three times after this file had stopped
   * printing it once.
   */
  readonly stdin?: string | undefined;
  /**
   * A failure here is reported and does not fail the install (FR-126).
   *
   * Exactly one step is optional and it is the seeding: the instance is
   * complete without demo rows, and an optional extra that can red a mandatory
   * outcome is the ordering mistake that requirement exists to refuse.
   */
  readonly optional?: boolean;
}

/** How a step is executed. Injected so a test asserts the list, not a shell. */
export type StepRunner = (step: InstallStep) => Promise<number>;

export interface InstallOptions {
  /** Where the instance goes. Required: this command invents no name. */
  readonly dir?: string | undefined;
  readonly cwd?: string | undefined;

  // --- passed through to `endora new instance`, unread here (FR-143) --------
  readonly modules?: readonly string[] | undefined;
  readonly deployment?: string | undefined;
  readonly registry?: string | undefined;
  readonly topology?: string | undefined;
  /**
   * The members not to write — `--without <member>`, passed through to
   * `endora new instance` and validated with every other precondition here.
   * Empty or absent passes **nothing**, so the common case is the argv a bare
   * `endora new instance <dir>` has (125 R6.3b).
   */
  readonly without?: readonly string[] | undefined;

  // --- what this command decides -------------------------------------------
  /**
   * The components this run stands up on this machine — `--only`, over `api`,
   * `admin` and `storefront` (`specs/138-separate-components/`, D-284). Absent
   * or empty is all three, and the run this command always was. It is
   * normalised onto `without` and `storefront` by `selection.ts` and restates
   * neither.
   */
  readonly only?: readonly string[] | undefined;
  /**
   * The API's public origin — `--api-url`. Required when this run does not
   * stand the API up; written as the address the admin bundle and the
   * storefront are built against, and as `PUBLIC_API_BASE_URL` where the API
   * is this run's.
   */
  readonly apiUrl?: string | undefined;
  /** The admin's public origin — `--admin-url` — for the API's allow-list. */
  readonly adminUrl?: string | undefined;
  /**
   * The storefront's public origin — `--storefront-url`: its own
   * `NEXT_PUBLIC_SITE_URL`, and the API's `STOREFRONT_BASE_URL` and allow-list.
   */
  readonly storefrontUrl?: string | undefined;
  /**
   * The Sales Channel a storefront stood up **without** the API sells on —
   * `--sales-channel`. With the API in the run, the channel is the one that
   * API creates.
   */
  readonly salesChannel?: string | undefined;
  /** Write the storefront repository too. Default yes; `--no-storefront` off. */
  readonly storefront?: boolean | undefined;
  /** Where it goes. Default `<dir>-storefront`, a **sibling** (FR-160). */
  readonly storefrontDir?: string | undefined;
  /** Start the development stack. Default yes; `--no-services` off. */
  readonly services?: boolean | undefined;
  /**
   * Seed demo data.
   *
   * **`undefined` is a refusal, and that is final** (FR-124): 125 PR-2 was
   * ruled option (c) by the owner on 2026-09-25 (D-269) — the one question
   * whose two audiences want opposite answers has no default, in the wizard
   * (where Enter re-asks) or on the command line.
   */
  readonly demo?: boolean | undefined;

  readonly adminEmail?: string | undefined;
  readonly adminPassword?: string | undefined;
  readonly adminFirstName?: string | undefined;
  readonly adminLastName?: string | undefined;

  /**
   * The secret both trees share (FR-153).
   *
   * Supplied, it is used verbatim. Absent, this run generates it **once** and
   * writes the same value into both `.env` files — the one thing no sequence of
   * the existing commands can do, because a per-tree generator writes two
   * values that are *"each internally consistent and jointly wrong"*
   * (`packages/platform/src/env/index.ts`). Proposed ruling PR-3 states that as
   * a narrowing of the `generable: false` declaration rather than a reversal:
   * a single run over both trees is a single environment. Ruled as proposed
   * on 2026-09-25 (D-269); `input-resolution.md` R4.6 is the rule.
   */
  readonly revalidateSecret?: string | undefined;

  /** Report every step and every file; run nothing and write nothing. */
  readonly dryRun?: boolean | undefined;
  /** Refuse rather than ask, even at a terminal (`input-resolution.md` R3.4). */
  readonly nonInteractive?: boolean | undefined;

  // --- seams, so a test asserts the decisions and not the machine -----------
  /**
   * Where a line goes as it is produced.
   *
   * Every line is kept on the result as well, so a proof reads the sequence
   * rather than a process's stdout — but an install is minutes long and a
   * client watching it needs the echo **now**, not at the end. The argv layer
   * passes `process.stdout`; a test passes nothing and reads the result.
   */
  readonly echo?: ((line: string) => void) | undefined;
  /** How a step runs. Defaults to spawning it. */
  readonly run?: StepRunner | undefined;
  /**
   * The package-manager runners this machine offers, in preference order.
   *
   * Defaults to a probe of `pnpm` on `PATH` and then `corepack` (FR-158). An
   * empty list is the refusal, which is how a test reaches it without editing
   * `PATH`.
   */
  readonly packageManagers?: readonly PackageManagerRunner[] | undefined;
  /** Whether a Docker daemon answers. Defaults to a probe. */
  readonly dockerReachable?: boolean | undefined;
  /**
   * The facts R2.5c's conjunction is decided over. Defaults to this process's
   * own descriptors, flags and environment; a test hands in *"both are
   * terminals"* without being on one.
   */
  readonly interactivity?: InteractivityFacts | undefined;
  /** Where the wizard asks and reads. Defaults to this process's own. */
  readonly io?: WizardIo | undefined;
  /**
   * Where this CLI's release index is read from when a host has to be
   * provisioned (D-271). Defaults to the one its own build wrote into `dist`.
   */
  readonly releaseIndexFile?: string | undefined;
  /**
   * Where the packaged reference storefront is read from when no checkout is
   * above the working directory. Defaults to the one this CLI's own build wrote
   * into `dist` (`new-storefront/packaged.ts`).
   */
  readonly packagedReferenceDir?: string | undefined;
  /**
   * Whether a host port is already taken on this machine. Defaults to a probe
   * ({@link machinePortProbe}); a test answers without binding anything.
   */
  readonly portInUse?: PortProbe | undefined;
  /**
   * What on this machine already belongs to a Compose project of a given name.
   * Defaults to asking Docker ({@link machineComposeProjectProbe}); a test
   * answers without a daemon.
   */
  readonly composeProjectInUse?: ComposeProjectProbe | undefined;
}

/**
 * The containers and volumes that already carry a Compose project name on this
 * machine — empty when the name is free.
 */
export type ComposeProjectProbe = (name: string) => Promise<readonly string[]>;

/** Is this host port taken? */
export type PortProbe = (port: number) => Promise<boolean>;

/** One way to run `pnpm` on this machine. */
export interface PackageManagerRunner {
  readonly command: string;
  readonly prefix: readonly string[];
  /** How it reads in the echo and in the resumable list. */
  readonly label: string;
}

export interface InstallResult {
  /** `<dir>`: the instance's, or — for the storefront alone — the storefront's. */
  readonly targetDir: string;
  readonly storefrontDir: string | null;
  /** The components this run stood up (`--only`; all three when it was absent). */
  readonly components: readonly Component[];
  /** The instance this run wrote, or `null` when it wrote the storefront alone. */
  readonly instance: NewInstanceResult | null;
  readonly storefront: NewStorefrontResult | null;
  /** The pipeline, in order — the whole of it, whether or not it ran. */
  readonly steps: readonly InstallStep[];
  /**
   * The temporary host step, when one ran (D-271) — not a pipeline step: it is
   * how this run reads the release, not a command the instance is left with.
   */
  readonly hostStep: InstallStep | null;
  /** Everything this run printed, in order. Exported so a proof reads it. */
  readonly output: readonly string[];
  /** The failing step's own code, or 0 (FR-156). */
  readonly exitCode: number;
  /** What this run derived from the document it rendered, by name (FR-105). */
  readonly derived: readonly string[];
  /** R2.5f (iv) — the `[answers]` line: where each of §6.2's answers came from. */
  readonly answers: string;
  readonly dryRun: boolean;
}

/**
 * The lowest Node this command will run an instance on.
 *
 * The **CLI's own** `engines.node`, read from its own manifest, for R2.3's
 * reason: an instance re-declares that value rather than choosing one, so a
 * one-shot that checked a different number would be enforcing a requirement
 * nobody wrote down.
 */
function ownEnginesNode(): string | undefined {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { engines?: { node?: unknown } };
    return typeof manifest.engines?.node === 'string' ? manifest.engines.node : undefined;
  } catch {
    return undefined;
  }
}

/** `>=22.17.0` against `process.versions.node`, and nothing cleverer. */
function satisfiesNode(range: string, version: string): boolean {
  const wanted = /(\d+)\.(\d+)\.(\d+)/.exec(range);
  if (wanted === null) return true;
  const have = /(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (have === null) return true;
  for (let index = 1; index <= 3; index += 1) {
    const left = Number(have[index]);
    const right = Number(wanted[index]);
    if (left !== right) return left > right;
  }
  return true;
}

/** Does this command answer at all? A probe, never a version comparison. */
function probe(command: string, args: readonly string[]): boolean {
  const result = spawnSync(command, [...args], { stdio: 'ignore', timeout: 20_000 });
  return result.error === undefined && result.status === 0;
}

/**
 * The corepack runner for a `packageManager` value, or `null`.
 *
 * Only an exact `pnpm@<x.y.z>` is accepted, and that is the whole point:
 * `0.100.0` ran corepack with the `latest` tag, and on the day of the first public
 * acceptance run `latest` was a pnpm whose `bin/pnpm.mjs` the corepack bundled
 * with Node 22.18 cannot start — every machine without `pnpm` on `PATH` died
 * before installing anything. A tag or a range is a value that moves without
 * this repository, so it is no runner at all rather than a guess. A corepack
 * hash suffix stays in the manifest and off the command line.
 */
export function corepackRunnerFor(packageManager: unknown): PackageManagerRunner | null {
  if (typeof packageManager !== 'string') return null;
  const match = /^(pnpm@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+.*)?$/.exec(packageManager.trim());
  if (match === null) return null;
  const spec = match[1]!;
  return { command: 'corepack', prefix: [spec], label: `corepack ${spec}` };
}

/**
 * How a command run by `runner` is written for a person to type.
 *
 * Identity for `pnpm` on PATH. For the corepack fallback, the pinned pnpm
 * through `npx` instead: `corepack pnpm@x run setup` runs, but puts no `pnpm`
 * on PATH for the scripts it starts (`setup` chains `pnpm run …`), while `npx`
 * puts the pinned pnpm's `bin` there — and npm comes with every Node. What
 * this run *did* is still echoed as it ran; this is only for what it hands over.
 */
export function typeable(runner: PackageManagerRunner, command: string): string {
  if (runner.command !== 'corepack' || !command.startsWith(runner.label)) return command;
  return `npx --yes ${runner.prefix.join(' ')}${command.slice(runner.label.length)}`;
}

/**
 * The pnpm this CLI's build recorded, as a corepack runner, or `null`.
 *
 * Read from the release index (`lib/release-index.ts`), which is where
 * `new instance` reads the scaffold's `packageManager` from too
 * (`new-instance/host.ts`), so the pnpm that installs an instance and the pnpm
 * that instance declares are one number.
 */
function ownCorepackRunner(): PackageManagerRunner | null {
  return corepackRunnerFor(ownPackageManager());
}

/**
 * How this machine runs `pnpm`, in the declared order (FR-158).
 *
 * `pnpm` on `PATH` first, then `corepack <the pnpm this release pins>` — and
 * **never** `corepack enable`, which is baseline step A1 and a command that
 * writes shims into a directory this program does not own. `corepack pnpm@…`
 * runs the package manager without changing anything about the machine, which
 * is the property that lets this step be a fallback rather than an
 * installation.
 */
function resolvePackageManagers(): readonly PackageManagerRunner[] {
  const found: PackageManagerRunner[] = [];
  if (probe('pnpm', ['--version'])) {
    found.push({ command: 'pnpm', prefix: [], label: 'pnpm' });
  }
  const corepack = ownCorepackRunner();
  if (corepack !== null && probe('corepack', ['--version'])) found.push(corepack);
  return found;
}

/**
 * Is a Docker daemon there? `docker info` answers, `docker --version` does not.
 *
 * **The server version it prints is the answer, not its exit status.** Docker
 * CLI 28 exits 0 with an empty line when no daemon is listening (29 exits 1),
 * so a status-only probe told a client on 28 with Docker stopped that the
 * services step could run. Only a daemon can name its own version.
 */
function dockerIsReachable(): boolean {
  const result = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8',
    timeout: 20_000,
  });
  return result.error === undefined && result.status === 0 && result.stdout.trim() !== '';
}

/**
 * The refusals, collected.
 *
 * One object, filled completely and then thrown once: FR-157's *"in one
 * refusal naming all of them"*. A `throw` at the first finding is the shape
 * this deliberately is not — it makes the number of runs a client needs equal
 * to the number of things they got wrong.
 */
class Refusals {
  private readonly found: string[] = [];

  add(sentence: string): void {
    this.found.push(sentence);
  }

  get length(): number {
    return this.found.length;
  }

  throwIfAny(): void {
    if (this.found.length === 0) return;
    throw new InstallInputError(
      `\`endora install\` cannot run yet — ${String(this.found.length)} thing` +
        `${this.found.length === 1 ? '' : 's'} to settle first:\n` +
        this.found.map((sentence) => `  - ${sentence}`).join('\n') +
        `\n\nNothing was written and nothing was started.`,
    );
  }
}

/** The target must be empty, or hold nothing but a `.env` — `new instance`'s rule. */
function occupied(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const entries = readdirSync(dir);
  if (entries.length === 0) return null;
  if (entries.length === 1 && entries[0] === '.env') return null;
  return entries.slice(0, 5).join(', ');
}

/**
 * Why no storefront can be written from where this command is standing, or
 * `null` when one can.
 *
 * The storefront comes from the checkout above the working directory when there
 * is one, and from the reference this CLI's own build packaged everywhere else
 * (`new-storefront/packaged.ts`) — which is what lets a stranger's `npx` write
 * one. What is left to refuse is the case neither covers: a checkout whose
 * storefront cannot be read, or a build of this CLI that packaged none. It is
 * decided **before** an instance is written — fail-closed, with a remedy the
 * client can act on — rather than by writing half the trio and failing in the
 * middle of the pipeline.
 */
function storefrontUnavailable(cwd: string, packagedReferenceDir: string | undefined): string | null {
  try {
    resolveStorefrontSource(cwd, packagedReferenceDir);
    return null;
  } catch (error: unknown) {
    if (error instanceof StorefrontHostError) return error.message;
    throw error;
  }
}

/**
 * The default {@link PortProbe}: can this process bind the port, and has
 * Docker published it?
 *
 * Both, because neither sees everything. A bind attempt finds every listening
 * socket; a Docker daemon running without its userland proxy publishes a port
 * with a packet-filter rule and no socket at all, so the bind succeeds on a
 * port `docker compose up` will then be refused. `docker ps` is asked once per
 * run and a daemon that does not answer contributes nothing.
 */
export function machinePortProbe(): PortProbe {
  let published: ReadonlySet<number> | undefined;
  const dockerPublished = (): ReadonlySet<number> => {
    if (published !== undefined) return published;
    const result = spawnSync('docker', ['ps', '--format', '{{.Ports}}'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 20_000,
    });
    const ports = new Set<number>();
    if (result.error === undefined && result.status === 0) {
      for (const match of result.stdout.matchAll(/:(\d+)->/g)) ports.add(Number(match[1]));
    }
    published = ports;
    return ports;
  };
  const bound = (port: number, host: string): Promise<boolean> =>
    new Promise((answer) => {
      const server = createServer();
      server.once('error', (error: NodeJS.ErrnoException) => {
        // Only "somebody has it" is a yes. A host this machine has no address
        // family for is not a taken port.
        answer(error.code === 'EADDRINUSE' || error.code === 'EACCES');
      });
      server.listen({ port, host, exclusive: true }, () => server.close(() => answer(false)));
    });
  return async (port) =>
    (await bound(port, '0.0.0.0')) || (await bound(port, '::')) || dockerPublished().has(port);
}

/**
 * The project name Compose gives a directory when nobody names one: its
 * basename, lower-cased, with every character outside `[a-z0-9_-]` dropped and
 * no leading separator (Compose's own normalisation).
 */
export function composeProjectNameOf(dir: string): string {
  return basename(dir)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^[_-]+/, '');
}

/**
 * The default {@link ComposeProjectProbe}: every container, running or not,
 * and every volume Docker labels with the project name.
 *
 * Volumes as well as containers, because `docker compose down` removes the
 * containers and keeps the volumes — which is the state `dev:services:down`
 * leaves, and the one in which a second instance of the same name would start
 * its PostgreSQL on the first one's data without a container in sight.
 */
export function machineComposeProjectProbe(): ComposeProjectProbe {
  const list = (args: readonly string[]): readonly string[] => {
    const result = spawnSync('docker', [...args], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 20_000,
    });
    if (result.error !== undefined || result.status !== 0) return [];
    return result.stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  };
  return async (name) => {
    const label = `label=com.docker.compose.project=${name}`;
    return [
      ...list(['ps', '-a', '--filter', label, '--format', 'container {{.Names}}']),
      ...list(['volume', 'ls', '--filter', label, '--format', 'volume {{.Name}}']),
    ];
  };
}

/** What the project-name preflight decided. */
interface ComposeProjectDecision {
  /** The name this run writes as `COMPOSE_PROJECT_NAME`, or `null` when it writes none. */
  readonly chosen: string | null;
  readonly said: string | null;
  readonly refusal: string | null;
}

/**
 * Decide the Compose project the development stack runs as.
 *
 * Compose names a project after the directory holding the file, so two
 * instances both called `shop` — under two parents, or one deleted and written
 * again — are **one** project: the second `dev:services` adopts the first
 * one's containers and mounts its volumes, and the new instance migrates
 * somebody else's database. Nothing says so.
 *
 * `decidePorts`' two rules, for a name instead of a port. A name the operator
 * set (`COMPOSE_PROJECT_NAME` in the target's `.env`) is theirs: taken, it is a
 * refusal naming what holds it. A name nobody set is the directory's own when
 * that is free on this machine, and otherwise the directory's name with a
 * suffix derived from where the instance is, written into `.env` — the file
 * Compose reads beside `compose.dev.yml`, so `dev:services` and
 * `dev:services:down` both follow it with neither script changed.
 */
async function decideComposeProject(
  targetDir: string,
  envFile: ReadonlyMap<string, string>,
  inUse: ComposeProjectProbe,
  envPath: string,
): Promise<ComposeProjectDecision> {
  const held = (found: readonly string[]): string =>
    `${found.slice(0, 4).join(', ')}${found.length > 4 ? ` and ${String(found.length - 4)} more` : ''}`;
  const pinned = envFile.get('COMPOSE_PROJECT_NAME')?.trim();
  if (pinned !== undefined && pinned.length > 0) {
    const found = await inUse(pinned);
    return {
      chosen: null,
      said: null,
      refusal:
        found.length === 0
          ? null
          : `COMPOSE_PROJECT_NAME=${pinned} in ${envPath} is a Compose project this machine ` +
            `already has (${held(found)}), so this instance's development services would be ` +
            'those containers and their data. Set it to a name that is free, or remove the ' +
            'line and this command picks one.',
    };
  }
  const own = composeProjectNameOf(targetDir);
  const found = await inUse(own);
  if (found.length === 0) return { chosen: null, said: null, refusal: null };
  const suffix = createHash('sha256').update(targetDir).digest('hex').slice(0, 6);
  let candidate = `${own}-${suffix}`;
  for (let attempt = 2; attempt < 50 && (await inUse(candidate)).length > 0; attempt += 1) {
    candidate = `${own}-${suffix}-${String(attempt)}`;
  }
  if ((await inUse(candidate)).length > 0) {
    return {
      chosen: null,
      said: null,
      refusal:
        `a Compose project named ${own} already exists on this machine (${held(found)}) and no ` +
        `free name was found near ${own}-${suffix}. Set COMPOSE_PROJECT_NAME in ${envPath} to ` +
        'a name that is free.',
    };
  }
  return {
    chosen: candidate,
    refusal: null,
    said:
      `a Compose project named ${own} already exists on this machine (${held(found)}), so this ` +
      `instance's development services run as ${candidate} instead of sharing its containers ` +
      `and data — COMPOSE_PROJECT_NAME=${candidate} in .env`,
  };
}

/** The chosen project name, into the `.env` Compose reads beside `compose.dev.yml`. */
function writeComposeProject(targetDir: string, name: string): void {
  const envPath = join(targetDir, '.env');
  const text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const header = [
    '',
    '# COMPOSE_PROJECT_NAME below was CHOSEN by `endora install`: a Compose project named',
    `# after this directory already existed on this machine when it ran, and two projects of`,
    '# one name are one project — the same containers and the same volumes. Compose reads',
    '# this file, so `pnpm run dev:services` and `pnpm run dev:services:down` both use it.',
  ].join('\n');
  writeFileSync(
    envPath,
    writeEnvFile(`${text.replace(/\n+$/, '')}\n${header}\n`, new Map([['COMPOSE_PROJECT_NAME', name]])),
    'utf8',
  );
}

/** What the port preflight decided. */
interface PortDecision {
  /** The variables this run sets, because the port each one defaults to is taken. */
  readonly chosen: ReadonlyMap<string, number>;
  /** One sentence per choice, for the operator. */
  readonly said: readonly string[];
  /** A port the operator pinned in `.env` and cannot have. */
  readonly refusals: readonly string[];
}

/**
 * Decide the host port of every service the development stack publishes.
 *
 * The run used to write the whole instance, install it, and die at
 * `dev:services` with Docker's *"port is already allocated"* on any machine
 * that already runs a PostgreSQL or a Redis — the ordinary developer machine.
 * And composing the addresses from the document's inline defaults regardless
 * was worse than a failed step: Redis and Meilisearch on their default ports
 * take no credential, so an instance derived against 6379 would have used
 * somebody else's.
 *
 * Two rules, and they are the whole of it:
 *
 *   * **a port the operator set is theirs.** `POSTGRES_PORT=…` in the target's
 *     `.env` is used as written, and if it is taken that is a refusal naming
 *     it — never a silent move to another one.
 *   * **a port nobody set is derived from this machine.** The document's own
 *     default when it is free; otherwise the next free one from `default +
 *     10000`, written into the instance's `.env` under the variable
 *     `compose.dev.yml` already reads, and said out loud. It is FR-105's class
 *     of value — an address of a container this run starts, on this machine —
 *     and not an invented input.
 */
async function decidePorts(
  document: string,
  envFile: ReadonlyMap<string, string>,
  inUse: PortProbe,
  envPath: string,
): Promise<PortDecision> {
  const chosen = new Map<string, number>();
  const said: string[] = [];
  const refusals: string[] = [];
  const assigned = new Set<number>();
  for (const { variable, fallback, service } of developmentPublishedPorts(document)) {
    const pinned = envFile.get(variable);
    if (pinned !== undefined) {
      const port = Number(pinned);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        refusals.push(`${variable}=${pinned} in ${envPath} is not a TCP port.`);
      } else if (assigned.has(port) || (await inUse(port))) {
        refusals.push(
          `${variable}=${pinned} in ${envPath} is already in use on this machine, so ${service} ` +
            `could not be published there. Set it to a free port, or remove the line and this ` +
            `command picks one.`,
        );
      } else {
        assigned.add(port);
      }
      continue;
    }
    if (!assigned.has(fallback) && !(await inUse(fallback))) {
      assigned.add(fallback);
      continue;
    }
    let candidate = fallback + 10_000 <= 65_535 ? fallback + 10_000 : 20_000 + (fallback % 10_000);
    let tries = 0;
    while (candidate <= 65_535 && tries < 500 && (assigned.has(candidate) || (await inUse(candidate)))) {
      candidate += 1;
      tries += 1;
    }
    if (candidate > 65_535 || tries >= 500) {
      refusals.push(
        `port ${String(fallback)} is already in use on this machine and no free one was found ` +
          `near ${String(fallback + 10_000)} for ${service}. Set ${variable} in ${envPath} to a ` +
          `port that is free.`,
      );
      continue;
    }
    assigned.add(candidate);
    chosen.set(variable, candidate);
    said.push(
      `port ${String(fallback)} is already in use on this machine, so ${service} is published on ` +
        `${String(candidate)} instead — ${variable}=${String(candidate)} in .env`,
    );
  }
  return { chosen, said, refusals };
}

/**
 * The chosen ports, into the instance's own `.env` — the file Compose reads
 * beside `compose.dev.yml`, so the stack and the addresses derived below are
 * moved by one line each rather than by two that could disagree.
 */
function writeChosenPorts(targetDir: string, chosen: ReadonlyMap<string, number>): void {
  if (chosen.size === 0) return;
  const envPath = join(targetDir, '.env');
  const text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const header = [
    '',
    `# ${[...chosen.keys()].join(', ')} below were CHOSEN by \`endora install\`: the port each`,
    `# one defaults to in ${DEV_COMPOSE_PATH} was already in use on this machine when it ran.`,
    '# Compose reads this file, so they are where the development services are published;',
    '# change one here and change the address derived from it above to match.',
  ].join('\n');
  writeFileSync(
    envPath,
    writeEnvFile(
      `${text.replace(/\n+$/, '')}\n${header}\n`,
      new Map([...chosen].map(([name, port]) => [name, String(port)] as const)),
    ),
    'utf8',
  );
}

/** The target's own `.env`, as an operator placed it or as this run wrote it. */
function readTargetEnv(targetDir: string): ReadonlyMap<string, string> {
  const envPath = join(targetDir, '.env');
  return existsSync(envPath) ? parseEnvFile(readFileSync(envPath, 'utf8')) : new Map();
}

/**
 * `PORT` as the operator set it for this instance — resolved as an input, or a
 * line of the `.env` they placed in the target — or `undefined` when nobody
 * did. A value somebody set is theirs and is never moved (`decideLayerPort`).
 */
function pinnedApiPort(targetDir: string, instance: NewInstanceResult): string | undefined {
  const resolved = instance.resolved.find((entry) => entry.name === 'PORT')?.value;
  const value = resolved ?? readTargetEnv(targetDir).get('PORT');
  return value !== undefined && /^\d+$/.test(value.trim()) ? value.trim() : undefined;
}

/**
 * The API's `PORT`, into the instance's own `.env` — the file the scaffolded
 * entry is started with, so `start`, `dev` and `dev:all` all listen there.
 */
function writeApiPort(targetDir: string, port: number, why: string): void {
  const envPath = join(targetDir, '.env');
  const text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const header = [
    '',
    '# PORT below was written by `endora install`:',
    `# ${why}.`,
    '# It is where the API listens. The admin bundle (VITE_API_BASE_URL in admin/.env) and the',
    "# storefront's two backend addresses name the same port — change one and change the",
    '# others to match, and build the admin again.',
  ].join('\n');
  writeFileSync(
    envPath,
    writeEnvFile(`${text.replace(/\n+$/, '')}\n${header}\n`, new Map([['PORT', String(port)]])),
    'utf8',
  );
}

/**
 * FR-105's derivation, performed on the tree this run just wrote.
 *
 * The values are read off **the rendered `compose.dev.yml`** and are written
 * only over names the instance's own `.env` already lists as unanswered
 * placeholders. That is the intersection stated structurally rather than as a
 * list: the placeholders are this instance's declaration, rendered, so an
 * instance that installs neither `search` nor `email` has no line to fill in
 * for either and no name of theirs appears in this file.
 *
 * A value the operator already supplied is never written over — `writeEnvFile`
 * fills a **commented** placeholder in place, and a filled line is not one.
 */
function deriveEnvironment(targetDir: string): readonly string[] {
  const envPath = join(targetDir, '.env');
  const composePath = join(targetDir, DEV_COMPOSE_PATH);
  if (!existsSync(envPath) || !existsSync(composePath)) return [];
  const text = readFileSync(envPath, 'utf8');
  const answered = parseEnvFile(text);
  // What this instance declares: the placeholders of the `.env` this run
  // seeded, and — because a `.env` the operator placed first is merged into and
  // gets no placeholder — the names its `.env.example` lists, which is the same
  // declaration rendered beside it. Reading the placeholders alone meant an
  // operator who placed one line (`PORT=…`, a pinned `POSTGRES_PORT=…`) got no
  // address derived at all, and a `setup` that then had no database to reach.
  const examplePath = join(targetDir, '.env.example');
  const example = existsSync(examplePath) ? readFileSync(examplePath, 'utf8') : '';
  const placeholders = new Set(
    [
      ...text.matchAll(/^\s*#\s*([A-Z][A-Z0-9_]*)\s*=/gm),
      ...example.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/gm),
    ].map((match) => match[1]!),
  );
  // The file's own values move the addresses: a `*_PORT` this run chose, or one
  // the operator set, is where Compose publishes the service, so it is where
  // the address has to point.
  const addresses = [...developmentAddresses(readFileSync(composePath, 'utf8'), answered)].filter(
    ([name]) => placeholders.has(name) && !answered.has(name),
  );
  if (addresses.length === 0) return [];
  // The sentence is the whole of the mitigation, so it names **which** values
  // it is about: they are filled in above, each over its own placeholder and in
  // the declaration's own order, and a comment at the bottom saying "these" and
  // nothing more would send a reader looking for a block that is not there.
  const header = [
    '',
    `# ${addresses.map(([name]) => name).join(', ')} above were DERIVED by \`endora install\``,
    `# from ${DEV_COMPOSE_PATH} beside this file: they are the addresses of the containers`,
    '# `pnpm run dev:services` starts, on THIS machine. Nothing invented them and nothing',
    '# asked you — they are what that file publishes, with any value this file sets for it.',
    '#',
    '# On a machine that is not a development one they are not the values you want: replace',
    '# each with the address of the service you actually run. They fail closed — a database',
    '# that is not there refuses a connection — rather than quietly writing somewhere else.',
  ].join('\n');
  const written = writeEnvFile(
    `${text.replace(/\n+$/, '')}\n${header}\n`,
    new Map(addresses),
  );
  writeFileSync(envPath, written, 'utf8');
  return addresses.map(([name]) => name);
}

/** The storefront's own `.env`, with the values this run owes it (FR-153/154). */
function storefrontInputs(input: {
  readonly instance: NewInstanceResult | null;
  /** The secret, or `undefined` when this run has none to give. */
  readonly secret: string | undefined;
  /** The address a browser calls the API at. */
  readonly apiOrigin: string;
  /** The address the storefront's own server calls the API at. */
  readonly backendOrigin: string;
  readonly siteOrigin: string;
  readonly salesChannel: string | undefined;
}): Record<string, string> {
  return {
    NEXT_PUBLIC_API_BASE_URL: input.apiOrigin,
    BACKEND_BASE_URL: input.backendOrigin,
    NEXT_PUBLIC_SITE_URL: input.siteOrigin,
    // The platform's own fallback, which is what the instance's default Sales
    // Channel is created with when `DEFAULT_SALES_CHANNEL_CODE` is unset
    // (`kernel/sales-channels/default-channel-reconciler.ts`). A different
    // string here would point the storefront at a channel nothing creates.
    NEXT_PUBLIC_SALES_CHANNEL_CODE: input.salesChannel ?? 'default',
    ...(input.secret === undefined ? {} : { REVALIDATE_SECRET: input.secret }),
    ...Object.fromEntries(
      (input.instance?.resolved ?? [])
        .filter((entry) => entry.name === 'DEFAULT_SALES_CHANNEL_CODE')
        .map((entry) => ['NEXT_PUBLIC_SALES_CHANNEL_CODE', entry.value] as const),
    ),
  };
}

/** The port the admin's Vite configuration falls back to (`new-instance/template.ts`). */
const ADMIN_DEFAULT_PORT = 3002;
/** The port `next dev` and `next start` fall back to. */
const STOREFRONT_DEFAULT_PORT = 3000;
/** The port the scaffolded entry falls back to (`const port = Number(process.env['PORT'] ?? 3001)`). */
const API_DEFAULT_PORT = 3001;

/** Where one layer this run stands up is served on this machine. */
interface LayerPort {
  readonly port: number;
  /** `true` when {@link port} is not the layer's default because that one is taken. */
  readonly moved: boolean;
  /** What the operator is told, when there is something to tell. */
  readonly said: string | null;
  /**
   * Why this run writes `PORT` into the layer's own file, or `null` when it
   * writes none — the default needs no line, and a port the operator set in
   * that file is already there.
   */
  readonly written: string | null;
}

/**
 * The port a **loopback** origin names, or `undefined`.
 *
 * `--storefront-url http://localhost:4000` is two statements at once: where a
 * browser finds the storefront, and — because the host is this machine — which
 * port it is served on. A public origin says nothing about the second: behind a
 * proxy the two are unrelated.
 */
function loopbackPort(origin: string | undefined): string | undefined {
  if (origin === undefined) return undefined;
  const url = new URL(origin);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return undefined;
  return url.port === '' ? undefined : url.port;
}

/**
 * The port a layer served on this machine listens on.
 *
 * `decidePorts`' two rules, for the two layers Compose does not publish: a port
 * the operator set is theirs and is used as written; a default that is taken is
 * replaced by the next free one from `default + 10000`, written where that
 * layer reads it and said out loud. The admin's Vite configuration is
 * `strictPort`, so a taken 3002 was a preview that would not start; `next`
 * moves itself to the next free port in silence, which leaves the storefront's
 * own `NEXT_PUBLIC_SITE_URL` and the API's allow-list naming a port nothing
 * listens on.
 */
async function decideLayerPort(
  layer: { readonly name: string; readonly fallback: number; readonly file: string },
  /** `PORT` as the operator set it in the layer's own file. */
  pinned: string | undefined,
  /** The port the layer's own loopback origin names, and which flag gave it. */
  named: { readonly port: string | undefined; readonly flag: string },
  inUse: PortProbe,
  assigned: Set<number>,
): Promise<LayerPort> {
  if (pinned !== undefined && /^\d+$/.test(pinned.trim())) {
    const port = Number(pinned.trim());
    assigned.add(port);
    return { port, moved: port !== layer.fallback, said: null, written: null };
  }
  if (named.port !== undefined) {
    const port = Number(named.port);
    assigned.add(port);
    return {
      port,
      moved: port !== layer.fallback,
      said: null,
      written:
        port === layer.fallback
          ? null
          : `it is the port of the \`${named.flag}\` this run was given`,
    };
  }
  if (!assigned.has(layer.fallback) && !(await inUse(layer.fallback))) {
    assigned.add(layer.fallback);
    return { port: layer.fallback, moved: false, said: null, written: null };
  }
  let candidate = layer.fallback + 10_000;
  let tries = 0;
  while (tries < 500 && (assigned.has(candidate) || (await inUse(candidate)))) {
    candidate += 1;
    tries += 1;
  }
  if (tries >= 500) {
    return {
      port: layer.fallback,
      moved: false,
      written: null,
      said:
        `port ${String(layer.fallback)} is already in use on this machine and no free one was ` +
        `found near ${String(layer.fallback + 10_000)} for ${layer.name}. Set PORT in ` +
        `${layer.file} to a port that is free before starting it.`,
    };
  }
  assigned.add(candidate);
  return {
    port: candidate,
    moved: true,
    written:
      `${String(layer.fallback)}, the default, was already in use on this machine when ` +
      '`endora install` ran',
    said:
      `port ${String(layer.fallback)} is already in use on this machine, so ${layer.name} is ` +
      `served on http://localhost:${String(candidate)} instead — PORT=${String(candidate)} in ` +
      layer.file,
  };
}

/**
 * The admin member's own `.env` — the file Vite reads for `dev`, `build` and
 * `preview` alike (`specs/138-separate-components/plan.md` D5).
 *
 * Written by this command and not by the template, so the template's file
 * manifest is untouched, and only when there is something to say: an API
 * origin that is not the bundle's compiled-in `http://localhost:3001`, or a
 * port that is not the configuration's own 3002. The root `.gitignore` covers
 * `.env` at any depth.
 */
function writeAdminEnv(
  targetDir: string,
  values: {
    readonly apiOrigin: string | undefined;
    /** The port to write, with why this run chose it; `undefined` writes none. */
    readonly port: { readonly value: number; readonly why: string } | undefined;
  },
): readonly string[] {
  const entries = new Map<string, string>();
  const header: string[] = ['# Written by `endora install`. Vite reads this file for `dev`, `build` and `preview`.'];
  if (values.apiOrigin !== undefined) {
    header.push(
      '#',
      '# VITE_API_BASE_URL is the API this admin calls. Vite writes it into the bundle when the',
      '# admin is built, so changing it means `pnpm run build:admin` again, not a restart.',
    );
    entries.set('VITE_API_BASE_URL', values.apiOrigin);
  }
  if (values.port !== undefined) {
    header.push(
      '#',
      '# PORT is where `pnpm run preview:admin` serves the bundle:',
      `# ${values.port.why}.`,
      '# The API allows a browser in by origin, so its CORS_ALLOWED_ORIGINS has to name the',
      '# address this port makes.',
    );
    entries.set('PORT', String(values.port.value));
  }
  if (entries.size === 0) return [];
  const dir = join(targetDir, 'admin');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.env'), writeEnvFile(`${header.join('\n')}\n`, entries), 'utf8');
  return [...entries.keys()];
}

/**
 * Values this run was told or decided, into the instance's own `.env` — each
 * only where the instance **declares** the name and the operator has not
 * already answered it (FR-014, FR-016).
 *
 * Declared is `deriveEnvironment`'s reading: a placeholder in the `.env` this
 * run seeded, or a name in the `.env.example` rendered beside it. So
 * `ADMIN_BASE_URL` is written into an instance that installs the module
 * reading it and into no other, with no list of modules here.
 */
function writeDeclared(targetDir: string, values: ReadonlyMap<string, string>): readonly string[] {
  const envPath = join(targetDir, '.env');
  if (values.size === 0 || !existsSync(envPath)) return [];
  const text = readFileSync(envPath, 'utf8');
  const answered = parseEnvFile(text);
  const examplePath = join(targetDir, '.env.example');
  const example = existsSync(examplePath) ? readFileSync(examplePath, 'utf8') : '';
  const declared = new Set(
    [
      ...text.matchAll(/^\s*#\s*([A-Z][A-Z0-9_]*)\s*=/gm),
      ...example.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/gm),
    ].map((match) => match[1]!),
  );
  const writable = [...values].filter(([name]) => declared.has(name) && !answered.has(name));
  if (writable.length === 0) return [];
  writeFileSync(envPath, writeEnvFile(text, new Map(writable)), 'utf8');
  return writable.map(([name]) => name);
}

/** A storefront's `PORT`, appended to the `.env` its own resolution wrote. */
function writeStorefrontPort(storefrontDir: string, port: number, why: string): void {
  const envPath = join(storefrontDir, '.env');
  const text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const header = [
    '',
    '# PORT below was written by `endora install`:',
    `# ${why}.`,
    '# `pnpm run dev` and `pnpm run start` both read it from this file. Where',
    '# NEXT_PUBLIC_SITE_URL above is a localhost address it names the same port, and so does',
    "# the API's allow-list — change one and change the others to match.",
  ].join('\n');
  writeFileSync(
    envPath,
    writeEnvFile(`${text.replace(/\n+$/, '')}\n${header}\n`, new Map([['PORT', String(port)]])),
    'utf8',
  );
}

/**
 * The whole command.
 *
 * Three phases, in this order and never interleaved: **decide** (every
 * precondition, one refusal), **write** (the two scaffolds and the derived
 * `.env`), **run** (the pipeline, each step echoed). A `--dry-run` stops after
 * the first and reports the other two.
 */
export async function runInstall(given: InstallOptions): Promise<InstallResult> {
  const cwd = given.cwd ?? process.cwd();
  const output: string[] = [];
  const say = (line: string): void => {
    output.push(line);
    given.echo?.(line);
  };

  // ── ask, only where R2.5c's conjunction holds (R2.5f i) ───────────────────
  const interactive = mayPrompt(
    given.interactivity ??
      interactivityOf({
        nonInteractive: given.nonInteractive === true,
        dryRun: given.dryRun === true,
      }),
  );
  let options: InstallOptions = given;
  let wizard: {
    readonly fromFlags: ReadonlyMap<QuestionId, string>;
    readonly prompted: readonly QuestionId[];
    readonly recommended: readonly QuestionId[];
  } | null = null;
  if (interactive) {
    // A selection the flags already got wrong is refused before the first
    // question: nobody should answer seven of them to be told the first flag
    // they typed named a component that does not exist.
    const typed = resolveSelection(given.only, given.without ?? [], given.storefront);
    if ('refusals' in typed) {
      const early = new Refusals();
      for (const sentence of typed.refusals) early.add(sentence);
      early.throwIfAny();
    }
    try {
      const outcome = await askWizard(
        given,
        given.io ?? { input: process.stdin, output: process.stdout, terminal: true },
        {
          vocabulary: MEMBER_VOCABULARY,
          storefront: {
            available: storefrontUnavailable(cwd, given.packagedReferenceDir) === null,
            reason:
              'not from here: there is no checkout of the platform repository above this ' +
              'directory and this build of the CLI carries no reference storefront — ' +
              '`endora new storefront` adds it later',
          },
        },
      );
      options = { ...given, ...outcome.answers };
      wizard = outcome;
    } catch (error: unknown) {
      if (error instanceof WizardClosedError) throw new InstallInputError(error.message);
      throw error;
    }
  }

  // ── decide ────────────────────────────────────────────────────────────────
  const refusals = new Refusals();
  // What this run stands up (`specs/138-separate-components/`). Resolved first:
  // which answers are owed, which flags answer nothing and whether an instance
  // is written at all are each a function of it.
  const resolved = resolveSelection(options.only, options.without ?? [], options.storefront);
  const selection: Selection | null = 'refusals' in resolved ? null : resolved;
  if ('refusals' in resolved) for (const sentence of resolved.refusals) refusals.add(sentence);
  const has = (component: Component): boolean =>
    selection !== null && selection.components.includes(component);
  const standsUpApi = has('api');
  const writesTree = selection?.writesTree ?? true;
  const named = selection === null ? '' : `\`--only ${selection.components.join(',')}\``;

  // R2.5f (iv) — where each answer came from, over the questions this
  // selection has (FR-019). Nothing asked: every answer is a flag, and an
  // offered question a flag did not answer takes its recommendation, which is
  // what Phase 3 already did and is now said out loud.
  const questions = installQuestions(selection ?? EVERYTHING);
  const applicable = new Set(questionIdsFor(selection ?? EVERYTHING));
  const fromFlags = new Map(
    [...(wizard?.fromFlags ?? answeredByFlags(given))].filter(([id]) => applicable.has(id)),
  );
  const provenance = {
    fromFlags,
    prompted: (wizard?.prompted ?? []).filter((id) => applicable.has(id)),
    recommended:
      wizard === null
        ? questions
            .filter((question) => question.kind === 'offered' && !fromFlags.has(question.id))
            .map((question) => question.id)
        : wizard.recommended.filter((id) => applicable.has(id)),
  };

  // A missing directory is one refusal among the others rather than the first
  // and only one: a run with no answers at all is told everything it owes in
  // one message (FR-157, R3.2), and the checks that need a directory are the
  // only ones it skips.
  const namedDir =
    options.dir === undefined || options.dir.trim().length === 0
      ? null
      : isAbsolute(options.dir)
        ? options.dir
        : resolve(cwd, options.dir);
  if (namedDir === null) {
    refusals.add(
      '`endora install` takes the directory to write — `<dir>` — and outside the wizard has no ' +
        "default: the directory's basename becomes the workspace name, so a default would " +
        'invent a name nobody chose.',
    );
  }
  const wantsStorefront = selection?.storefront ?? false;
  const wantsServices = standsUpApi && options.services !== false;
  // FR-007 — the storefront alone has no instance to sit beside: `<dir>` is its
  // own directory.
  const namedStorefrontDir =
    !wantsStorefront || namedDir === null
      ? null
      : !writesTree
        ? namedDir
        : options.storefrontDir === undefined
          ? `${namedDir}-storefront`
          : isAbsolute(options.storefrontDir)
            ? options.storefrontDir
            : resolve(cwd, options.storefrontDir);

  if (writesTree) {
    const declinedRefusal = memberRefusal(selection?.without ?? options.without ?? []);
    if (declinedRefusal !== null) refusals.add(declinedRefusal);
  }

  const inTheWay = namedDir === null ? null : occupied(namedDir);
  if (inTheWay !== null) {
    refusals.add(
      `${namedDir!} exists and is not empty (${inTheWay}). ` +
        `${writesTree ? "An instance's" : "A storefront's"} files are yours; ` +
        'this command never merges into a directory. Scaffold into an empty one — a ' +
        'directory holding nothing but a `.env` is the exception, and that file is read as ' +
        'your own answers.',
    );
  }

  // FR-160 — a sibling, never a child. A storefront inside the instance would
  // be swept into its `pnpm-workspace.yaml` globs and become a member of a
  // workspace it is not part of, which is D-230's topology broken by a
  // directory choice.
  if (writesTree && namedStorefrontDir !== null && namedStorefrontDir.startsWith(namedDir! + sep)) {
    refusals.add(
      `--storefront-dir ${namedStorefrontDir} is inside ${namedDir!}. The storefront is its own ` +
        "repository (D-195): written there it would be swept into the instance's workspace " +
        'globs and become a member of a workspace it is not part of. Put it beside the ' +
        'instance — the default is `<dir>-storefront`.',
    );
  }
  if (writesTree && namedStorefrontDir !== null) {
    const storefrontInTheWay = occupied(namedStorefrontDir);
    if (storefrontInTheWay !== null) {
      refusals.add(
        `${namedStorefrontDir} exists and is not empty (${storefrontInTheWay}). Pass ` +
          '`--storefront-dir <path>` for another directory, or `--no-storefront` to write no ' +
          'storefront at all.',
      );
    }
  }

  const engines = ownEnginesNode();
  if (engines !== undefined && !satisfiesNode(engines, process.versions.node)) {
    refusals.add(
      `this build needs Node ${engines} and is running on ${process.versions.node}. The ` +
        'instance it writes declares the same range, so a run on this one would install a ' +
        'tree its own manifest refuses.',
    );
  }

  const runners = options.packageManagers ?? resolvePackageManagers();
  if (runners.length === 0) {
    refusals.add(
      'no package manager to run: `pnpm` is not on PATH and `corepack` is not either. ' +
        'Install pnpm (`npm i -g pnpm`), or use a Node that ships corepack — this command ' +
        `runs \`${ownCorepackRunner()?.label ?? 'corepack pnpm@<the version this CLI pins>'}\` ` +
        'when it has to, and never `corepack enable`, which writes shims into a directory ' +
        'it does not own.',
    );
  }

  if (wantsServices && (options.dockerReachable ?? dockerIsReachable()) === false) {
    refusals.add(
      'no Docker daemon answered. The development stack — PostgreSQL, Redis, Meilisearch ' +
        'and a mail catcher — is started with `docker compose`, so this run has nothing to ' +
        'migrate against. Start Docker, or pass `--no-services` and point the instance at ' +
        'services you run yourself.',
    );
  }

  const noStorefront = wantsStorefront
    ? storefrontUnavailable(cwd, options.packagedReferenceDir)
    : null;
  if (noStorefront !== null) {
    refusals.add(
      `the storefront cannot be written from here: ${noStorefront}` +
        (writesTree
          ? ' Pass `--no-storefront` to write the instance alone — the storefront can be added ' +
            'later with `endora new storefront <dir>`.'
          : ''),
    );
  }

  const admin = {
    email: options.adminEmail,
    password: options.adminPassword,
    firstName: options.adminFirstName,
    lastName: options.adminLastName,
  };
  if (standsUpApi) {
    const missingAdmin = (
      [
        ['--admin-email', admin.email],
        ['--admin-password', admin.password],
        ['--admin-first-name', admin.firstName],
        ['--admin-last-name', admin.lastName],
      ] as const
    ).filter(([, value]) => value === undefined || value.trim().length === 0);
    if (missingAdmin.length > 0) {
      // FR-159 — a generated password is not permitted: `generable` requires that
      // two correct values are interchangeable, and a password the operator has
      // to remember is not one of those.
      refusals.add(
        `the administrator is missing ${missingAdmin.map(([flag]) => flag).join(', ')}. ` +
          'Nothing else creates one — a freshly migrated instance has no account at all — and ' +
          'the password is never generated: it is the one value you have to remember.',
      );
    }

    if (options.demo === undefined) {
      // FR-124 — required, by 125 PR-2 option (c) as ruled (D-269).
      refusals.add(
        'say whether to install demo data: `--demo` seeds every installed module\'s example ' +
          'rows, `--no-demo` seeds none. There is deliberately no default — an instance you ' +
          'are going to sell from wants none of it and one you are evaluating wants it before ' +
          'the first screen, and picking for you would be picking wrong for one of them.',
      );
    }
  }

  // ── the other machines (138 FR-011…FR-013) ───────────────────────────────
  const originOf = (flag: string, value: string | undefined): string | undefined => {
    if (value === undefined || value.trim().length === 0) return undefined;
    const origin = parseOrigin(value);
    if (origin === null) {
      refusals.add(
        `\`${flag} ${value}\` is not an origin: scheme and host, an optional port, no path — ` +
          'as in `https://api.example.com` or `http://10.0.0.5:3001`.',
      );
      return undefined;
    }
    return origin;
  };
  const given138 = (value: string | undefined): boolean =>
    value !== undefined && value.trim().length > 0;
  const apiUrl = originOf('--api-url', options.apiUrl);
  const adminUrl = originOf('--admin-url', options.adminUrl);
  const storefrontUrl = originOf('--storefront-url', options.storefrontUrl);
  const salesChannel = given138(options.salesChannel) ? options.salesChannel!.trim() : undefined;
  if (selection !== null) {
    if (!standsUpApi && !given138(options.apiUrl)) {
      refusals.add(
        '`--api-url` is required: this run does not stand the API up, so it has to be told ' +
          'where the API is — its public origin, as in `https://api.example.com`. It is ' +
          'written into what this run builds, and a wrong one is a rebuild.',
      );
    }
    if (!standsUpApi && wantsStorefront) {
      if (!given138(options.storefrontUrl)) {
        refusals.add(
          "`--storefront-url` is required: the storefront's own public origin, as in " +
            '`https://shop.example.com`. Every canonical link, the sitemap and robots.txt are ' +
            'built from it, and with the API on another machine nothing here can derive it.',
        );
      }
      if (!given138(options.revalidateSecret)) {
        refusals.add(
          '`--revalidate-secret` is required: the `REVALIDATE_SECRET` the API\'s `.env` already ' +
            'holds. A run that does not stand the API up never generates it — a second value ' +
            'would be two halves of a pair that do not match, and neither side would say so.',
        );
      }
    }

    // D7 — a flag for a question the selection removed is refused rather than
    // ignored: a flag that silently does nothing is the failure `--topology`
    // already refuses.
    const plural = (flags: readonly string[], one: string, many: string): string =>
      `${flags.map((flag) => `\`${flag}\``).join(', ')} ${flags.length === 1 ? one : many}`;
    if (!standsUpApi) {
      const noApi = [
        ...(options.demo === true ? ['--demo'] : options.demo === false ? ['--no-demo'] : []),
        ...(options.services === false ? ['--no-services'] : []),
        ...(given138(admin.email) ? ['--admin-email'] : []),
        ...(given138(admin.password) ? ['--admin-password'] : []),
        ...(given138(admin.firstName) ? ['--admin-first-name'] : []),
        ...(given138(admin.lastName) ? ['--admin-last-name'] : []),
        ...(given138(options.adminUrl) ? ['--admin-url'] : []),
      ];
      if (noApi.length > 0) {
        refusals.add(
          `${plural(noApi, 'answers', 'answer')} a question this run does not have: ${named} ` +
            'stands up no API on this machine, so there is no database to seed, no account ' +
            'to create, no development stack to start and no allow-list to write. Remove ' +
            `${noApi.length === 1 ? 'it' : 'them'}, or add \`api\` to \`--only\`.`,
        );
      }
    }
    if (!writesTree) {
      const noTree = [
        ...((options.without ?? []).some((name) => name.trim().length > 0) ? ['--without'] : []),
        ...((options.modules ?? []).some((name) => name.trim().length > 0) ? ['--module'] : []),
        ...(options.deployment === undefined ? [] : ['--deployment']),
        ...(options.topology === undefined ? [] : ['--topology']),
      ];
      if (noTree.length > 0) {
        refusals.add(
          `${plural(noTree, 'names', 'name')} something this run does not write: ${named} ` +
            'writes the storefront alone, and no instance tree. Remove ' +
            `${noTree.length === 1 ? 'it' : 'them'}, or add \`api\` or \`admin\` to \`--only\`.`,
        );
      }
      if (options.storefrontDir !== undefined) {
        refusals.add(
          `\`--storefront-dir\` was given, and with ${named} the storefront goes to \`<dir>\` ` +
            'itself — there is no instance for it to sit beside. Name the directory once.',
        );
      }
    }
    const noStorefrontHere = [
      ...(!standsUpApi && !wantsStorefront && given138(options.storefrontUrl)
        ? ['--storefront-url']
        : []),
      ...(!standsUpApi && !wantsStorefront && given138(options.salesChannel)
        ? ['--sales-channel']
        : []),
      ...(!standsUpApi && !wantsStorefront && given138(options.revalidateSecret)
        ? ['--revalidate-secret']
        : []),
    ];
    if (noStorefrontHere.length > 0) {
      refusals.add(
        `${plural(noStorefrontHere, 'answers', 'answer')} a question this run does not have: ` +
          `${named} writes no storefront and stands up no API, and those are the only two ` +
          `that read ${noStorefrontHere.length === 1 ? 'it' : 'them'}. Remove ` +
          `${noStorefrontHere.length === 1 ? 'it' : 'them'}, or add \`storefront\` to \`--only\`.`,
      );
    }
    if (standsUpApi && given138(options.salesChannel)) {
      refusals.add(
        '`--sales-channel` answers a question this run does not have: the API this run stands ' +
          'up creates its own default Sales Channel, and a storefront written beside it is ' +
          'pointed at that one. To change the code, set `DEFAULT_SALES_CHANNEL_CODE` in a ' +
          '`.env` placed in the target directory before the run.',
      );
    }
  }

  refusals.throwIfAny();
  // All decided: a missing directory and a selection that is not one were
  // refusals above.
  const chosen = selection!;
  const targetDir = namedDir!;
  const storefrontDir = namedStorefrontDir;
  const runner = runners[0]!;
  const dryRun = options.dryRun === true;
  const run = options.run ?? spawnSteps(runner);

  // ── provision, only where nothing of ours resolves (D-271) ───────────────
  // Decided before anything is written, like every other input: an index this
  // build cannot read, or a `--registry` that is not one, refuses here. A run
  // that writes no instance reads no module set, so it provisions nothing.
  const hostStep = writesTree
    ? planHost({
        cwd,
        targetDir,
        runner,
        registry: options.registry,
        releaseIndexFile: options.releaseIndexFile,
      })
    : null;

  // ── write ─────────────────────────────────────────────────────────────────
  say(`endora install ${targetDir}${dryRun ? ' — dry run, nothing written' : ''}`);
  const answers = answersLine(provenance, questions.length);
  say(`  ${answers}`);
  if (hostStep !== null) {
    const keptLine =
      `  the temporary host is kept at ${hostStep.cwd} so you can read what its install ` +
      'left; delete it when you are done.';
    say(`\n[host] ${hostStep.command}   # in ${hostStep.cwd}`);
    say(`      ${hostStep.purpose}`);
    const code = await run(hostStep);
    if (code !== 0) {
      say(keptLine);
      throw new InstallHostError(
        `${hostStep.command} failed (exit ${String(code)}) in the temporary host ` +
          `${hostStep.cwd}, so no package of this release could be read and nothing was ` +
          `written to ${targetDir}. The host is kept there so you can read what its install ` +
          'left. If the registry needs configuration, pass `--registry <url>`; then run this ' +
          'command again.',
        code,
      );
    }
  }
  const without = chosen.without;
  const hostKept = (): void => {
    if (hostStep === null) return;
    say(
      `  the temporary host is kept at ${hostStep.cwd} so you can read what it holds; ` +
        'delete it when you are done.',
    );
  };
  const scaffold = async (dry: boolean): Promise<NewInstanceResult> => {
    try {
      return await runNewInstance({
        dir: targetDir,
        ...(options.modules === undefined ? {} : { modules: options.modules }),
        // R6.3b — nothing at all when every member is wanted, so the common case
        // is the argv a bare `endora new instance <dir>` has.
        ...(without.length === 0 ? {} : { without }),
        ...(options.deployment === undefined ? {} : { deployment: options.deployment }),
        ...(options.registry === undefined ? {} : { registry: options.registry }),
        ...(options.topology === undefined ? {} : { topology: options.topology }),
        // D-270 — with no `--module`, every module of the open-source set this
        // run resolved rather than the smallest set. A policy, not a list: which
        // modules that is stays `new instance`'s to derive (FR-143).
        moduleSeed: 'available',
        // `--demo` is the one answer that changes the module list: the demo
        // composition joins it, so the seed step below wires the modules' rows
        // together rather than leaving them side by side (2026-10-01). It writes
        // no file — the decision still runs a command (FR-121).
        ...(standsUpApi && options.demo === true ? { demo: true } : {}),
        dryRun: dry,
        // The host, when there is one, is only a place to look: every resolution
        // is `new instance`'s, unchanged (D-271 clause 1.1).
        cwd: hostStep?.cwd ?? cwd,
      });
    } catch (error: unknown) {
      hostKept();
      throw error;
    }
  };

  // ── the ports the development stack will publish ─────────────────────────
  // Decided on the **plan**, before the first byte of the instance is written:
  // which ports the stack publishes is a fact of the document `new instance`
  // renders, so the plan is made once dry to read it. A port the operator
  // pinned and cannot have is then a refusal with nothing on disk, rather than
  // a `docker compose` failure two steps into an installed tree.
  const portInUse = options.portInUse ?? machinePortProbe();
  let ports: PortDecision = { chosen: new Map(), said: [], refusals: [] };
  let composeProject: ComposeProjectDecision = { chosen: null, said: null, refusal: null };
  let instance: NewInstanceResult | null = null;
  // An admin with no API beside it is the one artefact this run exists for
  // (138 FR-006), so a release that cannot write the admin member is a refusal
  // made on the plan — not a tree with a backend in it and nothing to build.
  const adminAlone = writesTree && has('admin') && !standsUpApi;
  if (writesTree && (wantsServices || adminAlone)) {
    const planned = await scaffold(true);
    const refuseOnPlan = (heading: string, sentences: readonly string[]): never => {
      if (hostStep !== null) rmSync(hostStep.cwd, { recursive: true, force: true });
      throw new InstallInputError(
        `${heading} — ${String(sentences.length)} thing${sentences.length === 1 ? '' : 's'} ` +
          'to settle first:\n' +
          sentences.map((sentence) => `  - ${sentence}`).join('\n') +
          `\n\nNothing was written and nothing was started.`,
      );
    };
    if (adminAlone && !planned.plan.members.includes('admin')) {
      const why = planned.plan.omitted.find((omission) => omission.path.startsWith('admin'));
      refuseOnPlan('`endora install` cannot build the admin', [
        `${named} builds the admin bundle, and this release cannot write the admin member` +
          `${why === undefined ? '' : `: ${why.reason}`}. Nothing else in this selection would ` +
          'be stood up, so there is nothing to run.',
      ]);
    }
    if (wantsServices) {
      const document = planned.plan.files.find((file) => file.path === DEV_COMPOSE_PATH)?.content;
      if (document !== undefined) {
        ports = await decidePorts(document, readTargetEnv(targetDir), portInUse, join(targetDir, '.env'));
      }
      composeProject = await decideComposeProject(
        targetDir,
        readTargetEnv(targetDir),
        options.composeProjectInUse ?? machineComposeProjectProbe(),
        join(targetDir, '.env'),
      );
      const refused = [
        ...ports.refusals,
        ...(composeProject.refusal === null ? [] : [composeProject.refusal]),
      ];
      if (refused.length > 0) {
        refuseOnPlan('`endora install` cannot start the development services', refused);
      }
    }
    instance = dryRun ? planned : await scaffold(false);
  } else if (writesTree) {
    instance = await scaffold(dryRun);
  }
  if (hostStep !== null) {
    rmSync(hostStep.cwd, { recursive: true, force: true });
    say(
      `  removed the temporary host at ${hostStep.cwd}` +
        (dryRun ? ` — it was provisioned to read the module set; nothing was written to ${targetDir}` : ''),
    );
  }
  if (instance !== null) {
    say(
      `  ${dryRun ? 'would write' : 'wrote'} ${String(instance.plan.files.length)} files across ` +
        `${instance.plan.members.join(', ')} — ${instance.modules.ids.length} module(s)`,
    );
    say(`  ${instance.provenance}`);
  }

  // ── where each layer this run stands up is served ────────────────────────
  // One rule for all three (`decideLayerPort`): a port somebody set is theirs,
  // and a default that is taken is replaced by a free one, written where the
  // layer reads it and said out loud. The API was the exception — a taken 3001
  // was reported in the closing block and left alone — so on a machine that
  // already runs something there, the `dev:all` this run printed could not
  // start the API, and the admin and the storefront it had just built and
  // written pointed at somebody else's server.
  const assigned = new Set<number>(ports.chosen.values());
  const apiLayer: LayerPort | null =
    standsUpApi && instance !== null
      ? await decideLayerPort(
          { name: 'the API', fallback: API_DEFAULT_PORT, file: join(targetDir, '.env') },
          pinnedApiPort(targetDir, instance),
          { port: loopbackPort(apiUrl), flag: '--api-url' },
          portInUse,
          assigned,
        )
      : null;
  const apiPort = String(apiLayer?.port ?? API_DEFAULT_PORT);
  const adminHere = instance !== null && instance.plan.members.includes('admin');
  const adminPort: LayerPort | null = adminHere
    ? await decideLayerPort(
        { name: 'the admin', fallback: ADMIN_DEFAULT_PORT, file: join(targetDir, 'admin', '.env') },
        undefined,
        { port: loopbackPort(adminUrl), flag: '--admin-url' },
        portInUse,
        assigned,
      )
    : null;
  const storefrontPort: LayerPort | null =
    storefrontDir === null
      ? null
      : await decideLayerPort(
          { name: 'the storefront', fallback: STOREFRONT_DEFAULT_PORT, file: join(storefrontDir, '.env') },
          readTargetEnv(storefrontDir).get('PORT'),
          { port: loopbackPort(storefrontUrl), flag: '--storefront-url' },
          portInUse,
          assigned,
        );
  // What a browser on this machine reaches each layer at, when nobody said
  // otherwise: the development address, on the port just decided.
  const apiOrigin = apiUrl ?? `http://localhost:${apiPort}`;
  const adminOrigin = adminUrl ?? `http://localhost:${String(adminPort?.port ?? ADMIN_DEFAULT_PORT)}`;
  const storefrontOrigin =
    storefrontUrl ?? `http://localhost:${String(storefrontPort?.port ?? STOREFRONT_DEFAULT_PORT)}`;

  // FR-153 — generated **once**, for two trees; and, since D-284 clause 3, by a
  // run that stands the API up without the storefront, which is then the side
  // the value originates on. A run without the API never generates it: the
  // refusal above is what it gets instead.
  const originatesSecret = standsUpApi && (storefrontDir !== null || chosen.subset);
  const secret =
    options.revalidateSecret ??
    (originatesSecret ? (dryRun ? '<generated on a real run>' : generateSecret()) : undefined);
  let storefront: NewStorefrontResult | null = null;
  if (storefrontDir !== null) {
    storefront = await runNewStorefront({
      dir: storefrontDir,
      cwd,
      dryRun,
      nonInteractive: true,
      // The registry the instance installs from is the one the storefront does:
      // without it the sibling asked the public registry for packages only the
      // named one holds.
      ...(options.registry === undefined ? {} : { registry: options.registry }),
      inputs: storefrontInputs({
        instance,
        secret,
        apiOrigin,
        // Its own server reaches an API on the same machine directly; one on
        // another machine, at the origin it was given (FR-012).
        backendOrigin: standsUpApi ? `http://localhost:${apiPort}` : apiOrigin,
        siteOrigin: storefrontOrigin,
        salesChannel,
      }),
      ...(options.packagedReferenceDir === undefined
        ? {}
        : { packagedReferenceDir: options.packagedReferenceDir }),
    });
    say(
      `  ${dryRun ? 'would write' : 'wrote'} the storefront at ${storefrontDir} — ` +
        `${String(storefront.plan.files.length)} files` +
        (storefront.source.kind === 'packaged'
          ? ', from the reference storefront this CLI carries'
          : ''),
    );
    for (const omission of storefront.plan.omitted) {
      say(`    omitted ${omission.path} — ${omission.reason}`);
    }
    say(`  ${storefront.provenance}`);
    if (!dryRun && storefrontPort !== null && storefrontPort.written !== null) {
      writeStorefrontPort(storefrontDir, storefrontPort.port, storefrontPort.written);
    }
  }

  for (const line of ports.said) say(`  ${dryRun ? 'on a real run: ' : ''}${line}`);
  if (composeProject.said !== null) say(`  ${dryRun ? 'on a real run: ' : ''}${composeProject.said}`);
  if (!dryRun && composeProject.chosen !== null) writeComposeProject(targetDir, composeProject.chosen);
  for (const layer of [apiLayer, adminPort, storefrontPort]) {
    if (layer !== null && layer.said !== null) say(`  ${dryRun ? 'on a real run: ' : ''}${layer.said}`);
  }
  if (!dryRun) writeChosenPorts(targetDir, ports.chosen);
  if (!dryRun && apiLayer !== null && apiLayer.written !== null) {
    writeApiPort(targetDir, apiLayer.port, apiLayer.written);
  }
  const derived =
    dryRun || !wantsServices
      ? []
      : [...ports.chosen.keys(), ...deriveEnvironment(targetDir)];
  if (derived.length > ports.chosen.size) {
    say(
      `  derived from ${DEV_COMPOSE_PATH} into .env: ` +
        `${derived.slice(ports.chosen.size).join(', ')} — the addresses of ` +
        'the containers the next step starts, on this machine',
    );
  }

  // ── the admin's own `.env` (138 FR-012, D5) ──────────────────────────────
  // The origin the bundle is built against, when it is not the one compiled in:
  // the one this run was told, or this instance's own `PORT` when that is not
  // the default — an admin built for 3001 against an API on another port signs
  // nobody in.
  if (adminHere && !dryRun) {
    const builtAgainst =
      apiUrl ??
      (standsUpApi && apiPort !== String(API_DEFAULT_PORT) ? `http://localhost:${apiPort}` : undefined);
    const wrote = writeAdminEnv(targetDir, {
      apiOrigin: builtAgainst,
      port:
        adminPort === null || adminPort.written === null
          ? undefined
          : { value: adminPort.port, why: adminPort.written },
    });
    if (wrote.includes('VITE_API_BASE_URL')) {
      say(
        `  wrote VITE_API_BASE_URL=${builtAgainst!} into admin/.env — the API the admin bundle ` +
          'is built against',
      );
    }
  }

  // ── the other machines, into the API's own `.env` (138 FR-014) ───────────
  if (standsUpApi && !dryRun) {
    const adminMoved = adminPort?.moved === true;
    const storefrontMoved = storefrontPort?.moved === true;
    const told = new Map<string, string>();
    // A moved API is not at the development fallback the platform assumes for
    // its own public origin either, so the address goes with the port.
    if (apiUrl !== undefined || apiLayer?.moved === true) told.set('PUBLIC_API_BASE_URL', apiOrigin);
    if (adminUrl !== undefined || adminMoved) told.set('ADMIN_BASE_URL', adminOrigin);
    if (storefrontUrl !== undefined || storefrontMoved) told.set('STOREFRONT_BASE_URL', storefrontOrigin);
    if (apiUrl !== undefined || adminUrl !== undefined || adminMoved || storefrontUrl !== undefined || storefrontMoved) {
      told.set('CORS_ALLOWED_ORIGINS', `${adminOrigin},${storefrontOrigin}`);
    }
    const wrote = writeDeclared(targetDir, told);
    if (wrote.length > 0) {
      say(`  wrote into .env: ${wrote.join(', ')} — where this API and the other two are reached`);
    }
  }

  if (!dryRun && standsUpApi && secret !== undefined) {
    writeSharedSecret(targetDir, secret);
    if (storefrontDir !== null && options.revalidateSecret === undefined) {
      say(
        '  generated REVALIDATE_SECRET once and wrote it into both trees — the one value no ' +
          'sequence of `endora new instance` and `endora new storefront` can agree on',
      );
    }
  }

  // ── run ───────────────────────────────────────────────────────────────────
  const steps = plan({
    targetDir: writesTree ? targetDir : null,
    storefrontDir,
    runner,
    api: standsUpApi,
    buildAdmin: adminAlone,
    services: wantsServices,
    demo: options.demo === true,
    admin,
  });
  let exitCode = 0;
  const done: InstallStep[] = [];
  if (!dryRun) {
    for (const step of steps) {
      say(`\n[${String(done.length + 1)}/${String(steps.length)}] ${step.command}`);
      say(`      ${step.purpose}`);
      const code = await run(step);
      done.push(step);
      if (code === 0) continue;
      if (step.optional === true) {
        say(
          `      that failed (exit ${String(code)}) and the install is complete without it. ` +
            `Retry with \`${typeable(runner, step.command)}\`, and ` +
            `\`${typeable(runner, `${runner.label} run cli demo reset`)}\` withdraws it again.`,
        );
        continue;
      }
      exitCode = code;
      // The list starts **at** the step that failed: it did not complete, so a
      // client who follows the list from its first line has to run it again.
      // It used to start after it, and following it verbatim skipped the very
      // step the run died on.
      say(
        `\n${step.command} failed (exit ${String(code)}). Remaining steps, in order — the ` +
          'first is the one that failed:',
      );
      for (const left of steps.slice(done.length - 1)) {
        say(`  cd ${left.cwd} && ${typeable(runner, left.command)}   # ${left.purpose}`);
      }
      if (steps.slice(done.length - 1).some((left) => left.id === 'admin')) {
        say(
          `  (${PASSWORD_PLACEHOLDER} stands for the administrator password you chose: it is ` +
            'not printed here, so type it in its place.)',
        );
      }
      break;
    }
  } else {
    say('\nThe pipeline it would run, in order:');
    for (const step of steps) say(`  ${step.command}   # ${step.purpose}`);
  }

  if (exitCode === 0) {
    for (const line of closing({
      targetDir,
      storefrontDir,
      selection: chosen,
      admin,
      instance,
      dryRun,
      demo: options.demo === true,
      recommended: provenance.recommended,
      services: wantsServices,
      passwordFromFlag: provenance.fromFlags.has('admin-password'),
      corepack: runner.command === 'corepack' ? runner : null,
      apiPort,
      apiPortBusy: standsUpApi ? await portInUse(Number(apiPort)) : false,
      apiOrigin,
      adminOrigin,
      storefrontOrigin,
      adminPort,
      storefrontPort,
      // Said only where it is true: the file holds a value, this run's or
      // the operator's own.
      secretInInstance:
        standsUpApi &&
        storefrontDir === null &&
        chosen.subset &&
        (dryRun || readTargetEnv(targetDir).has('REVALIDATE_SECRET')),
      storefrontToldToApi: storefrontUrl !== undefined,
    })) {
      say(line);
    }
  }

  return {
    targetDir,
    storefrontDir,
    components: chosen.components,
    instance,
    storefront,
    steps,
    hostStep,
    output,
    exitCode,
    derived,
    answers,
    dryRun,
  };
}

/**
 * The temporary host step, or `null` when the platform already resolves.
 *
 * D-271: provisioned **exactly** when `@endora-commerce/platform` does not
 * resolve beside the target or the working directory — a checkout, the
 * acceptance harness and a client who installed the packages beside all plan
 * none, and run exactly as before. Its files are written here, before the
 * header is printed, because a release index this build cannot read is an input
 * the run could not read and is refused before anything is started.
 */
function planHost(input: {
  readonly cwd: string;
  readonly targetDir: string;
  readonly runner: PackageManagerRunner;
  readonly registry: string | undefined;
  readonly releaseIndexFile: string | undefined;
}): InstallStep | null {
  const { scope, resolves } = probePlatform({ cwd: input.cwd, targetDir: input.targetDir });
  if (resolves) return null;
  const file = input.releaseIndexFile ?? ownReleaseIndexPath();
  const read = readReleaseIndex(file);
  if ('problem' in read) {
    throw new InstallHostError(
      `${scope}platform does not resolve from ${input.targetDir} or ${input.cwd}, and this ` +
        `build's release index — the packages it would install to read the module set from — ` +
        `could not be read: ${read.problem}. Nothing was written. Reinstall ` +
        `\`${scope}cli\`, or install the platform beside the target directory and run this ` +
        'command again.',
    );
  }
  const npmrc = hostNpmrc(input.registry, scope);
  const dir = mkdtempSync(join(tmpdir(), HOST_DIRECTORY_PREFIX));
  writeHost(dir, read.index, npmrc);
  // `--ignore-scripts`: the host is a place to read manifests from and is
  // deleted minutes later, so nothing in it needs building — and pnpm 10, which
  // runs no dependency's build script unasked, otherwise ends this step with an
  // "Ignored build scripts … run pnpm approve-builds" box about a directory the
  // operator will never see again.
  const argv = ['install', '--ignore-scripts'];
  return {
    id: 'host',
    command: `${input.runner.label} ${argv.join(' ')}`,
    purpose:
      `nothing of ours is installed beside ${input.targetDir}, so the ` +
      `${String(read.index.packages.length)} \`${scope}*\` packages of this release are ` +
      'installed into a temporary host to read the module manifests from. It is removed when ' +
      'the instance is written.',
    bin: input.runner.command,
    argv: [...input.runner.prefix, ...argv],
    cwd: dir,
  };
}

/**
 * The shared secret, into the instance's own `.env`.
 *
 * The storefront gets it as a resolved input — it declares the variable, so its
 * own resolution writes it. The instance's `.env` lists it as a placeholder
 * (the platform declares it `generable: false`, so `new instance` writes no
 * value), and this is where the second half of the pair is filled in.
 *
 * **Declared, not "has a placeholder".** A `.env` the operator placed before
 * the run is merged into and gets no placeholder, so reading the placeholders
 * alone left exactly that instance without the secret its storefront had been
 * given — every machine that pinned its API port first. The declaration is then
 * the `.env.example` rendered beside it, which is what `writeDeclared` reads.
 */
function writeSharedSecret(targetDir: string, secret: string): void {
  writeDeclared(targetDir, new Map([['REVALIDATE_SECRET', secret]]));
}

/** What stands where the administrator's password would be, in everything printed. */
export const PASSWORD_PLACEHOLDER = '<password>';

/**
 * The pipeline (FR-155).
 *
 * It is the printed next-steps sequence and nothing else, and it runs the
 * instance's **own root scripts** rather than their contents: `setup` is the
 * composite the block names, so a client reproducing this by hand types the
 * same four words. A step this list has that the block does not would make the
 * two paths two products.
 */
function plan(input: {
  /** The instance's directory, or `null` when this run writes none (138 FR-007). */
  readonly targetDir: string | null;
  readonly storefrontDir: string | null;
  readonly runner: PackageManagerRunner;
  /** Whether this run stands the API up: without it, nothing touches a service. */
  readonly api: boolean;
  /** Whether the admin bundle is the artefact this run builds on its own. */
  readonly buildAdmin: boolean;
  readonly services: boolean;
  readonly demo: boolean;
  readonly admin: {
    readonly email?: string | undefined;
    readonly password?: string | undefined;
    readonly firstName?: string | undefined;
    readonly lastName?: string | undefined;
  };
}): readonly InstallStep[] {
  const { runner } = input;
  const step = (
    id: InstallStep['id'],
    cwd: string,
    argv: readonly string[],
    purpose: string,
    optional = false,
    shown: readonly string[] = argv,
    stdin?: string,
  ): InstallStep => ({
    id,
    command: `${runner.label} ${shown.join(' ')}`.trim(),
    purpose,
    bin: runner.command,
    argv: [...runner.prefix, ...argv],
    cwd,
    ...(stdin === undefined ? {} : { stdin }),
    ...(optional ? { optional: true } : {}),
  });
  const steps: InstallStep[] = [];
  const storefrontInstall = (): void => {
    if (input.storefrontDir === null) return;
    steps.push(
      step(
        'storefront-install',
        input.storefrontDir,
        ['install'],
        'the storefront\'s own dependencies, in its own repository',
      ),
    );
  };
  // 138 FR-007 — the storefront alone: no instance, so no step of one.
  if (input.targetDir === null) {
    storefrontInstall();
    return steps;
  }
  steps.push(
    step(
      'install',
      input.targetDir,
      ['install'],
      'the platform, the admin shell and every module you declared, from the registry',
    ),
  );
  // 138 FR-006 — the admin without the API: one artefact, built from the
  // installed workspace. `build:admin` is the root script and nothing else
  // (contract §7 R7.4): it renders the screen registry from the packages the
  // step above installed and runs Vite, and opens no connection to anything.
  if (!input.api) {
    if (input.buildAdmin) {
      steps.push(
        step(
          'build-admin',
          input.targetDir,
          ['run', 'build:admin'],
          'the admin bundle, built against the API origin in admin/.env — no database, no service',
        ),
      );
    }
    storefrontInstall();
    return steps;
  }
  if (input.services) {
    steps.push(
      step(
        'services',
        input.targetDir,
        ['run', 'dev:services'],
        'PostgreSQL, Redis, Meilisearch and a mail catcher, waited for until each is healthy',
      ),
    );
  }
  steps.push(
    step(
      'setup',
      input.targetDir,
      ['run', 'setup'],
      'generate, build, migrate and install every module — the four steps, in order',
    ),
    step(
      'admin',
      input.targetDir,
      [
        'run',
        'admin:create',
        '--',
        `--email=${input.admin.email ?? ''}`,
        '--password-stdin',
        `--first-name=${input.admin.firstName ?? ''}`,
        `--last-name=${input.admin.lastName ?? ''}`,
      ],
      'the administrator you sign in as. Nothing else creates one',
      false,
      // What is **echoed** is the form a person types, with a placeholder where
      // the password is. The wizard reads it without echo, and the `[n/N]`
      // line, the dry run and the resumable list then printed it in clear —
      // into a terminal's scrollback and a CI log alike. A password given as a
      // flag is masked too: it was typed once, into a place its owner chose,
      // and a log is not that place.
      [
        'run',
        'admin:create',
        '--',
        `--email=${input.admin.email ?? ''}`,
        `--password=${PASSWORD_PLACEHOLDER}`,
        `--first-name=${input.admin.firstName ?? ''}`,
        `--last-name=${input.admin.lastName ?? ''}`,
      ],
      input.admin.password ?? '',
    ),
  );
  if (input.demo) {
    // FR-126 — after `module:install --all` and after the administrator, and
    // non-fatal. The reverse ordering would make an optional extra able to red
    // a mandatory outcome.
    steps.push(
      step(
        'demo',
        input.targetDir,
        ['run', 'cli', 'demo', 'seed'],
        "every installed module's example rows, withdrawable with `cli demo reset`",
        true,
      ),
    );
  }
  storefrontInstall();
  return steps;
}

/** What a client reads when it worked: where things are, and what is next. */
function closing(input: {
  readonly targetDir: string;
  readonly storefrontDir: string | null;
  /** What this run stood up (138 FR-020): the block is about this machine. */
  readonly selection: Selection;
  readonly instance: NewInstanceResult | null;
  readonly dryRun: boolean;
  readonly demo: boolean;
  readonly admin: { readonly email?: string | undefined; readonly password?: string | undefined };
  readonly recommended: readonly QuestionId[];
  readonly services: boolean;
  /** Whether the password was `--admin-password` or typed at the wizard's prompt. */
  readonly passwordFromFlag: boolean;
  /** The corepack runner this run fell back to, when no `pnpm` was on `PATH`. */
  readonly corepack: PackageManagerRunner | null;
  /** The port the instance's API listens on — its own `PORT`, never a constant. */
  readonly apiPort: string;
  /** Whether something on this machine already holds that port. */
  readonly apiPortBusy: boolean;
  /** Where a browser reaches each of the three, as this run was told or decided. */
  readonly apiOrigin: string;
  readonly adminOrigin: string;
  readonly storefrontOrigin: string;
  /** Where the admin and the storefront are served on this machine, when they are. */
  readonly adminPort: LayerPort | null;
  readonly storefrontPort: LayerPort | null;
  /** Whether this run wrote `REVALIDATE_SECRET` for a storefront on another machine. */
  readonly secretInInstance: boolean;
  /** Whether `--storefront-url` was given, so the API already knows where it is. */
  readonly storefrontToldToApi: boolean;
}): readonly string[] {
  const has = (component: Component): boolean => input.selection.components.includes(component);
  const api = has('api');
  const lines = ['', input.dryRun ? 'It would then be yours to start:' : 'Done. To start it:'];
  // Every command below has to run as printed. With `pnpm` on PATH that is
  // `pnpm`. Without it, this run reached the pinned pnpm through corepack and
  // only its own children had a shim, so the operator's shell has none — and
  // a precondition line ("install pnpm first") is skipped by exactly the reader
  // it is for: W5.5 against `0.100.1` (run 36868691058) ran the next command,
  // and `pnpm run dev:all` exited 127. So the commands carry the pinned pnpm
  // themselves, through `npx`, which every Node ships and which puts that
  // pnpm's `bin` on PATH for everything it starts — the instance's own scripts
  // call `pnpm -C backend run …`. Not `corepack pnpm@…`: that puts nothing on
  // PATH, so the first nested script fails the same way.
  const pnpm =
    input.corepack === null ? 'pnpm' : `npx --yes ${input.corepack.prefix[0] ?? 'pnpm'}`;
  if (input.corepack !== null) {
    lines.push(
      `  (\`pnpm\` is not on your PATH, so these run ${input.corepack.prefix[0] ?? 'pnpm'} through ` +
        '`npx`, which comes with Node.)',
    );
  }
  const adminHere = input.adminPort !== null;
  // A port this run moved is named on the line that starts the layer: the
  // address is the thing the operator opens next.
  const adminAt =
    input.adminPort !== null && (input.adminPort.moved || !api)
      ? `, on http://localhost:${String(input.adminPort.port)}`
      : '';
  const shopAt =
    input.storefrontPort !== null && (input.storefrontPort.moved || !api)
      ? `, on http://localhost:${String(input.storefrontPort.port)}`
      : '';
  if (api) {
    // One command first (`specs/136-open-source-publication/` GAP-7, FR-060):
    // the supervisor over the per-layer commands below, which stay printed for
    // the operator who wants a layer on its own. A storefront somewhere other
    // than the default sibling is named, since `dev:all` looks for the default.
    const defaultStorefront = `${input.targetDir}-storefront`;
    // No `--` before the flag: pnpm hands everything after the script's name
    // to the script, the separator included, and `endora dev -- --storefront-dir
    // <path>` reads the flag as an argument and refuses it. The form with the
    // separator was printed until the first run that typed it.
    const devAllArgs =
      input.storefrontDir !== null && input.storefrontDir !== defaultStorefront
        ? ` --storefront-dir ${input.storefrontDir}`
        : '';
    const rootManifest = input.instance?.plan.files.find((file) => file.path === 'package.json');
    const rootScripts =
      rootManifest === undefined
        ? {}
        : ((JSON.parse(rootManifest.content) as { scripts?: Record<string, unknown> }).scripts ?? {});
    // The supervisor is over the layers on **this** machine: where the API is
    // the only one (138), there is nothing for it to be one command over.
    const layersHere = 1 + (adminHere ? 1 : 0) + (input.storefrontDir === null ? 0 : 1);
    if (typeof rootScripts['dev:all'] === 'string' && (!input.selection.subset || layersHere > 1)) {
      lines.push(
        `  cd ${input.targetDir} && ${pnpm} run dev:all${devAllArgs}   # every layer, one terminal; Ctrl-C stops them`,
        '',
        'Or one layer at a time:',
      );
    }
    lines.push(
      `  cd ${input.targetDir} && ${pnpm} run start      # the API, on http://localhost:${input.apiPort}`,
    );
    if (adminHere) {
      lines.push(
        `  ${pnpm} run preview:admin                    # the admin bundle, in a second terminal${adminAt}`,
      );
    }
  } else if (adminHere) {
    lines.push(
      `  cd ${input.targetDir} && ${pnpm} run preview:admin   # the admin bundle${adminAt}`,
      '  (admin/dist is the whole artefact: any static web server can serve it, answering ' +
        'every path it does not hold with index.html)',
    );
  }
  if (input.storefrontDir !== null) {
    lines.push(
      `  cd ${input.storefrontDir} && ${pnpm} run build && ${pnpm} run start   # the shop${shopAt}`,
    );
  }
  // Only a run that started the development services has a mail catcher to
  // name. Under `--no-services` the compose file is still in the tree, and this
  // line used to promise a catcher nothing had started — on a machine where the
  // port it named could be somebody else's.
  const mail = input.services
    ? developmentMailUrl(
        existsSync(join(input.targetDir, DEV_COMPOSE_PATH))
          ? readFileSync(join(input.targetDir, DEV_COMPOSE_PATH), 'utf8')
          : (input.instance?.plan.files.find((file) => file.path === DEV_COMPOSE_PATH)?.content ?? ''),
        readTargetEnv(input.targetDir),
      )
    : undefined;
  if (mail !== undefined) {
    lines.push(`  mail this instance sends is caught at ${mail} and leaves your machine never`);
  }
  if (api && !input.services) {
    lines.push(
      '  no development services were started (`--no-services`): the instance uses the ' +
        'PostgreSQL, Redis and other services its `.env` names',
    );
  }
  if (input.apiPortBusy) {
    lines.push(
      `  port ${input.apiPort} is in use on this machine right now, so the API cannot start on ` +
        `it until that stops. To move the API instead, set PORT in ${join(input.targetDir, '.env')}` +
        (input.storefrontDir === null
          ? '.'
          : ` and the same port in the two backend addresses in ${join(input.storefrontDir, '.env')}.`) +
        // The bundle carries the API's address: a moved API is a line in the
        // admin's own `.env` and a rebuild, or the admin signs nobody in.
        (adminHere
          ? ` The admin bundle is built against the API's address, so set VITE_API_BASE_URL in ` +
            `${join(input.targetDir, 'admin', '.env')} to it as well and run \`${pnpm} run build:admin\` again.`
          : ''),
    );
  }
  if (api) {
    lines.push(
      '',
      `Sign in as ${input.admin.email ?? ''} with the password you ` +
        `${input.passwordFromFlag ? 'passed on the command line' : 'entered above'}.`,
      input.demo
        ? `Demo data ${input.dryRun ? 'would be' : 'was'} seeded. \`${pnpm} run cli demo reset\` withdraws it ` +
          'and leaves your own rows alone.'
        : `No demo data ${input.dryRun ? 'would be' : 'was'} seeded. \`${pnpm} run cli demo seed\` adds a ` +
          "shop's worth of it, and `demo reset` withdraws it again.",
    );
  }
  // D-270 — the module set is not a question and not an input, so it is not in
  // the `[answers]` or `[inputs]` line; it is a derived value, and the run says
  // what it derived and how to take any of it back. Off is non-destructive
  // (Constitution XVII), which is what makes "everything" the safe default.
  if (input.instance !== null && input.instance.modules.defaulted) {
    const count = input.instance.modules.ids.length;
    if (api) {
      lines.push(
        '',
        `${String(count)} module${count === 1 ? '' : 's'} ${input.dryRun ? 'would be' : 'were'} ` +
          'installed, because no `--module` was given: every module of the open-source set ' +
          'this run found, each switched on.',
        'Switch any of them off in the admin under Modules (/platform/modules). Off keeps its ' +
          'data, and switching it back on brings it back.',
      );
    } else {
      // No API here, so nothing was installed into a database and nothing is
      // "switched on": the tree declares the packages the bundle's screens come
      // from, and which of them are on is the API's to say.
      lines.push(
        '',
        `${String(count)} module package${count === 1 ? '' : 's'} ${input.dryRun ? 'would be' : 'were'} ` +
          'declared, because no `--module` was given: every module of the open-source set ' +
          'this run found. The bundle carries their screens; which of them are switched on ' +
          'is decided at the API it talks to.',
      );
    }
  }
  // 138 FR-020 — what crosses a machine boundary, said once and under one
  // heading. Each of the four is a fact nothing on this machine can check: the
  // other side of it is somewhere else.
  if (input.selection.subset) {
    const instanceEnv = join(input.targetDir, '.env');
    const elsewhere = COMPONENT_VOCABULARY.filter((component) => !has(component));
    lines.push(
      '',
      `What the other machines owe this one (${elsewhere.join(' and ')} ${
        elsewhere.length === 1 ? 'is' : 'are'
      } not here):`,
      api
        ? `  - CORS_ALLOWED_ORIGINS in ${instanceEnv} must contain the admin's and the ` +
            "storefront's origins, exactly as a browser sends them — scheme, host, port, no " +
            `trailing slash. This run ${input.dryRun ? 'would leave' : 'left'} it allowing ` +
            `${input.adminOrigin} and ${input.storefrontOrigin}.`
        : "  - the API's CORS_ALLOWED_ORIGINS must contain the admin's and the storefront's " +
            'origins, exactly as a browser sends them — scheme, host, port, no trailing slash.' +
            `${[
              ...(adminHere ? [` For this admin that is the address it is served at — ${input.adminOrigin} with the command above.`] : []),
              ...(input.storefrontDir === null ? [] : [` For this storefront that is ${input.storefrontOrigin}.`]),
            ].join('')}`,
      '  - the admin bundle and the storefront\'s browser values are bound to the API origin at ' +
        'build time (VITE_API_BASE_URL, NEXT_PUBLIC_API_BASE_URL), so a changed origin is a ' +
        `rebuild, not a restart.${api ? '' : ` This run was given ${input.apiOrigin}.`}`,
      '  - the three public origins must be same-site — one registrable domain, as in ' +
        'api.example.com, admin.example.com and shop.example.com — because both session ' +
        'cookies are host-only and SameSite=Lax. Nothing checks this for you.',
      adminHere
        ? '  - this admin shows the screens of the modules this tree installed, so this tree ' +
            'must declare the module set the API composes: the same release, and the same ' +
            '`--module` list if the API was given one.'
        : '  - an admin built on another machine shows the screens of the modules its own tree ' +
            'installed, so that tree must declare the module set the API composes: the same ' +
            'release, and the same `--module` list.',
    );
    if (input.secretInInstance) {
      lines.push(
        `  - REVALIDATE_SECRET is in ${instanceEnv}. The storefront's run must be given the same ` +
          'value (`--revalidate-secret`); it is not printed here.' +
          (input.storefrontToldToApi
            ? ''
            : " Set STOREFRONT_BASE_URL there to the storefront's origin too: it is where the " +
              'API sends a revalidation, and it stands at the development address.'),
      );
    }
    if (!api && input.storefrontDir !== null) {
      lines.push(
        `  - the API's STOREFRONT_BASE_URL must be ${input.storefrontOrigin}, and its ` +
          'REVALIDATE_SECRET the value this run was given: that pair is how it asks this ' +
          'storefront to refresh a cached page.',
      );
    }
  }
  // R2.5f (iv) — every answer taken as a recommendation, said to be one, with
  // what reverses it. A recommendation nobody is told they accepted is a
  // default with better manners.
  const reversals: Readonly<Record<QuestionId, string | null>> = {
    directory: `the directory ${input.targetDir} — pass another as \`endora install <dir>\``,
    parts:
      'every part this build can write — `--without <member>` and `--no-storefront` leave one ' +
      'out of the next install',
    'api-url': api
      ? `this API's public origin, left as its development address — \`--api-url\`, or ` +
        `PUBLIC_API_BASE_URL in ${join(input.targetDir, '.env')}`
      : null,
    'admin-url':
      `the admin's origin, left as ${input.adminOrigin} in the API's allow-list — ` +
      '`--admin-url`, or CORS_ALLOWED_ORIGINS in the same file',
    'storefront-url':
      `the storefront's origin, left as ${input.storefrontOrigin} — \`--storefront-url\`, or ` +
      'STOREFRONT_BASE_URL and CORS_ALLOWED_ORIGINS in the same file',
    'sales-channel':
      input.storefrontDir === null
        ? null
        : 'the sales channel `default` — `--sales-channel`, or NEXT_PUBLIC_SALES_CHANNEL_CODE in ' +
          join(input.storefrontDir, '.env'),
    'revalidate-secret': null,
    services: input.services
      ? `the development services, started — \`${pnpm} run dev:services:down\` stops them`
      : null,
    demo: null,
    'admin-email': null,
    'admin-password': null,
    'admin-name': null,
  };
  const taken = input.recommended
    .map((id) => reversals[id])
    .filter((line): line is string => line !== null);
  if (taken.length > 0) {
    lines.push('', 'Recommended, and taken because nothing said otherwise:');
    for (const line of taken) lines.push(`  ${line}`);
  }
  return lines;
}

/**
 * The environment the pipeline's children run in.
 *
 * With `pnpm` on `PATH`, this process's own. Reached through corepack, the
 * same plus a `pnpm` shim first on `PATH`, in a directory this run creates and
 * removes on exit: the instance's scripts chain `pnpm run …` (`setup` is four
 * of them), a script's shell finds `pnpm` on `PATH` or not at all, and
 * `corepack pnpm@x run setup` puts nothing there — measured as `sh: 1: pnpm:
 * not found` at `[3/5]` once the pinned fallback got that far. The shim runs
 * exactly the runner's pinned version. It is not `corepack enable`, which writes
 * shims into Node's own directory for every later shell (FR-158).
 */
export function pnpmShimEnvironment(
  runner: PackageManagerRunner,
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  if (runner.command !== 'corepack') return base;
  const spec = runner.prefix.join(' ');
  const dir = mkdtempSync(join(tmpdir(), 'endora-pnpm-'));
  writeFileSync(join(dir, 'pnpm'), `#!/bin/sh\nexec corepack ${spec} "$@"\n`, { mode: 0o755 });
  writeFileSync(join(dir, 'pnpm.cmd'), `@corepack ${spec} %*\r\n`);
  process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
  const key = Object.keys(base).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
  const path = base[key];
  return { ...base, [key]: path === undefined || path === '' ? dir : `${dir}${delimiter}${path}` };
}

/** The default runner for `runner`'s pipeline; the environment is made on first use. */
function spawnSteps(runner: PackageManagerRunner): StepRunner {
  let env: NodeJS.ProcessEnv | undefined;
  return (step) => {
    env ??= pnpmShimEnvironment(runner, process.env);
    return spawnStep(step, env);
  };
}

/** Spawn one step, inherit the descriptors, answer its code. */
function spawnStep(step: InstallStep, env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolveCode) => {
    const child = spawn(step.bin, [...step.argv], {
      cwd: step.cwd,
      stdio: step.stdin === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
      env,
    });
    if (step.stdin !== undefined && child.stdin !== null) {
      // A child that exits before reading it closes the pipe; that is the
      // step's own failure to report, not a second one from this write.
      child.stdin.on('error', () => undefined);
      child.stdin.end(`${step.stdin}\n`);
    }
    child.on('error', () => resolveCode(127));
    child.on('close', (code) => resolveCode(code ?? 1));
  });
}
