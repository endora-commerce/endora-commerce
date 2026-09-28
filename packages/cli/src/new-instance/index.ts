/**
 * `endora new instance <dir>` — the command.
 *
 * It writes a repository that **composes** this platform for one deployment:
 * one workspace, one module list, and a copy of nothing
 * (`contracts/instance-repository.md` §5, `contracts/instance-tree.md`).
 *
 * ## The order is `new storefront`'s, and so is the discipline
 *
 * **Validate completely, then write** (R5.2). Every refusal — the target
 * directory, the deployment name, the registry, the CLI's own version, the
 * packages, the module set and its closure — is decided before the first
 * `mkdirSync`, because *"a half-written instance installs against ranges
 * nothing resolves and its next command is a manual clean-up"*. There is one
 * `for (const file of plan.files)` loop in this file and it is the last thing
 * that happens.
 *
 * ## What is different from `new storefront`, and it is one thing
 *
 * That command **copies** a reference tree and rewrites every declaration in it
 * that names something above the storefront's own directory. This one copies
 * nothing (D-207), so there is no rewriter beside it and R5.5's *"no outward
 * reference"* is a property of the template rather than a step in the command.
 * A rewriting step appearing here would be evidence that something was copied
 * that should not have been (NFR-002).
 *
 * ## Exit codes
 *
 * `cli-surface.md` §2, unchanged and shared with every other command: **0** it
 * did what it was asked, **1** a refusal the operator can act on, **2** an input
 * it could not read. `instance-tree.md` §4's table maps the eight classes onto
 * those, and F5–F8 are `2` rather than `1` for the estate's own reason — a run
 * that could not read its input has said nothing, and a scaffold written from
 * values it could not read is worse than no scaffold.
 *
 * ## It never prompts, and that is why it can never hang
 *
 * `cli-product.md` R2.5c. Every input this command needs is a flag or the
 * positional; the values a *running* instance needs are the client's and are
 * listed in the `.env.example` it writes, which is the tier-2 file the four-tier
 * resolution reads on the next command rather than a value this one invents. So
 * the provenance line R2.5a requires is printed on every run and its
 * `defaulted=` is `0` by arithmetic, over a resolution with nothing in it.
 * `packages/cli/test/new-instance-command.test.ts` proves the guarantee the only
 * way it can be proved — by spawning, with pipes on both descriptors.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import type { EnvironmentInput } from '@endora-commerce/contracts';

import { parseEnvFile } from '../inputs/env-file.js';
import {
  generateSecret,
  interactivityOf,
  planResolution,
  provenanceLine,
  type ResolvedInput,
} from '../inputs/resolve.js';
import { npmrcContent, normalizeRegistry } from '../new-storefront/npmrc.js';
import {
  assertTopology,
  DEFAULT_TOPOLOGY,
  developmentAddresses,
  developmentMailUrl,
  DEV_COMPOSE_PATH,
  type Topology,
} from './deploy.js';
import { DOCS_TOOLCHAIN } from './docs-toolchain.js';
import {
  ADMIN_KIT_PACKAGE,
  ADMIN_SHELL_PACKAGE,
  InstanceHostError,
  InstanceInputError,
  resolveInstanceHost,
  type InstanceHost,
  type ResolvedPackage,
} from './host.js';
import {
  instanceEnvironmentInputs,
  loadModuleCandidates,
  resolveModuleSet,
  type ModuleSetResolution,
} from './modules.js';
import {
  assertDeploymentName,
  assertWorkspaceName,
  memberRefusal,
  planInstance,
  wiringLineCount,
  type InstancePlan,
} from './template.js';

export interface NewInstanceOptions {
  /** Where to write. Required: this command has no default target (R5.1). */
  readonly dir?: string | undefined;
  /** Module ids, repeatable and comma-splittable — `new module`'s grammar (§3.1). */
  readonly modules?: readonly string[] | undefined;
  /** The deployment directory's name. Defaults to the workspace name (§2.2). */
  readonly deployment?: string | undefined;
  /** The endpoint the instance installs from. Absent writes no `.npmrc` (R5.7). */
  readonly registry?: string | undefined;
  /**
   * Which machine layout the `deploy/` examples describe (D-230).
   *
   * A string rather than the union, because it arrives from argv: the refusal
   * that turns it into one names the vocabulary, and a caller handing an
   * already-narrowed value would be the type system asserting what only the
   * operator's input can decide. Absent is `single-host`.
   */
  readonly topology?: string | undefined;
  /**
   * The members not to write — `--without <member>`, repeatable
   * (`specs/118-instance-member-selection/contracts/instance-members.md` R3.5,
   * ruled by D-215). Subtractive, so absent is *every member*; validated
   * against the template's own vocabulary before anything is resolved.
   */
  readonly without?: readonly string[] | undefined;
  /** Report every file it would write, and write nothing (R5.3). */
  readonly dryRun?: boolean | undefined;
  readonly cwd?: string | undefined;
  /** Injected so a test drives the manifest lookup without a fixture install. */
  readonly moduleUrl?: string | undefined;
}

