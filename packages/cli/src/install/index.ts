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
 * `--no-services`, a reference storefront unless `--no-storefront`, and every
 * answer the pipeline will need. They are reported in **one** refusal naming
 * all of them (FR-157), because a client who has to run a command five times to
 * learn five things has been handed a puzzle.
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
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

import { parseEnvFile, writeEnvFile } from '../inputs/env-file.js';
import {
  generateSecret,
  interactivityOf,
  mayPrompt,
  type InteractivityFacts,
} from '../inputs/resolve.js';
import {
  developmentAddresses,
  developmentMailUrl,
  DEV_COMPOSE_PATH,
} from '../new-instance/deploy.js';
import {
  MEMBER_VOCABULARY,
  memberRefusal,
  runNewInstance,
  type NewInstanceResult,
} from '../new-instance/index.js';
import {
  runNewStorefront,
  type NewStorefrontResult,
} from '../new-storefront/index.js';

import {
  answeredByFlags,
  answersLine,
  askWizard,
  WizardClosedError,
  type QuestionId,
  type WizardIo,
} from './wizard.js';

/** A refusal the operator can act on — exit 1. */
export class InstallInputError extends Error {
  override readonly name = 'InstallInputError';
}

/** An input this run could not read — exit 2. */
export class InstallHostError extends Error {
  override readonly name = 'InstallHostError';
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
  readonly id: 'install' | 'services' | 'setup' | 'admin' | 'demo' | 'storefront-install';
  /** The command as an operator would type it, echoed before it runs. */
  readonly command: string;
  /** What it is for, in one clause. */
  readonly purpose: string;
  /** The binary, as this machine offers it — `pnpm`, or `corepack`. */
  readonly bin: string;
  readonly argv: readonly string[];
  readonly cwd: string;
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
}

/** One way to run `pnpm` on this machine. */
export interface PackageManagerRunner {
  readonly command: string;
  readonly prefix: readonly string[];
  /** How it reads in the echo and in the resumable list. */
  readonly label: string;
}