export interface NewInstanceResult {
  readonly targetDir: string;
  readonly host: InstanceHost;
  readonly plan: InstancePlan;
  readonly modules: ModuleSetResolution;
  readonly deployment: string;
  readonly topology: Topology;
  readonly dryRun: boolean;
  /** R1.4's bound, measured on the plan this run built. */
  readonly wiringLines: number;
  /** R2.5a's one line. `defaulted=` is `0` by arithmetic, over the four tiers. */
  readonly provenance: string;
  /**
   * The values this run resolved: what the target's own `.env` already supplied
   * and what it generated. Exported so a proof reads the partition rather than
   * the line's text.
   */
  readonly resolved: readonly ResolvedInput[];
  /**
   * What a **dry** run would have generated, by name. Empty on a real run,
   * where {@link resolved} carries them with their provenance instead — a dry
   * run generates nothing, so a name here is a prediction and never a value.
   */
  readonly wouldGenerate: readonly string[];
  readonly nextSteps: readonly string[];
}

/**
 * The target must be empty — or hold nothing but a `.env`.
 *
 * F1. The exception is `new storefront`'s and is the operator's own second
 * input tier (`input-resolution.md` R1.2): a `.env` the client placed there
 * before running is an **input**, and a command whose only acceptable target
 * holds no file at all would leave that tier unreachable.
 *
 * Completion — a re-run that writes an absent member and touches nothing else —
 * is `specs/118-instance-member-selection/` §3.4's R3.6 and narrows this
 * refusal. It is not implemented here, so a non-empty directory is refused
 * whether or not it holds an instance, which is the fail-closed direction: a
 * command that guessed at completion would merge into files it does not own.
 */
function refuseOccupiedDirectory(targetDir: string): void {
  if (!existsSync(targetDir)) return;
  const entries = readdirSync(targetDir);
  if (entries.length === 0) return;
  if (entries.length === 1 && entries[0] === '.env') return;
  throw new InstanceInputError(
    'F1',
    `${targetDir} exists and is not empty (${entries.slice(0, 5).join(', ')}). This command ` +
      `never merges into a directory: an instance's files are yours — the deployment ` +
      `declaration, the entry points, the manifest that is the module list — and writing over ` +
      `them would silently discard whatever you had put there. Scaffold into an empty ` +
      `directory. A directory holding nothing but a \`.env\` is the one exception: that file ` +
      `is where you may place values this command and the next would otherwise ask you for.`,
  );
}