export interface InstallResult {
  readonly targetDir: string;
  readonly storefrontDir: string | null;
  readonly instance: NewInstanceResult;
  readonly storefront: NewStorefrontResult | null;
  /** The pipeline, in order — the whole of it, whether or not it ran. */
  readonly steps: readonly InstallStep[];
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
 * How this machine runs `pnpm`, in the declared order (FR-158).
 *
 * `pnpm` on `PATH` first, then `corepack pnpm@<range>` — and **never**
 * `corepack enable`, which is baseline step A1 and a command that writes shims
 * into a directory this program does not own. `corepack pnpm@…` runs the
 * package manager without changing anything about the machine, which is the
 * property that lets this step be a fallback rather than an installation.
 */
function resolvePackageManagers(): readonly PackageManagerRunner[] {
  const found: PackageManagerRunner[] = [];
  if (probe('pnpm', ['--version'])) {
    found.push({ command: 'pnpm', prefix: [], label: 'pnpm' });
  }
  if (probe('corepack', ['--version'])) {
    found.push({ command: 'corepack', prefix: ['pnpm@latest'], label: 'corepack pnpm@latest' });
  }
  return found;
}

/** Is a Docker daemon there? `docker info` answers, `docker --version` does not. */
function dockerIsReachable(): boolean {
  return probe('docker', ['info', '--format', '{{.ServerVersion}}']);
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
 * Is there a reference storefront to copy, from where this command is standing?
 *
 * **The finding this function exists for**: `endora new storefront` copies the
 * reference storefront out of a **checkout of the platform repository**
 * (`new-storefront/reference.ts`: *"no pnpm-workspace.yaml above …"*), so an
 * installed CLI standing in an empty directory cannot write one however it is
 * asked. The spec's §7.6 assumes otherwise. The honest answer here is to refuse
 * **before** writing an instance, naming the flag that skips the storefront —
 * fail-closed, with a remedy the client can act on — rather than to write half
 * the trio and fail in the middle of the pipeline.
 */
function referenceStorefrontRoot(cwd: string): string | null {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
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
  const placeholders = new Set(
    [...text.matchAll(/^\s*#\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map((match) => match[1]!),
  );
  const addresses = [...developmentAddresses(readFileSync(composePath, 'utf8'))].filter(
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
    '# asked you — change a published port in that file and they are what it publishes.',
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
function storefrontInputs(
  instance: NewInstanceResult,
  secret: string,
): Record<string, string> {
  const port = '3001';
  return {
    NEXT_PUBLIC_API_BASE_URL: `http://localhost:${port}`,
    BACKEND_BASE_URL: `http://localhost:${port}`,
    NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
    // The platform's own fallback, which is what the instance's default Sales
    // Channel is created with when `DEFAULT_SALES_CHANNEL_CODE` is unset
    // (`kernel/sales-channels/default-channel-reconciler.ts`). A different
    // string here would point the storefront at a channel nothing creates.
    NEXT_PUBLIC_SALES_CHANNEL_CODE: 'default',
    REVALIDATE_SECRET: secret,
    ...Object.fromEntries(
      instance.resolved
        .filter((entry) => entry.name === 'DEFAULT_SALES_CHANNEL_CODE')
        .map((entry) => ['NEXT_PUBLIC_SALES_CHANNEL_CODE', entry.value] as const),
    ),
  };
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
  let provenance: {
    readonly fromFlags: ReadonlyMap<QuestionId, string>;
    readonly prompted: readonly QuestionId[];
    readonly recommended: readonly QuestionId[];
  };
  if (interactive) {
    try {
      const outcome = await askWizard(
        given,
        given.io ?? { input: process.stdin, output: process.stdout, terminal: true },
        {
          vocabulary: MEMBER_VOCABULARY,
          storefront: {
            available: referenceStorefrontRoot(cwd) !== null,
            reason:
              'not from here: it is copied out of a checkout of the platform repository, ' +
              'and there is none above this directory — `endora new storefront` adds it later',
          },
        },
      );
      options = { ...given, ...outcome.answers };
      provenance = outcome;
    } catch (error: unknown) {
      if (error instanceof WizardClosedError) throw new InstallInputError(error.message);
      throw error;
    }
  } else {
    // Nothing asked: every answer is a flag, and the two offered questions a
    // flag did not answer take §6.2's recommendation — *everything*, *yes* —
    // which is what Phase 3 already did and is now said out loud.
    const fromFlags = answeredByFlags(given);
    provenance = {
      fromFlags,
      prompted: [],
      recommended: (['parts', 'services'] as const).filter((id) => !fromFlags.has(id)),
    };
  }

  // ── decide ────────────────────────────────────────────────────────────────
  const refusals = new Refusals();
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
  const wantsStorefront = options.storefront !== false;
  const wantsServices = options.services !== false;
  const namedStorefrontDir =
    !wantsStorefront || namedDir === null
      ? null
      : options.storefrontDir === undefined
        ? `${namedDir}-storefront`
        : isAbsolute(options.storefrontDir)
          ? options.storefrontDir
          : resolve(cwd, options.storefrontDir);

  const declinedRefusal = memberRefusal(options.without ?? []);
  if (declinedRefusal !== null) refusals.add(declinedRefusal);

  const inTheWay = namedDir === null ? null : occupied(namedDir);
  if (inTheWay !== null) {
    refusals.add(
      `${namedDir!} exists and is not empty (${inTheWay}). An instance's files are yours; ` +
        'this command never merges into a directory. Scaffold into an empty one — a ' +
        'directory holding nothing but a `.env` is the exception, and that file is read as ' +
        'your own answers.',
    );
  }

  // FR-160 — a sibling, never a child. A storefront inside the instance would
  // be swept into its `pnpm-workspace.yaml` globs and become a member of a
  // workspace it is not part of, which is D-230's topology broken by a
  // directory choice.
  if (namedStorefrontDir !== null && namedStorefrontDir.startsWith(namedDir! + sep)) {
    refusals.add(
      `--storefront-dir ${namedStorefrontDir} is inside ${namedDir!}. The storefront is its own ` +
        "repository (D-195): written there it would be swept into the instance's workspace " +
        'globs and become a member of a workspace it is not part of. Put it beside the ' +
        'instance — the default is `<dir>-storefront`.',
    );
  }
  if (namedStorefrontDir !== null) {
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
        'runs `corepack pnpm@latest` when it has to, and never `corepack enable`, which ' +
        'writes shims into a directory it does not own.',
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

  if (wantsStorefront && referenceStorefrontRoot(cwd) === null) {
    refusals.add(
      '`endora new storefront` copies the reference storefront out of a checkout of the ' +
        `platform repository, and there is none above ${cwd}. Run this from inside a ` +
        'checkout to get both trees, or pass `--no-storefront` to write the instance alone ' +
        '— the storefront can be added later with `endora new storefront <dir>`.',
    );
  }

  const admin = {
    email: options.adminEmail,
    password: options.adminPassword,
    firstName: options.adminFirstName,
    lastName: options.adminLastName,
  };
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

  refusals.throwIfAny();
  // Both are decided: a missing directory was a refusal above.
  const targetDir = namedDir!;
  const storefrontDir = namedStorefrontDir;
  const runner = runners[0]!;
  const dryRun = options.dryRun === true;

  // ── write ─────────────────────────────────────────────────────────────────
  say(`endora install ${targetDir}${dryRun ? ' — dry run, nothing written' : ''}`);
  const answers = answersLine(provenance);
  say(`  ${answers}`);
  const without = (options.without ?? []).filter((name) => name.trim().length > 0);
  const instance = await runNewInstance({
    dir: targetDir,
    ...(options.modules === undefined ? {} : { modules: options.modules }),
    // R6.3b — nothing at all when every member is wanted, so the common case
    // is the argv a bare `endora new instance <dir>` has.
    ...(without.length === 0 ? {} : { without }),
    ...(options.deployment === undefined ? {} : { deployment: options.deployment }),
    ...(options.registry === undefined ? {} : { registry: options.registry }),
    ...(options.topology === undefined ? {} : { topology: options.topology }),
    dryRun,
    cwd,
  });
  say(
    `  ${dryRun ? 'would write' : 'wrote'} ${String(instance.plan.files.length)} files across ` +
      `${instance.plan.members.join(', ')} — ${instance.modules.ids.length} module(s)`,
  );
  say(`  ${instance.provenance}`);

  // FR-153 — generated **once**, for two trees. See `revalidateSecret` above.
  const secret = options.revalidateSecret ?? (dryRun ? '<generated on a real run>' : generateSecret());
  let storefront: NewStorefrontResult | null = null;
  if (storefrontDir !== null) {
    storefront = await runNewStorefront({
      dir: storefrontDir,
      cwd,
      dryRun,
      nonInteractive: true,
      inputs: storefrontInputs(instance, secret),
    });
    say(
      `  ${dryRun ? 'would write' : 'wrote'} the storefront at ${storefrontDir} — ` +
        `${String(storefront.plan.files.length)} files`,
    );
    say(`  ${storefront.provenance}`);
  }

  const derived = dryRun || !wantsServices ? [] : deriveEnvironment(targetDir);
  if (derived.length > 0) {
    say(
      `  derived from ${DEV_COMPOSE_PATH} into .env: ${derived.join(', ')} — the addresses of ` +
        'the containers the next step starts, on this machine',
    );
  }
  if (!dryRun && storefrontDir !== null && options.revalidateSecret === undefined) {
    writeSharedSecret(targetDir, secret);
    say(
      '  generated REVALIDATE_SECRET once and wrote it into both trees — the one value no ' +
        'sequence of `endora new instance` and `endora new storefront` can agree on',
    );
  }

  // ── run ───────────────────────────────────────────────────────────────────
  const steps = plan({
    targetDir,
    storefrontDir,
    runner,
    services: wantsServices,
    demo: options.demo === true,
    admin,
  });
  const run = options.run ?? spawnStep;
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
            `Retry with \`${step.command}\`, and \`pnpm run cli demo reset\` withdraws it again.`,
        );
        continue;
      }
      exitCode = code;
      say(`\n${step.command} failed (exit ${String(code)}). Remaining steps, in order:`);
      for (const left of steps.slice(done.length)) say(`  ${left.command}   # ${left.purpose}`);
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
      admin,
      instance,
      dryRun,
      demo: options.demo === true,
      recommended: provenance.recommended,
      services: wantsServices,
    })) {
      say(line);
    }
  }

  return {
    targetDir,
    storefrontDir,
    instance,
    storefront,
    steps,
    output,
    exitCode,
    derived,
    answers,
    dryRun,
  };
}

/**
 * The shared secret, into the instance's own `.env`.
 *
 * The storefront gets it as a resolved input — it declares the variable, so its
 * own resolution writes it. The instance's `.env` lists it as a placeholder
 * (the platform declares it `generable: false`, so `new instance` writes no
 * value), and this is where the second half of the pair is filled in.
 */
function writeSharedSecret(targetDir: string, secret: string): void {
  const envPath = join(targetDir, '.env');
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  if (!/^\s*#?\s*REVALIDATE_SECRET\s*=/m.test(text)) return;
  if (parseEnvFile(text).has('REVALIDATE_SECRET')) return;
  writeFileSync(
    envPath,
    writeEnvFile(text, new Map([['REVALIDATE_SECRET', secret]])),
    'utf8',
  );
}

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
  readonly targetDir: string;
  readonly storefrontDir: string | null;
  readonly runner: PackageManagerRunner;
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
  ): InstallStep => ({
    id,
    command: `${runner.label} ${argv.join(' ')}`.trim(),
    purpose,
    bin: runner.command,
    argv: [...runner.prefix, ...argv],
    cwd,
    ...(optional ? { optional: true } : {}),
  });
  const steps: InstallStep[] = [
    step(
      'install',
      input.targetDir,
      ['install'],
      'the platform, the admin shell and every module you declared, from the registry',
    ),
  ];
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
        `--password=${input.admin.password ?? ''}`,
        `--first-name=${input.admin.firstName ?? ''}`,
        `--last-name=${input.admin.lastName ?? ''}`,
      ],
      'the administrator you sign in as. Nothing else creates one',
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
  if (input.storefrontDir !== null) {
    steps.push(
      step(
        'storefront-install',
        input.storefrontDir,
        ['install'],
        'the storefront\'s own dependencies, in its own repository',
      ),
    );
  }
  return steps;
}