export async function runNewInstance(
  options: NewInstanceOptions,
): Promise<NewInstanceResult> {
  const cwd = options.cwd ?? process.cwd();
  if (options.dir === undefined || options.dir.trim().length === 0) {
    // R5.1 — no default target. A default would either overwrite something or
    // invent a name nobody chose, and the name is the workspace's own.
    throw new InstanceInputError(
      'F1',
      `\`new instance\` takes the directory to write, and has no default. The directory's ` +
        `basename becomes the workspace name, so a default would invent a name nobody chose.`,
    );
  }
  const targetDir = isAbsolute(options.dir) ? options.dir : resolve(cwd, options.dir);

  // --- validate, in the order the operator can act on -----------------------
  refuseOccupiedDirectory(targetDir);
  const name = basename(targetDir);
  assertWorkspaceName(name);
  const deployment = options.deployment ?? name;
  assertDeploymentName(deployment);
  // F3 — an operator-fixable refusal, decided with the rest of them and before
  // anything is written (R5.2). `single-host` is the default on the owner's own
  // *"the most common scenario is probably all three layers on one machine"*.
  const topology =
    options.topology === undefined ? DEFAULT_TOPOLOGY : assertTopology(options.topology);
  // F10 / F11 — the member vocabulary, decided with the rest and before any
  // package is resolved: a name outside it, or the one member that composes the
  // platform, is the operator's to change (`instance-members.md` §5.6).
  const without = new Set(
    (options.without ?? []).map((name) => name.trim()).filter((name) => name.length > 0),
  );
  const declinedRefusal = memberRefusal([...without]);
  if (declinedRefusal !== null) {
    throw new InstanceInputError(without.has('backend') ? 'F11' : 'F10', declinedRefusal);
  }

  // F5 — `--registry` is not a URL, or the configuration cannot be read. The
  // writer is `new-storefront/npmrc.ts` verbatim (R5.7); what changes is the
  // class its refusal is reported under, because `instance-tree.md` §4 puts a
  // registry this run could not read among the inputs it could not read.
  let registry: string | null = null;
  let npmrc: string | null = null;
  if (options.registry !== undefined) {
    try {
      registry = normalizeRegistry(options.registry);
    } catch (error: unknown) {
      throw new InstanceHostError(
        'F5',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const host = resolveInstanceHost({
    cwd,
    targetDir,
    ...(options.moduleUrl === undefined ? {} : { moduleUrl: options.moduleUrl }),
  });
  const platform = host.packages.get(`${host.scope}platform`)!;
  const { candidates, platformEnv } = await loadModuleCandidates(host.packages, platform);
  const modules = resolveModuleSet(options.modules ?? [], candidates);

  if (registry !== null) {
    try {
      npmrc = npmrcContent(registry, [host.scope.slice(0, -1)]);
    } catch (error: unknown) {
      throw new InstanceHostError(
        'F5',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const declaredRanges = new Map<string, string>();
  for (const field of ['peerDependencies', 'dependencies'] as const) {
    const block = platform.manifest[field];
    if (block === null || typeof block !== 'object') continue;
    for (const [dependency, range] of Object.entries(block as Record<string, unknown>)) {
      if (typeof range === 'string' && !declaredRanges.has(dependency)) {
        declaredRanges.set(dependency, range);
      }
    }
  }
  // R2.3's first named source, for the one range no platform manifest carries.
  const typescriptRange = typescriptRangeOf(host);
  if (typescriptRange !== undefined) declaredRanges.set('typescript', typescriptRange);

  const adminShell = host.packages.get(`${host.scope}${ADMIN_SHELL_PACKAGE}`);
  const adminKit = host.packages.get(`${host.scope}${ADMIN_KIT_PACKAGE}`);

  // What this instance reads from its environment (FR-010): the platform's own
  // declaration and the manifest of every module this run installed. Both come
  // off the packages resolved beside the target directory, which is R2.3 — the
  // declaration is the **installed** platform's and the **installed** modules',
  // not this CLI's idea of them.
  const declared = instanceEnvironmentInputs(
    platformEnv,
    modules.ids.map((id) => candidates.get(id)!),
  );

  // Tier 2 — the `.env` of the **target directory**, never of the working
  // directory and never of an ancestor (R1.2). A command run inside a checkout
  // of ours must not silently inherit that checkout's development
  // configuration, which is how a client's first instance would come to carry
  // `postgresql://b2b:b2b@localhost:5432/b2b`.
  const envPath = join(targetDir, '.env');
  const existingEnv = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';

  // R2.5b's four tiers, through the one module every command resolves with
  // (R5.3) — and this command uses **three** of them. Tier 1 is empty: it takes
  // no flag for a runtime value. Tier 3, the prompt, is refused structurally by
  // `nonInteractive`, so the partition is the same whether or not a terminal is
  // attached and this command still cannot hang (R2.5c). Tier 4, the refusal, is
  // not this command's either: an unanswered required input is **what
  // `.env.example` is for**, and a scaffolder that refused to write a tree until
  // its client had a database would be refusing the only artefact that tells
  // them which values they owe. So `missing` and `unset` are read here as the
  // file's population rather than as a reason to stop, and `toGenerate` is the
  // one tier that acts.
  const resolution = planResolution({
    declared,
    // A declined admin is a member not written, and an input only it reads is
    // out of the population exactly as it is for an unavailable one (118 §6).
    members:
      adminShell !== undefined && adminKit !== undefined && !without.has('admin')
        ? ['backend', 'admin']
        : ['backend'],
    flags: {},
    envFile: parseEnvFile(existingEnv),
    interactivity: { ...interactivityOf({ nonInteractive: true, dryRun: options.dryRun === true }), nonInteractive: true },
    language: 'en',
  });
  // R2.5d — the one class of value this tool may invent, and it invents it
  // **once**: the plan is pure, so a `randomBytes` call inside it would render a
  // different tree on every evaluation and `--dry-run` would stop describing the
  // run it previews. A dry run generates nothing at all and says so.
  const generated: readonly ResolvedInput[] =
    options.dryRun === true
      ? []
      : resolution.toGenerate.map((input) => ({
          name: input.name,
          value: generateSecret(),
          provenance: 'generated' as const,
        }));

  const plan = planInstance({
    name,
    deployment,
    scope: host.scope,
    platformVersion: host.platformVersion,
    enginesNode: host.enginesNode,
    packageManager: host.packageManager,
    // A module the host carries is in the set and contributes no dependency
    // entry: an instance naming it would be asking a registry for a package
    // nobody publishes (`modules.ts`' `carriedByHost`).
    //
    // The **version** comes with the name, off the candidate, which read it from
    // the manifest of the package this run resolved beside the target directory
    // — the same manifest, on the same install, that the platform will later
    // discover and compose (`host.ts`' `readPackage`). It is not the platform's
    // and it is not this CLI's: a release moves packages at different rates, and
    // a range built from another package's version is one no registry can
    // satisfy.
    modules: modules.ids
      .filter((id) => !candidates.get(id)!.carriedByHost)
      .map((id) => ({
        id,
        packageName: candidates.get(id)!.packageName,
        version: candidates.get(id)!.version,
      })),
    adminShellVersion: adminShell?.version ?? null,
    adminKitVersion: adminKit?.version ?? null,
    adminRanges: adminRangesOf(adminShell),
    adminPeers: composedOptionalPeers(host, [
      ...(adminShell === undefined ? [] : [adminShell]),
      ...(adminKit === undefined ? [] : [adminKit]),
      ...modules.ids
        .map((id) => host.packages.get(candidates.get(id)!.packageName))
        .filter((pkg): pkg is ResolvedPackage => pkg !== undefined),
    ]),
    cliVersion: host.cliVersion,
    docsRanges: new Map(DOCS_TOOLCHAIN.map((entry) => [entry.name, entry.range] as const)),
    declaredRanges,
    registry,
    npmrc,
    topology,
    without,
    declared,
    existingEnv,
    generated: new Map(generated.map((entry) => [entry.name, entry.value] as const)),
  });

  // R2.5a — the provenance line, printed on every run including a dry one. The
  // set is what the target's own `.env` already answered plus what this run
  // generated, and `defaulted=` is `0` by the same subtraction that makes it
  // unfakeable anywhere else. It is printed rather than skipped: a run that said
  // nothing about its inputs is indistinguishable from one that invented them.
  const resolved: readonly ResolvedInput[] = [...resolution.resolved, ...generated];

  const result: NewInstanceResult = {
    targetDir,
    host,
    plan,
    modules,
    deployment,
    topology,
    dryRun: options.dryRun === true,
    wiringLines: wiringLineCount(plan),
    provenance: provenanceLine(resolved),
    resolved,
    wouldGenerate:
      options.dryRun === true ? resolution.toGenerate.map((input) => input.name) : [],
    nextSteps: nextSteps(targetDir, deployment, topology, modules.ids, {
      admin: plan.members.includes('admin'),
      // Read off the document **this plan holds**, never re-derived: the two
      // cannot then disagree about a port, and a step naming an address the
      // client's own file does not publish is worse than no step.
      environment: developmentEnvironment(plan, declared),
      mailUrl: developmentMailUrl(developmentDocument(plan)),
    }),
  };
  if (result.dryRun) return result;

  // --- write. Everything above has already decided (R5.2) -------------------
  for (const file of plan.files) {
    const target = join(targetDir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, 'utf8');
  }
  return result;
}

/**
 * The packages an admin project has to supply because the packages it composes
 * declare them **optional** (§2.4; FR-022 read from the consumer's side).
 *
 * `manifests:generate` marks a module package's peer optional *"when every
 * non-test reach into it came from a UI layer"* — the whole point being that a
 * backend-only consumer can decline to resolve React, a router and a charting
 * library. That declaration says something exact about the other consumer:
 * **an admin project composes those UI layers, so for an admin project the
 * optional peers are not optional at all.** They are precisely the set a host
 * that renders these packages must have, and nothing else in either tree says
 * what it is.
 *
 * It is derived rather than listed because a list is wrong the moment a module
 * grows a screen. Measured before it existed, on the acceptance criterion's own
 * run: `@endora-commerce/page-builder-core` resolved, its
 * `@measured/puck` peer did not — pnpm does not auto-install an optional peer —
 * and Vite bound the import to an `__vite-optional-peer-dep:` stub, so the
 * scaffolded admin failed to bundle on a package the client had installed.
 *
 * The walk starts at the packages the admin mounts and follows their
 * `@endora-commerce/*` peers, because a module's screens render the page-builder
 * family's components and those declare optional peers of their own. A peer this
 * run did not resolve contributes nothing: its optional peers are unknown, and
 * inventing them is what R2.5a forbids.
 */
function composedOptionalPeers(
  host: InstanceHost,
  roots: readonly ResolvedPackage[],
): ReadonlyMap<string, string> {
  const collected = new Map<string, string>();
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const pkg = queue.shift()!;
    if (seen.has(pkg.name)) continue;
    seen.add(pkg.name);
    const peers = pkg.manifest['peerDependencies'];
    if (peers === null || typeof peers !== 'object') continue;
    const meta = pkg.manifest['peerDependenciesMeta'];
    const optional = (name: string): boolean =>
      meta !== null &&
      typeof meta === 'object' &&
      (meta as Record<string, unknown>)[name] !== null &&
      typeof (meta as Record<string, unknown>)[name] === 'object' &&
      ((meta as Record<string, { optional?: unknown }>)[name]!.optional === true);
    for (const [name, range] of Object.entries(peers as Record<string, unknown>)) {
      const resolved = host.packages.get(name);
      // Follow every scope peer, optional or not: an optional peer of a package
      // this admin composes is this admin's to supply, and the package that
      // declares it may itself be reached only as somebody else's peer.
      if (resolved !== undefined) queue.push(resolved);
      if (!optional(name)) continue;
      if (collected.has(name)) continue;
      // A **module** package is never declared here, whoever peers on it: the
      // module set is the root manifest's and appears exactly once in the
      // written tree (R3.6), and pnpm links a root dependency into the root's
      // `node_modules`, which is where this member's resolution reaches it. A
      // module that peers on a module the client did not install is a module
      // set that is short, and Vite says so loudly — which is the right answer,
      // and is not one this member's manifest may quietly paper over.
      if (resolved?.endora?.type === 'module') continue;
      if (resolved !== undefined) {
        // A `workspace:` range is what a packed sibling carries here and is
        // unresolvable outside a workspace; the version it resolved at is the
        // fact this run actually has (R2.5a).
        collected.set(name, `^${resolved.version}`);
        continue;
      }
      if (typeof range === 'string' && range.length > 0 && !range.startsWith('workspace:')) {
        collected.set(name, range);
      }
    }
  }
  return collected;
}

/**
 * What the admin shell says a host that mounts it must resolve (§2.4, R2.5a).
 *
 * Its `peerDependencies`, which is the declaration whose whole meaning is *"the
 * consumer supplies this"* — React and the router — plus the optional peers by
 * which it states what kind of application a host is: a Vite build with
 * Tailwind v4. Read off the shell's own manifest and off nothing else, so a
 * shell that widens `react` widens this in the same run with nothing here to
 * edit, and a name it stops declaring becomes an omission naming that name
 * rather than a range this command chose.
 *
 * A `workspace:` range is filtered out by the reader rather than here: it is
 * unresolvable outside this repository's own workspace, and an instance's
 * manifest carrying one would be a scaffold that cannot install.
 */
function adminRangesOf(shell: ResolvedPackage | undefined): ReadonlyMap<string, string> {
  const ranges = new Map<string, string>();
  if (shell === undefined) return ranges;
  for (const field of ['peerDependencies', 'devDependencies'] as const) {
    const block = shell.manifest[field];
    if (block === null || typeof block !== 'object') continue;
    for (const [name, range] of Object.entries(block as Record<string, unknown>)) {
      if (typeof range === 'string' && !ranges.has(name)) ranges.set(name, range);
    }
  }
  return ranges;
}

/**
 * The range for the one build tool no platform manifest declares.
 *
 * The CLI's own — R2.3 names *"the CLI's own manifest"* first among the three
 * things a command may derive from, and this build compiles the same TypeScript
 * an instance will. `undefined` when it declares none, in which case the entry
 * is simply not written (see `devDependenciesFor`).
 */
function typescriptRangeOf(host: InstanceHost): string | undefined {
  for (const field of ['dependencies', 'devDependencies'] as const) {
    const block = host.ownManifest[field];
    if (block === null || typeof block !== 'object') continue;
    const range = (block as Record<string, unknown>)['typescript'];
    if (typeof range === 'string') return range;
  }
  return undefined;
}

/**
 * The steps that are the operator's, and the second command they have not met.
 *
 * R3.4: `endora new instance` prints `endora new storefront` as a next step,
 * *"in the shape `endora new module` prints its next steps today. Discoverability
 * is what makes two commands one product; a client who has to read documentation
 * to learn the second command exists has been handed three commands sharing a
 * prefix."*
 *
 * The demo step is here rather than in the tree, and that is D-216's own shape:
 * a scaffold writes no demo artefact unasked and the capability is discoverable
 * through this block, because *"a capability announced as a deficiency is not
 * optional"*. **That sentence was written and the step was not**, for as long as
 * there was no CLI to run it with; `specs/123-oss-install-experience/` T2-E is
 * the merge request in which the docstring and the array finally say the same
 * thing.
 */
/**
 * The development compose **this plan holds**, as text.
 *
 * Read off the plan rather than rendered a second time: a second render would
 * be a second document, and the whole property FR-105 buys is that the printed
 * addresses and the file the client starts cannot disagree.
 */
function developmentDocument(plan: InstancePlan): string {
  return plan.files.find((file) => file.path === DEV_COMPOSE_PATH)?.content ?? '';
}

/**
 * FR-105's intersection, both halves.
 *
 * The **compose** half is `developmentAddresses`, which answers only for the
 * services the rendered document runs. The **declaration** half is here: an
 * input this instance does not declare is not this instance's, whoever else
 * reads it — so an instance that installs neither `search` nor `email` is told
 * about neither `MEILISEARCH_API_KEY` nor `SMTP_URL`, and neither name is
 * written down in the deciding code. The platform's own three are always
 * declared and therefore always survive this filter, which is why it can be
 * stated as a rule rather than as a list.
 */
function developmentEnvironment(
  plan: InstancePlan,
  declared: readonly EnvironmentInput[],
): ReadonlyMap<string, string> {
  const names = new Set(declared.map((input) => input.name));
  return new Map(
    [...developmentAddresses(developmentDocument(plan))].filter(([name]) => names.has(name)),
  );
}

/**
 * What this run's own development environment adds to the block (feature 125).
 *
 * Both entries are **derived from the rendered `compose.dev.yml`** and from the
 * member decisions this run took; neither is a value written down here. They
 * are an options object rather than two more positional parameters because the
 * block already takes four, and a fifth boolean beside a fourth array is how a
 * call site gets them the wrong way round.
 */
export interface DevelopmentSteps {
  /** The admin member was written, so there is a bundle to serve (FR-110). */
  readonly admin?: boolean;
  /**
   * What a natively running process reaches the development stack at, read off
   * the document this run rendered (`deploy.ts`' `developmentAddresses`).
   *
   * **Printed, not written** — writing it into `.env` is FR-105 and waits on
   * proposed ruling PR-1(a), so until then the block carries the values and the
   * client copies the ones they want.
   */
  readonly environment?: ReadonlyMap<string, string>;
  /** Where the mail catcher's own interface is, if this stack runs one. */
  readonly mailUrl?: string | undefined;
}

/**
 * What a client is told to run, in order (R3.4).
 *
 * Exported so a proof can read the sequence rather than a process's stdout: it
 * is the only statement anywhere of the order the steps go in, and the order is
 * the part that was wrong — `start` before `build`, and no module install at
 * all (`specs/110-instance-repository/` T141).
 *
 * `moduleIds` is the resolved set, and it is a parameter rather than a constant
 * for the reason `cliAliasesFor` is derived: a step naming a command this
 * instance cannot run is worse than no step, because it fails at the one moment
 * a client cannot tell a missing module from a broken install.
 */
export function nextSteps(
  targetDir: string,
  deployment: string,
  topology: Topology = DEFAULT_TOPOLOGY,
  moduleIds: readonly string[] = [],
  development: DevelopmentSteps = {},
): readonly string[] {
  const addresses = [...(development.environment ?? new Map())];
  return [
    `cd ${targetDir} && pnpm install — every range in the manifest is published semver. ` +
      `Nothing in this tree is a copy of ours, so \`pnpm update\` is how a platform fix ` +
      `reaches you, with no file here edited.`,
    // `specs/125-first-mile-install/` FR-108, and it is first for a reason a
    // client would otherwise meet as an error: `migrate` is four lines below and
    // it needs a database. This command wrote `compose.dev.yml` beside the
    // manifest and it runs as written — three of this sequence's steps used to
    // be "provision PostgreSQL", "provision Redis" and "provision a search
    // engine", and they were printed nowhere at all.
    `pnpm run dev:services — PostgreSQL, Redis, Meilisearch and a mail catcher, from ` +
      `\`compose.dev.yml\` beside your manifest. It waits until each one reports healthy, ` +
      `which is what stops \`migrate\` racing a database that is still initialising. ` +
      `\`pnpm run dev:services:down\` stops them and keeps their data.` +
      (development.mailUrl === undefined
        ? ''
        : ` Mail this instance sends goes to that catcher and is read at ${development.mailUrl} ` +
          `— nothing leaves your machine.`),
    `open .env and fill it in — this command already wrote it, with the secrets it ` +
      `generated filled in and everything else this instance reads left blank. Do NOT copy ` +
      `.env.example over it: that file is the same population with no secret in it, for you ` +
      `to commit and for your colleagues to read. Every entry in it names what it decides, ` +
      `and an optional one names what leaving it unset costs.` +
      // The values that match the file this same run rendered, printed rather
      // than written: writing them is FR-105 and waits on a ruling. They are
      // read off the rendered document, so a changed port moves this sentence
      // in the same run — and they are a DEVELOPMENT machine's, which is why
      // they are printed here and are in no `.env.example`.
      (addresses.length === 0
        ? ''
        : ` For the services \`dev:services\` starts, these are the values: ` +
          `${addresses.map(([name, value]) => `${name}=${value}`).join(', ')}. ` +
          `They match \`compose.dev.yml\` as it stands; on a machine that is not a ` +
          `development one, they are not what you want.`),
    `pnpm run setup — generate, build, migrate and \`module:install --all\`, in that order. ` +
      `Each of the four is still its own script and can be run on its own: \`generate\` ` +
      `renders what your admin project and documentation site are built from, \`build\` ` +
      `compiles every member, \`migrate\` applies the schema in the order the installed ` +
      `manifests compute, and \`module:install --all\` installs every module you declared ` +
      `in dependency order. Until that last one has run, the platform refuses to start, ` +
      `naming the modules it requires.`,
    ...(moduleIds.includes('admin_users')
      ? [
          `pnpm run admin:create -- --email=<you> --password=<secret> --first-name=<f> ` +
            `--last-name=<l> — the administrator you will log in as. It is idempotent and it ` +
            `bootstraps the \`platform_admin\` role on the first run, so there is nothing to ` +
            `set up before it. Nothing else creates one: a freshly migrated instance has no ` +
            `account at all, and the operator interface has nobody to admit.`,
        ]
      : []),
    `pnpm run start — the API. \`apps/${deployment}/modules/\` is where your own overlay ` +
      `module goes when you want to change something; \`divergence.ts\` beside it is where ` +
      `you declare what you changed.`,
    // FR-110 — baseline step D1, which was printed nowhere: the admin member
    // declares `preview` and nothing named it, so a client who built the bundle
    // had no command to look at it with.
    ...(development.admin === true
      ? [
          `pnpm run preview:admin — the admin bundle \`build\` produced, served. It talks to ` +
            `the API from your browser, so \`start\` above has to be running; the origin it ` +
            `calls was inlined at build time, which is why moving a built bundle between ` +
            `environments is a rebuild rather than a redeploy.`,
        ]
      : []),
    ...(topology === 'three-host'
      ? [
          `deploy/three-host/ — one compose example and one \`.env.example\` per machine, ` +
            `plus \`deploy/README.md\` for the order they come up in. The three \`.env\` ` +
            `files are not interchangeable: each carries exactly what its own compose file ` +
            `reads, so copying one onto another host either hands it secrets it has no use ` +
            `for or starts it with blanks.`,
        ]
      : []),
    `pnpm run cli demo seed — optional, and off unless you ask: a shop's worth of example ` +
      `data from every module that declares any, which \`pnpm run cli demo reset\` withdraws ` +
      `again leaving your own rows alone. An instance you are going to sell from wants none ` +
      `of it; an instance you are evaluating wants it before the first screen. It is named ` +
      `here rather than written into your tree as a script, which is D-216's own shape.`,
    `endora new storefront <dir> — the customer-facing storefront, which is its own ` +
      `repository. It shares two \`.env\` values with this one and nothing else.`,
  ];
}

export { InstanceHostError, InstanceInputError };

/**
 * The member vocabulary and its refusal, re-exported for `endora install`:
 * that command validates `--without` with its other preconditions and renders
 * the checklist from the vocabulary, and it reaches both through this runner
 * rather than through the template, which it must not name (125 FR-143).
 */
export { MEMBER_VOCABULARY, memberRefusal, type MemberDeclaration } from './template.js';