/** What a client reads when it worked: where things are, and what is next. */
function closing(input: {
  readonly targetDir: string;
  readonly storefrontDir: string | null;
  readonly instance: NewInstanceResult;
  readonly dryRun: boolean;
  readonly demo: boolean;
  readonly admin: { readonly email?: string | undefined; readonly password?: string | undefined };
  readonly recommended: readonly QuestionId[];
  readonly services: boolean;
}): readonly string[] {
  const lines = ['', input.dryRun ? 'It would then be yours to start:' : 'Done. To start it:'];
  lines.push(`  cd ${input.targetDir} && pnpm run start      # the API, on http://localhost:3001`);
  if (input.instance.plan.members.includes('admin')) {
    lines.push('  pnpm run preview:admin                    # the admin bundle, in a second terminal');
  }
  if (input.storefrontDir !== null) {
    lines.push(
      `  cd ${input.storefrontDir} && pnpm run build && pnpm run start   # the shop`,
    );
  }
  const mail = developmentMailUrl(
    existsSync(join(input.targetDir, DEV_COMPOSE_PATH))
      ? readFileSync(join(input.targetDir, DEV_COMPOSE_PATH), 'utf8')
      : '',
  );
  if (mail !== undefined) {
    lines.push(`  mail this instance sends is caught at ${mail} and leaves your machine never`);
  }
  lines.push(
    '',
    `Sign in as ${input.admin.email ?? ''} with the password you passed on the command line.`,
    input.demo
      ? `Demo data ${input.dryRun ? 'would be' : 'was'} seeded. \`pnpm run cli demo reset\` withdraws it ` +
        'and leaves your own rows alone.'
      : `No demo data ${input.dryRun ? 'would be' : 'was'} seeded. \`pnpm run cli demo seed\` adds a ` +
        "shop's worth of it, and `demo reset` withdraws it again.",
  );
  // R2.5f (iv) — every answer taken as a recommendation, said to be one, with
  // what reverses it. A recommendation nobody is told they accepted is a
  // default with better manners.
  const reversals: Readonly<Record<QuestionId, string | null>> = {
    directory: `the directory ${input.targetDir} — pass another as \`endora install <dir>\``,
    parts:
      'every part this build can write — `--without <member>` and `--no-storefront` leave one ' +
      'out of the next install',
    services: input.services
      ? 'the development services, started — `pnpm run dev:services:down` stops them'
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

/** The default runner: spawn it, inherit the descriptors, answer its code. */
function spawnStep(step: InstallStep): Promise<number> {
  return new Promise((resolveCode) => {
    const child = spawn(step.bin, [...step.argv], {
      cwd: step.cwd,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', () => resolveCode(127));
    child.on('close', (code) => resolveCode(code ?? 1));
  });
}
