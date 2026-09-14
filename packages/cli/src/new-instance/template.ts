/**
 * The tree `endora new instance` writes — one plan, three kinds of file, and a
 * rule that refuses a fourth (`contracts/instance-tree.md` §1, §2).
 *
 * ## R1.1 and R1.2 are the whole design
 *
 * Every file here carries its {@link FileKind}, and the kind is what decides
 * whether it may exist at all:
 *
 *   * **the client's own** — a value only they can supply, or code they will
 *     edit. Written once, never regenerated, never read by us again.
 *   * **wiring** — the smallest expression that hands the platform something it
 *     cannot derive: a database handle, a root directory, a process's argv.
 *     Bounded by R1.4 and counted by {@link wiringLineCount}.
 *   * **derived** — rendered from a fact the platform or the module set already
 *     holds.
 *
 * **A file that is none of the three may not be written** (R1.2), which is the
 * rule that refuses the fork one file at a time: a composition root is not the
 * client's (it is ours), is not wiring (it is 2 628 lines), and is not derived
 * (nothing generates it). The kind is a field on every entry rather than a
 * comment, so T139's T4 can assert it over the plan the command actually
 * builds.
 *
 * ## Nothing is copied, so nothing is rewritten
 *
 * R1.3 / R5.5 / NFR-002. `endora new storefront` copies a reference tree and
 * rewrites every declaration that names something above it; this command copies
 * nothing, so there is no `rewrite.ts` beside this file and there must never be
 * one — its appearance would be evidence that something was copied that should
 * not have been. Every string below is rendered from the resolved packages, the
 * CLI's own manifest and the operator's own flags.
 *
 * ## No demo artefact, at any tier (D-216)
 *
 * *"A client scaffolding an instance for their own trading receives no demo
 * artefact in a tree they own: no composition, no script, no example and no
 * placeholder. Silence means no."* Nothing here writes one, and the capability
 * is discoverable through the next-steps block rather than reported as an
 * omission — a capability announced as a deficiency is not optional.
 *
 * ## What this build cannot yet write, said here rather than discovered
 *
 * The backend member's wiring names symbols on the platform's declared
 * subpaths — `./composition`, `./db`, `./lifecycle`, `./overlay` and
 * `./packages` today. **How many symbols that is is not written here** (D-100): the
 * reconciliation test derives it from the barrels on every run and prints it,
 * and the count in this sentence was already wrong when the three names below
 * were wrong. `composeApp` is one of them since T118 — the
 * position §2.3 stated (*"`composeApp` is imported, never written (R1.2)"*) is
 * met, and the file below supplies the one argument that composition takes:
 * `deploymentRoot`, the directory holding `apps/`, which no package can derive
 * because in an instance the platform came out of `node_modules`
 * (`contracts/application-root-supplier.md` R1.1). **No contribute callback is
 * supplied and there is nowhere in this tree to write one** — R2.4 — so a
 * client's instance contributes over no name a module defaults.
 *
 * The ORM configuration below is the one place an instance restates its own
 * artefacts, and it has none, so the platform's `*From` factories answer over
 * the packages it installed: `configuredEntitiesFrom`,
 * `discoverConfiguredMigrations` and `mikroOrmConfigFrom` on `./db`, and
 * `resolveManifestEntries` on `./lifecycle` with its three suppliers.
 *
 * **That sentence used to name three other symbols, and nothing held this file
 * to it.** It read *"`configuredMigrations`, `configuredEntities` and
 * `resolvedManifestEntries` are `./db`'s and `./lifecycle`'s **under other
 * names**"* — a doc block describing the repair, beside rendered text that had
 * never taken it, so a scaffolded backend did not compile and the knowledge was
 * present the whole time. The guard is
 * `test/new-instance/template-reconciliation.test.ts`' T1, at **symbol**
 * granularity rather than subpath: `./composition` and `./lifecycle` are both
 * declared subpaths, so a reconciliation of the specifier alone passes over all
 * three errors.
 *
 * §2.3's sixth wiring file, `backend/src/cli.ts`, **is** written since
 * `specs/123-oss-install-experience/` G2, and the omission that stood in its
 * place is deleted rather than reworded. Its reason was *"the demo layer around
 * it is exported under no subpath"*, and what discharged it was not a wider
 * `exports` map: `backend/src/cli/demo-command.ts` moved into
 * `<scope>platform/demo` — where `test/unit/kernel/host-residue-partition.test.ts`
 * had it ledgered as platform-shaped residue all along — and the dispatch around
 * both halves became `<scope>platform/cli`'s `runCli`. So the file this command
 * renders names nothing it had to invent, holds no copy of the 479 lines it
 * calls (D-207), and is five lines.
 *
 * The cost of the omission was measured rather than aesthetic: with no CLI, a
 * scaffolded instance could run no `admin_users create`, so the admin bundle A5
 * and A13 prove is built and styled had nobody to log in as.
 */
import {
  isRequiredGiven,
  scopeToMembers,
  type EnvironmentConsumer,
  type EnvironmentInput,
} from '@endora-commerce/contracts';

import { writeEnvFile } from '../inputs/env-file.js';
import { INSTANCE_BUILD_INPUTS, type InstanceBuildInput } from '../lib/instance-build-inputs.js';
import {
  deployFiles,
  developmentComposeFile,
  DEV_COMPOSE_PATH,
  type DeployInput,
  type Topology,
} from './deploy.js';
import { InstanceInputError } from './host.js';

/** §1.1's three kinds, and there is no fourth. */
export type FileKind = 'client' | 'wiring' | 'derived';

/** Which member of the workspace a file belongs to, or the workspace root. */
export type MemberName = 'root' | 'deployment' | 'backend' | 'admin' | 'docs';

/** One file the command would write. */
export interface PlannedFile {
  /** Relative to the target directory, with `/` separators. */
  readonly path: string;
  readonly kind: FileKind;
  readonly member: MemberName;
  readonly content: string;
}

/**
 * One module package the instance declares — and **its own** version beside its
 * own name.
 *
 * The version travels on the same record as the name deliberately. It used to
 * be absent, and the site that writes the `dependencies` entries had exactly one
 * version in scope — the platform's — so every module was declared at it. That
 * is only correct while a release moves every package together, and a release
 * does not: of the packages this repository published on 2026-09-11, 68 moved to
 * `0.8.0` and 15 to `0.7.1`, so a scaffolded instance asked a registry for
 * `@endora-commerce/mod-addresses@^0.8.0` and was told the latest is `0.7.1`.
 * Nothing in the estate makes a release uniform and nothing should: D-225 owns
 * the series, and 15 packages genuinely had only patch-level changes.
 *
 * A caret range over a version a **different** package declares is not a value
 * this command may invent (R2.5a), and it is the one such value that fails at
 * the client's first `pnpm install` rather than in anything we run.
 */
export interface PlannedModulePackage {
  /** The module id, which is what `--module` names and what orders the entries. */
  readonly id: string;
  /** The npm name, verbatim — this is the `dependencies` key. */
  readonly packageName: string;
  /**
   * The version **this package** declares about itself, read off the manifest
   * of the package the run resolved beside the target directory.
   */
  readonly version: string;
}

/** A member this run did not write, and every reason that holds (D-215 §4). */
export interface PlannedOmission {
  readonly path: string;
  readonly reason: string;
}

/** The whole plan, decided before anything is written (R5.2). */
export interface InstancePlan {
  readonly files: readonly PlannedFile[];
  readonly omitted: readonly PlannedOmission[];
  /** The workspace members whose directories this run writes. */
  readonly members: readonly MemberName[];
  /** The registry `--registry` named, normalised, or `null`. */
  readonly registry: string | null;
  /** Every dependency the root manifest declares, name to range. */
  readonly dependencies: ReadonlyMap<string, string>;
}

/** Everything the plan is rendered from. Pure in, pure out. */
export interface PlanInput {
  /** The workspace name, from the target directory's basename. */
  readonly name: string;
  readonly deployment: string;
  readonly scope: string;
  /**
   * The platform package's own version. It ranges the **platform** entry and
   * nothing else — see {@link PlannedModulePackage} for what happened the last
   * time it ranged something else.
   */
  readonly platformVersion: string;
  readonly enginesNode: string;
  readonly packageManager: string | undefined;
  /** The resolved module set, each entry carrying its own version. */
  readonly modules: readonly PlannedModulePackage[];
  /** `null` when the admin shell does not resolve at the version being installed. */
  readonly adminShellVersion: string | null;
  /** `null` when the admin design system does not resolve. §2.4's other package. */
  readonly adminKitVersion: string | null;
  /**
   * The ranges the admin member's own build tools are written from, each read
   * off the admin shell's manifest rather than chosen here (R2.5a).
   *
   * `react` and `react-dom` are its `peerDependencies` — what a host that
   * mounts the shell must resolve — and `vite`, `@vitejs/plugin-react`,
   * `tailwindcss` and `@tailwindcss/vite` are the optional peers by which the
   * shell states what kind of application a host is. A name with no range here
   * is **not written and not guessed**: the member is omitted, naming it, for
   * the same reason `devDependenciesFor` leaves one out.
   */
  readonly adminRanges: ReadonlyMap<string, string>;
  /**
   * The packages the admin project must supply because what it composes
   * declares them **optional** — name to range, already resolved.
   *
   * `index.ts`' `composedOptionalPeers` is the derivation and carries the
   * argument: `manifests:generate` marks a peer optional exactly when only a UI
   * layer reaches it, so for a project that renders those UI layers the set is
   * not optional but **required**, and it is the one statement in either tree of
   * what an admin host has to have.
   */
  readonly adminPeers: ReadonlyMap<string, string>;
  /** The CLI's own version — `endora generate` is what renders §2.6's artefacts. */
  readonly cliVersion: string;
  /**
   * The ranges the documentation member is written from — name to range, read
   * off the CLI's own manifest (R2.3's first named source, and R2.5a).
   *
   * `@docusaurus/core` and `@docusaurus/preset-classic` are the CLI's **optional
   * peers**, which is the same declaration the admin shell makes about a host
   * that mounts it: *"an application of this kind resolves these"*. The CLI
   * renders this site's navigation and imports neither package, exactly as the
   * shell declares `vite` and `tailwindcss` and imports neither. A name with no
   * range here is **not written and not guessed**: the member is omitted,
   * naming it.
   */
  readonly docsRanges: ReadonlyMap<string, string>;
  /**
   * The ranges the instance's own `devDependencies` are derived from, each read
   * off a manifest this run resolved rather than chosen here (R2.5a).
   *
   * The four peers and `ioredis` come from `@endora-commerce/platform`'s own
   * `peerDependencies` and `dependencies`; `typescript` comes from the CLI's own
   * manifest, which R2.3 names as a source. A package with no such source is not
   * written — see {@link devDependenciesFor}.
   */
  readonly declaredRanges: ReadonlyMap<string, string>;
  /** Already normalised by the caller; `null` writes no `.npmrc`. */
  readonly registry: string | null;
  /** The `.npmrc` text, when there is a registry. Written by `npmrc.ts` (R5.7). */
  readonly npmrc: string | null;
  /**
   * Which machine layout the `deploy/` examples describe (D-230).
   *
   * It selects and records nothing: no file this command writes carries the
   * value, and nothing reads one back. `deploy.ts` is where the derivation and
   * that rule both live.
   */
  readonly topology: Topology;
  /**
   * What this instance reads from its environment — the platform's declaration
   * unioned with the manifests of the modules it installs
   * (`modules.ts`' `instanceEnvironmentInputs`).
   *
   * It is a **parameter** rather than a constant for the reason every other
   * version and range here is: the declaration belongs to the packages the
   * client's machine resolved, not to this CLI, and a list compiled in here
   * could never see a module a client installed from a registry (D-100, R2.3).
   */
  readonly declared: readonly EnvironmentInput[];
  /**
   * The text of a `.env` the operator placed in the target directory before
   * running, or `''`.
   *
   * Tier 2 (`input-resolution.md` R1.2), and it reaches the plan rather than the
   * writer so that `--dry-run` reports the file it would actually produce. What
   * the operator wrote is merged into and never rewritten: their comments, their
   * ordering and their own keys survive.
   */
  readonly existingEnv: string;
  /**
   * The secrets this run generated, name to value (R2.5d).
   *
   * They arrive already generated because the plan is pure and a plan that
   * called `randomBytes` would render a different tree on every call — which
   * `--dry-run`'s whole purpose is to rule out. The caller generates once and
   * reports the names in the provenance line.
   */
  readonly generated: ReadonlyMap<string, string>;
}

/**
 * A workspace name a client can actually install.
 *
 * npm's own rule, applied to the basename the operator chose, and **refused**
 * rather than sanitised: a command that quietly renamed the directory the
 * operator named would put a name nobody chose into the file that is the
 * module list (R1.2 there).
 */
export function assertWorkspaceName(name: string): void {
  if (/^[a-z0-9][a-z0-9._-]*$/.test(name)) return;
  throw new InstanceInputError(
    'F1',
    `"${name}" is not a usable npm package name, and it is the name the workspace root takes ` +
      `from the directory you asked for. Use lower-case letters, digits, \`.\`, \`_\` and ` +
      `\`-\`, starting with a letter or a digit — or scaffold into a directory whose basename ` +
      `already is one. Nothing is written.`,
  );
}

/**
 * The deployment name, which is `DEPLOYMENT`'s value and nothing else reads it
 * (§2.2).
 *
 * F4. It is a directory name under `apps/`, so the refusal is about what a
 * directory name may be: no separator, no traversal, no leading dot.
 */
export function assertDeploymentName(deployment: string): void {
  if (/^[a-z0-9][a-z0-9_-]*$/.test(deployment)) return;
  throw new InstanceInputError(
    'F4',
    `\`--deployment ${deployment}\` is not a deployment name. It names the directory under ` +
      `\`apps/\` where this instance's overlay modules and its \`divergence.ts\` live, and it ` +
      `is the value of \`DEPLOYMENT\` — so it is lower-case letters, digits, \`_\` and \`-\`, ` +
      `starting with a letter or a digit. Nothing is written.`,
  );
}

/**
 * The derived artefacts an instance generates and commits none of (§2.6,
 * `instance-repository.md` R3.2).
 *
 * **There are three and this list carried two** until T138 wrote the admin
 * member. `admin/src/tailwind.generated.css` arrived with T124 on the same day
 * this command landed, R3.2 already said three, and `new-instance.test.ts`'
 * *"both generated artefacts are git-ignored"* asserted the stale count rather
 * than catching it. A committed stylesheet enumeration is the tree and the
 * install disagreeing about which packages were scanned — which is silent, and
 * is the whole failure `admin-stylesheet-composition.md` exists for.
 */
export const GENERATED_ARTEFACTS = [
  'admin/src/modules.generated.ts',
  'admin/src/tailwind.generated.css',
  'docs/sidebars.modules.generated.js',
] as const;

/**
 * The generated **trees** — a whole directory the generator owns, rather than a
 * file it writes.
 *
 * They are apart from {@link GENERATED_ARTEFACTS} because the two answer
 * different questions: that list is the files a reconciliation can name and
 * compare, this one is what `.gitignore` has to cover. The documentation half
 * of §2.6 is a *population* rather than a file — one copied page per page a
 * module ships, one reference page per module, and the stamp that lets a run
 * undo the previous one's copies — so a client's `.gitignore` names the
 * directories and git's own "a tracked file is never ignored" keeps a page they
 * write themselves visible with no exception list to maintain.
 */
export const GENERATED_TREES = [
  'docs/docs/modules/**',
  'docs/docs/module-reference/**',
  'docs/.module-docs-copies.json',
] as const;

/**
 * The named CLI aliases an instance's manifests earn
 * (`specs/123-oss-install-experience/` T2-D).
 *
 * **Derived, never written.** `cli` is the pass-through and covers every
 * command any installed module declares; what a named alias buys on top of it
 * is that an operator reads it in `pnpm run`, and an alias addressing a module
 * this instance did not install would fail with `unknown module` at the one
 * moment a client is least able to tell a missing module from a broken CLI.
 *
 * **There is deliberately no `demo:seed` or `demo:reset` entry**, and
 * `specs/123-oss-install-experience/` T2-D asked for both. D-216 is more
 * specific than the task and is the owner's: *"a client scaffolding an instance
 * for their own trading receives no demo artefact in a tree they own: no
 * composition, **no script**, no example and no placeholder"* — and it names
 * where the capability does belong, which is the next-steps block. `cli` reaches
 * both verbs anyway (`pnpm run cli demo seed`), so nothing is unavailable; what
 * is refused is a line in a client's manifest they did not ask for.
 */
export function cliAliasesFor(
  modules: readonly PlannedModulePackage[],
): readonly (readonly [string, string])[] {
  const installed = new Set(modules.map((module) => module.id));
  const aliases: (readonly [string, string])[] = [];
  for (const [alias, moduleId, command] of MODULE_CLI_ALIASES) {
    if (installed.has(moduleId)) aliases.push([alias, `node dist/cli.js ${moduleId} ${command}`]);
  }
  return aliases.sort(([a], [b]) => a.localeCompare(b));
}

/**
 * The module-declared commands an operator is given a name for.
 *
 * It is short on purpose and is not a mirror of every `cliCommands` entry in the
 * estate: this command resolves package **manifests**, not their module
 * manifests, so it cannot enumerate declarations — and a generated list of forty
 * aliases would be forty scripts a client scrolls past to find the one that
 * matters. `admin_users create` is the one an install cannot finish without.
 */
const MODULE_CLI_ALIASES: readonly (readonly [string, string, string])[] = [
  ['admin:create', 'admin_users', 'create'],
];

/**
 * The backend member's scripts, every one of them reading the instance's own
 * `.env` (`specs/123-oss-install-experience/` G3).
 *
 * **`--env-file-if-exists=../.env`, and the `..` is the whole of it.** Every
 * root script is `pnpm -C backend run …`, so these run with `backend/` as the
 * working directory while the `.env` a client is told to fill in sits at the
 * root of the tree beside `.env.example` and beside the `.env` entry in
 * `.gitignore`. Without the prefix the file is inert: a client fills it in, runs
 * `pnpm run migrate`, and the process reads nothing at all — which is the second
 * half of the defect the acceptance criterion papers over by supplying the
 * values through `process.env` instead.
 *
 * `-if-exists` rather than `--env-file`, because a `.env` is not obligatory: a
 * container-hosted instance is configured entirely from its process environment,
 * and a flag that refused to start without the file would break exactly the
 * deployment `deploy/compose.prod.yml` describes. A value already in the
 * environment wins over the file, which is Node's own precedence and the one an
 * operator expects.
 *
 * It is one function rather than a spelling repeated ten times, so a script
 * added later cannot be the one that silently does not read the file.
 */
export function backendScripts(input: PlanInput): Record<string, string> {
  const node = 'node --env-file-if-exists=../.env';
  return {
    // `tsc` and `node --watch` rather than `tsx`: no manifest this run can
    // read declares a range for `tsx`, and a range this command chose would
    // be a value nobody reviewed (R2.5a).
    dev: `tsc -p tsconfig.json --watch & ${node} --watch dist/index.js`,
    build: 'tsc -p tsconfig.json',
    start: `${node} dist/index.js`,
    worker: `${node} dist/worker.js`,
    migrate: `${node} dist/migrate.js`,
    'module:install': `${node} dist/module-commands/install.js`,
    'module:uninstall': `${node} dist/module-commands/uninstall.js`,
    'module:enable': `${node} dist/module-commands/enable.js`,
    'module:disable': `${node} dist/module-commands/disable.js`,
    'module:status': `${node} dist/module-commands/status.js`,
    // The operator CLI (`specs/123-oss-install-experience/` G2, T2-D).
    // `cli` is the generic pass-through, so a module this instance installed
    // which declares a `cliCommands` entry is addressable with no file in this
    // tree edited; the named entries below are the aliases this repository's own
    // `backend/package.json` carries, **derived** from what is installed rather
    // than written.
    cli: `${node} dist/cli.js`,
    ...Object.fromEntries(
      cliAliasesFor(input.modules).map(([name, command]) => [
        name,
        command.replace(/^node /, `${node} `),
      ]),
    ),
  };
}

/** Lines of wiring in a plan — R1.4's bound, measured rather than intended. */
export function wiringLineCount(plan: InstancePlan): number {
  return plan.files
    .filter((file) => file.kind === 'wiring')
    .reduce((total, file) => total + file.content.split('\n').length, 0);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Which members this instance writes, as the environment declaration scopes on.
 *
 * `specs/118-instance-member-selection/`: an input read by no written member is
 * **out of the population** — not declared, not asked for, not counted. The
 * storefront is never here: under D-195 it is its own repository with its own
 * declaration, and `endora new storefront` resolves that one.
 */
function writtenMembers(admin: boolean): readonly EnvironmentConsumer[] {
  return admin ? ['backend', 'admin'] : ['backend'];
}

/**
 * The environment inputs a client is asked to fill in, in declaration order.
 *
 * Two exclusions, and both are rules rather than names. A **generable secret**
 * is written into the `.env` this command produces and appears in no
 * `.env.example` (R2.5d), so asking for it would be asking for a value the tool
 * has already supplied. And an input **no written member reads** is out of the
 * population (118).
 */
export function declaredEnvironmentInputs(
  declared: readonly EnvironmentInput[],
  admin: boolean,
): readonly EnvironmentInput[] {
  return scopeToMembers(declared, writtenMembers(admin)).filter(
    (input) => !(input.generable && input.secret),
  );
}

/** The generable secrets this run owes a value for, in declaration order. */
export function generableEnvironmentInputs(
  declared: readonly EnvironmentInput[],
  admin: boolean,
): readonly EnvironmentInput[] {
  return scopeToMembers(declared, writtenMembers(admin)).filter(
    (input) => input.generable && input.secret,
  );
}

/**
 * One declaration, as an operator reads it: what it decides, then what it costs
 * to leave unset.
 *
 * Both sentences are the **declaration's own**, carried across rather than
 * rewritten. A rewrite here would be a second statement of a fact the author of
 * the input already made, one tree away from where anybody would notice it had
 * drifted — and an `optional` requirement carries *what is lost* precisely so
 * that this line does not have to say the word "optional" and stop there.
 */
function declarationComment(input: EnvironmentInput): readonly string[] {
  const lines = [...wrapEnvComment(input.describes.en)];
  switch (input.requirement.kind) {
    case 'required':
      lines.push('# REQUIRED.');
      break;
    case 'requiredWhen':
      lines.push(
        `# REQUIRED when ${input.requirement.input}=${input.requirement.equals}.`,
      );
      break;
    case 'optional':
      // The cost on a line of its own rather than spliced into a sentence of
      // ours. Declarations disagree about whether `without` opens with a
      // capital, and a sentence built as `without it, <text>` reads wrong for
      // half of them — which would be this file rewriting the author's prose to
      // fit its own grammar, one comma at a time.
      lines.push('# optional — what you lose:', ...wrapEnvComment(input.requirement.without.en));
      break;
  }
  if (input.secret) lines.push('# SECRET: never commit this value and never print it.');
  return lines;
}

/** One sentence, wrapped to a width a terminal and a diff both show whole. */
function wrapEnvComment(text: string): readonly string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line.length > 0 && `${line} ${word}`.length > 84) {
      out.push(`# ${line}`);
      line = word;
      continue;
    }
    line = line.length === 0 ? word : `${line} ${word}`;
  }
  if (line.length > 0) out.push(`# ${line}`);
  return out;
}

/**
 * `.env.example` — every input this instance actually reads (FR-010).
 *
 * **Two populations, and keeping them apart is the point.** The build inputs are
 * inlined into an artefact by `docker build`; the declared inputs are read by a
 * process on every start. An operator who conflates them rebuilds an image to
 * change a password. They are two headed sections of one file rather than two
 * files because a client fills in one `.env`, and a second example beside the
 * first is a second thing to forget.
 *
 * Neither section is a list. The first is `INSTANCE_BUILD_INPUTS`; the second is
 * the platform's declaration unioned with the manifests of the modules this run
 * installed, scoped to the members it wrote. The defect it closes is the
 * acceptance criterion's own note — *"its `.env.example` declares none of them,
 * so a client who fills in the file the command wrote has nothing to put them
 * in"* — and the note is deleted in the same merge request, because an
 * instrument that reports a gap must not outlive it.
 */
export function envExample(
  inputs: readonly InstanceBuildInput[],
  declared: readonly EnvironmentInput[],
  admin: boolean,
): string {
  const lines = [
    '# Everything this instance needs from its environment. Copy to `.env` and fill it in:',
    '# `.env` is git-ignored, so nothing there is a value anybody but you chose.',
    '#',
    '# An entry with no value on the right of the `=` is one the platform has no honest',
    '# default for — the declaration says so, and the refusal belongs to whatever reads it.',
    '',
    '# ---------------------------------------------------------------------------',
    '# The BUILD inputs. Two of them are inlined into a bundle by `docker build`, so',
    '# changing one of these means rebuilding an image rather than restarting a process.',
    '# ---------------------------------------------------------------------------',
  ];
  for (const input of inputs) {
    lines.push('', `# ${input.meaning}`, `# example: ${input.example}`);
    lines.push(`${input.name}=${input.default ?? ''}`);
  }
  const runtime = declaredEnvironmentInputs(declared, admin);
  if (runtime.length > 0) {
    lines.push(
      '',
      '# ---------------------------------------------------------------------------',
      '# The RUNTIME inputs, read on every start. Each sentence below is the platform\'s or',
      '# the declaring module\'s own: this file is derived from what you installed, so a',
      '# different module set is a different file and nothing here was written by hand.',
      '#',
      '# The secrets this instance signs and encrypts with are NOT here. `endora new',
      '# instance` generated them into `.env` beside this file and named them on its own',
      '# output; a generated secret belongs in no example and in no source file.',
      '# ---------------------------------------------------------------------------',
    );
    for (const input of runtime) {
      lines.push('', ...declarationComment(input), `${input.name}=`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The `.env` this command writes — the generated secrets, and a blank for
 * everything else the instance reads.
 *
 * R2.5d: a generated secret is written **where the operator can read it**,
 * change it and copy it into a secret store. The placeholders are there so that
 * the file a client edits is the file their instance reads: telling them to
 * `cp .env.example .env` after this command has already written one would have
 * them overwrite the generated secrets with empty strings, and the boot that
 * then failed would name none of this.
 *
 * **Every placeholder is commented out, and that is not cosmetic.** A blank
 * assignment is not the same state as no assignment: Node's `--env-file` reads
 * `MEILISEARCH_URL=` as the empty string, and the platform's `??` fallbacks
 * treat an empty string as a value. Measured on the instance acceptance
 * criterion — a `.env` listing every optional input as a blank turned twenty
 * "unset"s into twenty empty strings and the health route answered **503** over
 * a search engine that was running. So the file lists what there is to fill in
 * and changes nothing until a client removes a `#`, and {@link writeEnvFile}
 * fills a placeholder in place rather than appending a second assignment.
 *
 * A `.env` the operator placed here first is **merged into, never rewritten**:
 * their comments, their ordering and their own keys survive, and a value they
 * already supplied is not generated over.
 */
export function envFile(input: PlanInput, admin: boolean): string {
  const required: string[] = [];
  const optional: string[] = [];
  for (const declaration of declaredEnvironmentInputs(input.declared, admin)) {
    (isRequiredGiven(declaration, {}) ? required : optional).push(declaration.name);
  }
  const seeded = [
    '# This instance\'s own configuration. Git-ignored, and yours.',
    '#',
    '# `endora new instance` wrote it. The values it GENERATED are set, at the bottom; every',
    '# other input this instance reads is listed below, commented out. Remove the `#` and',
    '# fill one in to set it — a commented line and a line reading `NAME=` are NOT the same',
    '# thing to the process that reads this file, and the second is an empty string.',
    '#',
    '# `.env.example` beside this file carries a sentence for each one saying what it',
    '# decides and what leaving it unset costs. Do not copy it over this file.',
    '',
    '# Required — the instance does not start without these.',
    ...required.map((name) => `#${name}=`),
    '',
    '# Optional — each has a cost stated in `.env.example`, and no default worth inventing.',
    ...optional.map((name) => `#${name}=`),
    '',
  ].join('\n');
  // The operator's file wins over the seed entirely: if they placed one, this
  // run adds to it and re-orders nothing.
  const base = input.existingEnv.length > 0 ? input.existingEnv : seeded;
  return writeEnvFile(base, input.generated);
}

/**
 * The plan. Nothing here touches the filesystem, so `--dry-run` reports exactly
 * what a real run writes rather than a second derivation of it (R5.3).
 */
export function planInstance(input: PlanInput): InstancePlan {
  const files: PlannedFile[] = [];
  const omitted: PlannedOmission[] = [];
  // §2.4 — decided first, because the workspace member list, the root scripts
  // and the `.gitignore` all depend on whether this instance has an operator
  // interface. Deciding it twice is how two files would come to disagree about
  // a member one of them writes.
  const admin = adminMember(input);
  // §2.4a — same reasoning, same three consequences (the member list, the root
  // scripts, the `.gitignore`), decided in the same place.
  const docs = docsMember(input);

  const dependencies = new Map<string, string>();
  // Each range is `^` over the version **that package** declares about itself,
  // and never over another package's. A release is not uniform — 68 of this
  // repository's packages moved to `0.8.0` on 2026-09-11 and 15 to `0.7.1` —
  // so a module ranged at the platform's version is a range no registry can
  // satisfy, which is a failure a client meets at their first install and
  // nothing in a checkout can see (the tarball acceptance mode overrides every
  // one of these ranges with a `file:` path).
  dependencies.set(`${input.scope}platform`, `^${input.platformVersion}`);
  for (const module of [...input.modules].sort((a, b) => a.id.localeCompare(b.id))) {
    dependencies.set(module.packageName, `^${module.version}`);
  }
  // The packages the installed modules declare **optional** — and they are
  // declared **here**, at the root, rather than in the admin member that needs
  // them rendered (§2.4).
  //
  // pnpm resolves a package's peers from its **dependent's** context, and a
  // module package's dependent in an instance is this manifest: the module set
  // is the root's (R3.6) and the admin member declares none of it. So an
  // optional peer declared in the admin member satisfies nothing — measured,
  // `mod-invoices`' `@endora-commerce/page-builder-admin` stayed unresolved with
  // the package installed and declared one member over, and Vite bound the
  // import to an `__vite-optional-peer-dep:` stub whose every named export is
  // missing. Declaring the module set a second time in the admin member would
  // satisfy them and is exactly what R3.6 forbids; declaring their peers beside
  // them is the same fact in the one place the set already lives.
  if (admin.written) {
    for (const [name, range] of [...input.adminPeers].sort(([a], [b]) => a.localeCompare(b))) {
      if (BUILD_TOOL_PEERS.has(name)) continue;
      if (!dependencies.has(name)) dependencies.set(name, range);
    }
  }

  if (admin.omission !== null) omitted.push({ path: 'admin/', reason: admin.omission });
  if (docs.omission !== null) omitted.push({ path: 'docs/', reason: docs.omission });

  // --- the workspace root (§2.1) -------------------------------------------
  //
  // The per-layer builds, and the composite that is their conjunction
  // (`specs/122-layer-deployment-independence/contracts/layer-independence.md`
  // §2 R2.1, under D-230). Three layers are deployed to three hosts on three
  // schedules, so each is built by a command of its own — and a CI job on the
  // admin host cannot cite a command it was never told.
  //
  // One list, so there is one predicate. The composite used to spell the same
  // three terms inline; deriving it from the named entries is what keeps its
  // value byte-identical to the named parts rather than merely similar to them.
  const layerBuilds: readonly (readonly [string, string])[] = [
    ['build:backend', 'pnpm -C backend run build'],
    ...(admin.written ? ([['build:admin', 'pnpm -C admin run build']] as const) : []),
    ...(docs.written ? ([['build:docs', 'pnpm -C docs run build']] as const) : []),
  ];
  // `-C` and never `--filter <name>` — see the block below for what a filter
  // cost the first end-to-end run.
  // The four steps `setup` is the conjunction of (`specs/125-first-mile-install/`
  // FR-109), named as **root scripts** rather than spelled out as commands.
  // That is one level up from `build`'s derivation and buys the same property
  // for a longer sequence: a change to what `migrate` or `module:install` runs
  // reaches the composite with nothing here edited, where an inlined
  // `pnpm -C backend run migrate` would be a second spelling of it.
  //
  // `generate` is conditional on the same predicate the script itself is: an
  // instance with neither generated member declares none, so the composite must
  // not name one.
  const setupSteps: readonly string[] = [
    ...(admin.written || docs.written ? ['generate'] : []),
    'build',
    'migrate',
    'module:install --all',
  ];
  const rootScripts: Record<string, string> = {
    migrate: 'pnpm -C backend run migrate',
    dev: 'pnpm -C backend run dev',
    ...Object.fromEntries(layerBuilds),
    // §2.5's `build` is the whole instance's, and §2.5's `generate` is the
    // three derived artefacts — two of which are the admin member's, so
    // both entries name a member that may not be there. An instance with
    // no operator interface gets neither rather than a script that fails
    // on a directory nobody wrote.
    build: layerBuilds.map(([, command]) => command).join(' && '),
    // One `endora generate` renders every member's artefacts, so the root
    // script is the command itself rather than a member's. An instance with
    // neither member gets no `generate` at all, rather than a script that
    // fails on a directory nobody wrote.
    ...(admin.written || docs.written ? { generate: 'endora generate' } : {}),
    // The development stack (`specs/125-first-mile-install/` FR-108). `--wait`
    // is not decoration: it blocks until every health check in the rendered
    // document passes, which is what stops `migrate` racing a Postgres that is
    // still initialising — and it is what lets `setup` run straight after this.
    // `down` keeps the volumes, because a development database is not a scratch
    // file and `docker compose down -v` is not a step anybody should be one
    // typo away from.
    'dev:services': `docker compose -f ${DEV_COMPOSE_PATH} up -d --wait`,
    'dev:services:down': `docker compose -f ${DEV_COMPOSE_PATH} down`,
    // FR-109 — four typed lines collapsed into one, and every named step
    // survives beside it for the operator who wants them (§3's User Story 3).
    setup: setupSteps.map((step) => `pnpm run ${step}`).join(' && '),
    start: 'pnpm -C backend run start',
    // FR-110 — the admin bundle, served. Baseline step D1: `admin/package.json`
    // has declared `preview` all along and no root script and no printed step
    // named it, so a client who ran `build:admin` had a bundle and no way to
    // look at it. With the member, like every other admin entry.
    ...(admin.written ? { 'preview:admin': 'pnpm -C admin run preview' } : {}),
    'module:install': 'pnpm -C backend run module:install',
    'module:uninstall': 'pnpm -C backend run module:uninstall',
    'module:enable': 'pnpm -C backend run module:enable',
    'module:disable': 'pnpm -C backend run module:disable',
    'module:status': 'pnpm -C backend run module:status',
    // The operator CLI (`specs/123-oss-install-experience/` G2, T2-D). `cli` is
    // the generic pass-through, so a module this instance installed which
    // declares a `cliCommands` entry is addressable with no file in this tree
    // edited; the named entries beside it are **derived** from what is
    // installed rather than written.
    cli: 'pnpm -C backend run cli',
    ...Object.fromEntries(
      cliAliasesFor(input.modules).map(([name]) => [name, `pnpm -C backend run ${name}`]),
    ),
  };

  files.push({
    path: 'package.json',
    kind: 'derived',
    member: 'root',
    content: json({
      name: input.name,
      private: true,
      type: 'module',
      ...(input.packageManager === undefined ? {} : { packageManager: input.packageManager }),
      engines: { node: input.enginesNode },
      // `pnpm -C backend`, never `pnpm --filter <name>`
      // (`specs/110-instance-repository/` T141). These read
      // `pnpm --filter backend run …` while the member below is named
      // `<name>-backend`, so pnpm matched no project, printed `No projects
      // matched the filters` and **exited 0** — every root script of a
      // scaffolded instance was a silent no-op, and every step of the next-steps
      // block the command prints was a successful nothing. Measured by the
      // acceptance criterion's first end-to-end run (T140), which found an empty
      // database behind a `migrate` that had exited 0.
      //
      // `-C` is the repair rather than a corrected filter for two reasons. It
      // names the **directory** `pnpm-workspace.yaml` declares, so it cannot
      // drift from a member's name again; and it fails loudly in both directions
      // — a missing directory and a missing script are each exit 1 — where a
      // name filter's whole failure mode is a green nothing. `--fail-if-no-match`
      // would restore the refusal for a filter, and it is pnpm 9.5 and later
      // only; `-C` needs no version this command cannot see.
      scripts: rootScripts,
      dependencies: Object.fromEntries([...dependencies].sort(([a], [b]) => a.localeCompare(b))),
      devDependencies: Object.fromEntries(
        devDependenciesFor(input, admin.written || docs.written),
      ),
    }),
  });

  files.push({
    path: 'pnpm-workspace.yaml',
    kind: 'wiring',
    member: 'root',
    content: [
      '# The members of this workspace. One list, one place.',
      '#',
      '# The module list is NOT here: it is the root `package.json`\'s `dependencies`, and',
      '# the platform discovers those from `node_modules` at runtime. Two spellings of one',
      '# set is the one disagreement nothing in this tree could detect.',
      'packages:',
      '  - backend',
      ...(admin.written ? ['  - admin'] : []),
      ...(docs.written ? ['  - docs'] : []),
      '',
    ].join('\n'),
  });

  files.push({
    path: 'tsconfig.json',
    kind: 'client',
    member: 'root',
    content: json({
      compilerOptions: {
        target: 'ES2023',
        lib: ['ES2023'],
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        forceConsistentCasingInFileNames: true,
      },
    }),
  });

  if (input.npmrc !== null) {
    files.push({ path: '.npmrc', kind: 'wiring', member: 'root', content: input.npmrc });
  }

  files.push({
    path: '.env.example',
    kind: 'client',
    member: 'root',
    content: envExample(INSTANCE_BUILD_INPUTS, input.declared, admin.written),
  });

  // The instance's own configuration, holding whatever this run generated
  // (R2.5d) and a blank for everything else it reads. It is `client` for the
  // same reason `.env.example` is — it is the operator's from the moment it is
  // written — and it is git-ignored, so it leaves this tree with nobody but
  // them having seen it.
  files.push({
    path: '.env',
    kind: 'client',
    member: 'root',
    content: envFile(input, admin.written),
  });

  files.push({
    path: '.gitignore',
    kind: 'derived',
    member: 'root',
    content: [
      '# The generated artefacts THAT ARE FACTS ABOUT THE INSTALL. `pnpm run generate`',
      '# writes them and this tree commits none of them: a different module set is a',
      '# different bundle, and committing one makes this tree and the install disagree.',
      '#',
      '# `apps/<deployment>/divergence.generated.{md,json}` is deliberately NOT here. The',
      '# same command writes it and it is a fact about THIS repository — what your own',
      '# overlay modules decorate, intercept and consume — so it is committed and the diff',
      '# is the point: it is where an upgrade that changes behaviour you depended on shows up.',
      ...GENERATED_ARTEFACTS,
      '',
      '# The documentation site\'s are a population rather than a file: one copied page per',
      '# page a module ships, one reference page per module, and the stamp that lets a run',
      '# undo the previous one\'s copies. A **tracked** file is never ignored whatever the',
      '# pattern says, so a page you write yourself stays visible and no exception list is',
      '# written down here.',
      ...GENERATED_TREES,
      '',
      'node_modules',
      'dist',
      '.env',
      '',
    ].join('\n'),
  });

  files.push({
    path: 'README.md',
    kind: 'client',
    member: 'root',
    content: readme(input, dependencies.size, rootScripts, {
      admin: admin.written,
      docs: docs.written,
    }),
  });

  // --- the deployment (§2.2) -----------------------------------------------
  files.push({
    path: `apps/${input.deployment}/divergence.ts`,
    kind: 'client',
    member: 'deployment',
    content: divergenceDeclaration(input.deployment),
  });
  files.push({
    path: `apps/${input.deployment}/modules/.gitkeep`,
    kind: 'client',
    member: 'deployment',
    content: '',
  });

  // --- the backend member (§2.3) -------------------------------------------
  files.push({
    path: 'backend/package.json',
    kind: 'derived',
    member: 'backend',
    content: json({
      name: `${input.name}-backend`,
      private: true,
      type: 'module',
      // No dependency of its own: the module set is the root's (§2.3, R3.6).
      scripts: backendScripts(input),
    }),
  });

  files.push({
    path: 'backend/tsconfig.json',
    kind: 'client',
    member: 'backend',
    content: json({
      compilerOptions: {
        target: 'ES2023',
        lib: ['ES2023'],
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        outDir: 'dist',
        rootDir: 'src',
        strict: true,
        skipLibCheck: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        esModuleInterop: true,
      },
      include: ['src'],
    }),
  });

  for (const file of backendWiring(input)) files.push(file);

  // --- the admin member (§2.4) ---------------------------------------------
  for (const file of admin.files) files.push(file);

  // --- the documentation member (§2.4a) ------------------------------------
  for (const file of docs.files) files.push(file);

  // --- the deployment examples (§2.7; layer-independence.md §3) ------------
  //
  // Last, because they are derived from the member decisions above and from
  // nothing else but the topology. They belong to no member's directory: an
  // example that deploys the admin is not the admin project's file, and a
  // client editing one is editing the root of their own repository.
  const deployInput: DeployInput = {
    topology: input.topology,
    admin: admin.written,
    docs: docs.written,
    npmrc: input.npmrc !== null,
    enginesNode: input.enginesNode,
    packageManager: input.packageManager,
    // The same declaration the root `.env.example` is derived from. One
    // derivation of what this instance needs, two readers of it.
    declared: input.declared,
  };
  for (const file of deployFiles(deployInput)) files.push(file);

  // --- the development environment (`specs/125-first-mile-install/` §4.1) ---
  //
  // At the **root** and not under `deploy/`, because everything in there is
  // addressed to a person deploying to a host they own and this file is
  // addressed to a person on a laptop (spec §5.3.1). Written unconditionally
  // (FR-107): it is inert, it is derived from the same catalogue the examples
  // are, and every audience the feature has wants it.
  files.push(developmentComposeFile(deployInput));

  return {
    files,
    omitted,
    members: [
      'root',
      'deployment',
      'backend',
      ...(admin.written ? (['admin'] as const) : []),
      ...(docs.written ? (['docs'] as const) : []),
    ],
    registry: input.registry,
    dependencies,
  };
}

/**
 * The deployment's own declaration, written **out in full with its doc block**
 * (§2.2).
 *
 * `backend/src/apps/example/divergence.ts`'s own stated reason, which is why
 * this is not an empty literal: *"the mechanism is easier to find than to
 * remember … a field an author never sees is a field they never learn they
 * have."*
 */
function divergenceDeclaration(deployment: string): string {
  return `/**
 * What this deployment does differently from core.
 *
 * Three fields, and each answers a question a walk of this tree cannot:
 *
 *   * \`omittedModules\` — a module this deployment deliberately does not ship.
 *     The declaration is two-way: an entry for a module you do ship fails as
 *     loudly as an omission you did not declare.
 *   * \`decorationOrder\` — where two of your overlay modules decorate one
 *     registration, the order they wrap it in. \`beta(acme(core))\` and
 *     \`acme(beta(core))\` are different implementations, so the ambiguity is
 *     refused at boot rather than resolved by a directory read order.
 *   * \`reasons\` — one sentence per derived divergence, keyed as the generated
 *     report keys it. A divergence with no sentence is a finding; a sentence
 *     describing a divergence that is gone is the same finding walked the other
 *     way.
 *
 * It is written out empty on purpose. A field an author never sees is a field
 * they never learn they have.
 */
export const divergence = {
  omittedModules: [],
  decorationOrder: {},
  reasons: {},
} as const;

/** The deployment this declaration belongs to. \`DEPLOYMENT=${deployment}\`. */
export const deployment = '${deployment}';
`;
}

/**
 * The packages the instance builds with, each range read off a manifest this
 * run resolved (§2.1, R2.5a).
 *
 * `instance-tree.md` §2.1 names the set — *"the platform's four peers plus
 * `@mikro-orm/migrations`, `tsx`, `typescript`"* — and says nothing about where
 * the **ranges** come from, which is the question R2.5a answers: a value with
 * no source is one the command would have to invent. So each is derived:
 *
 *   * the four peers, from `@endora-commerce/platform`'s own
 *     `peerDependencies`. A platform that widens `zod` to `^5` widens this in
 *     the same run, with nothing here to edit.
 *   * `@mikro-orm/migrations`, from the range the platform declares for
 *     `@mikro-orm/core`. The MikroORM packages version in lockstep and a
 *     migrator from another major does not load the driver from this one.
 *   * `ioredis`, from the platform's own `dependencies`. It is not in §2.1's
 *     list and it is not optional: the five operator commands construct the
 *     `OperatorResources` the platform asks them for, and one of its three
 *     members is a Redis connection.
 *   * `typescript`, from the CLI's own manifest — R2.3's first named source.
 *
 * **`tsx` is deliberately absent.** No manifest this run can read declares a
 * range for it, so writing one would be the invention R2.5a forbids; the
 * member's `dev` script uses `tsc` and `node --watch`, which need nothing that
 * is not already here.
 */
export function devDependenciesFor(
  input: PlanInput,
  /**
   * Does this instance have an artefact to generate at all?
   *
   * The root's `generate` script is `endora generate` — one run renders every
   * member's artefacts — so the binary has to be on the **root's** path. An
   * instance with neither an admin project nor a documentation site has no
   * `generate` script, and declaring the tool that runs it would be a
   * dependency with nothing to do.
   */
  generates = false,
): readonly (readonly [string, string])[] {
  const wanted: readonly (readonly [string, string])[] = [
    ['@mikro-orm/core', input.declaredRanges.get('@mikro-orm/core') ?? ''],
    ['@mikro-orm/postgresql', input.declaredRanges.get('@mikro-orm/postgresql') ?? ''],
    ['@mikro-orm/migrations', input.declaredRanges.get('@mikro-orm/core') ?? ''],
    ['fastify', input.declaredRanges.get('fastify') ?? ''],
    ['zod', input.declaredRanges.get('zod') ?? ''],
    ['ioredis', input.declaredRanges.get('ioredis') ?? ''],
    ['typescript', input.declaredRanges.get('typescript') ?? ''],
    ...(generates
      ? ([[`${input.scope}cli`, `^${input.cliVersion}`]] as const)
      : ([] as const)),
  ];
  // A package whose range no resolved manifest declares is **left out**, not
  // guessed at. The client adds it and reviews the range they chose, which is
  // one line of work; a range this command invented would be in their manifest
  // forever with nobody's judgement behind it.
  return wanted
    .filter(([, range]) => range.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
}

/**
 * The backend member's wiring — R1.4's whole population.
 *
 * Each file is the smallest expression that hands the platform something it
 * cannot derive: a database handle, a process's argv, a port, **a root
 * directory**. Every symbol named below is on a subpath the platform's
 * `exports` map declares. A symbol that exists nowhere is not written at all:
 * `backend/src/cli.ts` is §2.3's sixth wiring file and is reported as an
 * omission rather than rendered against a name somebody would have had to
 * invent for it.
 */
function backendWiring(input: PlanInput): readonly PlannedFile[] {
  const scope = input.scope;
  const files: PlannedFile[] = [];

  files.push({
    path: 'backend/src/index.ts',
    kind: 'wiring',
    member: 'backend',
    content: `// The API process. It reads the environment, composes, and listens.
import { fileURLToPath } from 'node:url';

import { buildServer, composeApp } from '${scope}platform/composition';

const port = Number(process.env['PORT'] ?? 3001);
const sessionCookieSecret = process.env['SESSION_COOKIE_SECRET'] ?? '';
if (sessionCookieSecret === '') {
  console.error('SESSION_COOKIE_SECRET must be set.');
  process.exit(1);
}

// The directory that holds \`apps/\` — this workspace's root, one level up from
// the backend member. It is the one thing the platform cannot derive for
// itself, and it is deliberately a required argument rather than a default that
// would silently name a directory holding no \`apps/\` at all.
const deploymentRoot = fileURLToPath(new URL('../..', import.meta.url));

const composition = await composeApp({ deploymentRoot });
const app = await buildServer({
  sessionCookieSecret,
  openApi: { title: '${input.name}', version: '0.0.0', serverUrl: \`http://localhost:\${port}\` },
  modules: composition.modules,
  errorEnvelope: composition.errorEnvelope,
  apiInterceptors: composition.apiInterceptors,
});

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await composition.dispose();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port, host: '0.0.0.0' });
`,
  });

  files.push({
    path: 'backend/src/worker.ts',
    kind: 'wiring',
    member: 'backend',
    content: `// The queue-consumer process (Principle X). Same composition, no listen.
import { fileURLToPath } from 'node:url';

import { buildServer, composeApp } from '${scope}platform/composition';

process.env['BACKEND_ROLE'] = 'worker';
const sessionCookieSecret = process.env['SESSION_COOKIE_SECRET'] ?? '';
if (sessionCookieSecret === '') {
  console.error('SESSION_COOKIE_SECRET must be set.');
  process.exit(1);
}

const deploymentRoot = fileURLToPath(new URL('../..', import.meta.url));

const composition = await composeApp({ deploymentRoot });
const app = await buildServer({
  sessionCookieSecret,
  openApi: { title: '${input.name} worker', version: '0.0.0', serverUrl: 'http://localhost' },
  modules: composition.modules,
  errorEnvelope: composition.errorEnvelope,
});

const shutdown = async (signal: string): Promise<void> => {
  await app.close();
  await composition.dispose();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
app.log.info('worker started');
`,
  });

  files.push({
    path: 'backend/src/mikro-orm.config.ts',
    kind: 'wiring',
    member: 'backend',
    content: `// The ORM configuration. It exists because a bin has none and cannot get one.
//
// The configuration itself is the platform's: the naming strategy Principle VI
// is enforced by, the Migrator extension \`getMigrator()\` needs, and the
// migration options an \`allOrNothing\` run takes. A hand-written
// \`defineConfig\` here would compile and then create tables the installed
// migrations do not name.
import {
  configuredEntitiesFrom,
  discoverConfiguredMigrations,
  mikroOrmConfigFrom,
} from '${scope}platform/db';

export default async function config() {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL must be set.');
  // The committed half is empty, which is what an instance is: it ships no
  // generated manifest index and no committed registry, so its entities and
  // its migrations are the packages it installed and nothing else.
  const [entities, migrations] = await Promise.all([
    configuredEntitiesFrom({ coreEntities: [] }),
    discoverConfiguredMigrations({ coreEntries: [], manifests: [] }),
  ]);
  return mikroOrmConfigFrom({ entities, migrations });
}
`,
  });

  files.push({
    path: 'backend/src/migrate.ts',
    kind: 'wiring',
    member: 'backend',
    content: `// The schema, in the order the installed manifests compute. MikroORM's own
// migrator over the configuration beside this file — no second ordering here.
import { MikroORM } from '@mikro-orm/postgresql';
import config from './mikro-orm.config.js';

const orm = await MikroORM.init(await config());
try {
  await orm.getMigrator().up();
} finally {
  await orm.close(true);
}
`,
  });

  // §2.3's sixth wiring file — the operator CLI
  // (`specs/123-oss-install-experience/` G2, T2-C). Five lines, because the
  // dispatch is `<scope>platform/cli`'s: argv, the demo verbs, the system scope
  // over the composed container and the exit code. What this file supplies is
  // the one thing no package can derive — the directory holding `apps/` — and
  // that is R1.4's definition of wiring.
  files.push({
    path: 'backend/src/cli.ts',
    kind: 'wiring',
    member: 'backend',
    content: `// Your modules' operator commands. \`pnpm run cli --list\` shows every one.
import { fileURLToPath } from 'node:url';
import { runCli } from '${scope}platform/cli';

await runCli({ deploymentRoot: fileURLToPath(new URL('../..', import.meta.url)) });
`,
  });

  // The five `module:*` entry points' shared half, and it is fourteen lines
  // rather than ninety since `fix/instance-wiring-operator-runtime`. The
  // manifest resolution over three suppliers, the memoised `MikroORM` + `Redis`
  // open, the system scope and the exit code are
  // `<scope>platform/lifecycle`'s `runInstanceOperatorCommand`; what this file
  // supplies is the two values that genuinely name a path in the tree that
  // installs the platform — the directory holding `apps/`, and this instance's
  // own ORM configuration — and that is R1.4's definition of wiring. The
  // ninety-line version was more than a third of the whole 250-line budget and
  // is what A14 refused in `registry` mode.
  files.push({
    path: 'backend/src/module-commands/runtime.ts',
    kind: 'wiring',
    member: 'backend',
    content: `// The one OperatorRuntime the five commands beside this file share.
import { fileURLToPath } from 'node:url';

import { runInstanceOperatorCommand } from '${scope}platform/lifecycle';
import type { OperatorRuntime } from '${scope}platform/lifecycle';
import config from '../mikro-orm.config.js';

// The directory that holds \`apps/\` — the same value \`index.ts\` hands
// \`composeApp\`, two levels up from the compiled command rather than one.
const deploymentRoot = fileURLToPath(new URL('../../..', import.meta.url));

/** Build the runtime, run one command inside a system scope, close, exit. */
export function runOperatorCommand(
  run: (argv: readonly string[], rt: OperatorRuntime) => Promise<number>,
): Promise<never> {
  return runInstanceOperatorCommand({ deploymentRoot, ormConfig: config, run });
}
`,
  });

  for (const command of ['install', 'uninstall', 'enable', 'disable', 'status'] as const) {
    const runner = `run${command[0]!.toUpperCase()}${command.slice(1)}Command`;
    files.push({
      path: `backend/src/module-commands/${command}.ts`,
      kind: 'wiring',
      member: 'backend',
      content: `import { ${runner} } from '${scope}platform/lifecycle';
import { runOperatorCommand } from './runtime.js';

await runOperatorCommand(${runner});
`,
    });
  }

  return files;
}

/**
 * The README's command block — every root script, in the order a client meets
 * them, each with what it is for (feature 122 T003).
 *
 * The **set** is the manifest's, not this list's: a name here that the run did
 * not declare contributes no line, and a script the run declared with no entry
 * here is a hole the reconciliation in `test/new-instance.test.ts` reports.
 * That is the only relationship a second enumeration may have with the first
 * (D-100) — this one carries the *order* and the *sentence*, and nothing else.
 *
 * The three per-layer builds carry one sentence between them and it is the
 * whole of D-230: the backend, the admin and the storefront are deployed to
 * hosts of their own, so each is built by a command of its own.
 */
const README_COMMANDS: readonly (readonly [script: string, argument: string, note: string])[] = [
  // `specs/125-first-mile-install/` FR-108…FR-110, and the order is the order a
  // client meets them: the services first, because everything under them needs
  // one; the composite second, because it is what four of the lines below add
  // up to; and `preview:admin` beside `start`, because a built bundle nobody
  // can look at was baseline step D1.
  ['dev:services', '', 'PostgreSQL, Redis, Meilisearch and a mail catcher, from\n`compose.dev.yml` beside this file. It waits for each one to\nreport healthy'],
  ['dev:services:down', '', 'stops them, keeping their data'],
  ['setup', '', 'generate, build, migrate and install every module — the four\nsteps below, in one line. Each still exists on its own'],
  ['generate', '', 'the files the admin and the docs site are built from,\nand your deployment\'s divergence report'],
  ['build', '', 'the entry points, compiled, and every member built'],
  ['build:backend', '', 'one layer at a time. Each of the three is deployed on its own\nhost, on its own schedule, so each is built on its own too'],
  ['build:admin', '', ''],
  ['build:docs', '', ''],
  ['migrate', '', 'the schema, in the order the manifests compute'],
  ['module:install', ' --all', 'every module you declared, in dependency order'],
  ['start', '', 'the API'],
  ['preview:admin', '', 'the admin bundle you just built, served on its own port'],
  ['dev', '', 'the API, rebuilt and restarted as you edit your overlay'],
  ['module:status', '', 'what is installed, and what the operator has switched on'],
  ['module:enable', ' <id>', 'the operator\'s switch. A module that is off behaves as\nthough it were never installed'],
  ['module:disable', ' <id>', ''],
  ['module:uninstall', ' <id>', 'the reverse of `module:install`'],
  // `specs/123-oss-install-experience/` G2. `admin:create` is conditional on
  // `admin_users` being installed, which the filter below already handles: this
  // table is annotations, and which of them survive is the manifest's answer.
  ['admin:create', ' -- --email=…', 'the administrator you sign in as. Nothing else creates one'],
  ['cli', ' --list', 'every operator command your installed modules declare.\nRun one as `pnpm run cli <module> <command>`'],
];

/** The block itself, aligned, over the scripts this run declared. */
function commandBlock(scripts: Readonly<Record<string, string>>): string {
  const rows = README_COMMANDS.filter(([script]) => scripts[script] !== undefined).map(
    ([script, argument, note]) => [`pnpm run ${script}${argument}`, note] as const,
  );
  const width = Math.max(...rows.map(([invocation]) => invocation.length)) + 3;
  return rows
    .map(([invocation, note]) => {
      if (note.length === 0) return invocation;
      const [first, ...rest] = note.split('\n');
      return [
        `${invocation.padEnd(width)}# ${first!}`,
        ...rest.map((line) => `${''.padEnd(width)}# ${line}`),
      ].join('\n');
    })
    .join('\n');
}

/** The client's own README: what this tree is, and what maintains it. */
/**
 * The tree's own README — the client's, written once and never read by us
 * again.
 *
 * The "what is here" table is built from the members this run actually wrote,
 * not from a list: which members exist depends on what resolved (§2.4, §2.4a),
 * and a README naming a directory the command omitted is the first thing a
 * client would find wrong with their new tree.
 *
 * **The command block is the manifest's `scripts`, ordered and annotated** —
 * feature 122 T003. It used to be six lines of prose naming five of the twelve
 * scripts the manifest declares, so a client reading it could not learn that
 * `dev`, `module:status` or the per-layer builds exist. Both sides are now one
 * run's, reconciled in `test/new-instance.test.ts`: a script with no annotation
 * below is red rather than a line a client never sees.
 */
function readme(
  input: PlanInput,
  dependencyCount: number,
  scripts: Readonly<Record<string, string>>,
  members: { readonly admin: boolean; readonly docs: boolean },
): string {
  return `# ${input.name}

An Endora Commerce instance. It **composes** the platform; it is not a fork of it and holds a
copy of no part of it.

## What is here

| | |
| --- | --- |
| \`package.json\` | the module list. There is no other: the \`dependencies\` are what this instance composes, and the platform discovers them from \`node_modules\` at runtime |
| \`apps/${input.deployment}/\` | your deployment — your overlay modules, \`divergence.ts\` (what you declare) and \`divergence.generated.md\` (what is derived from it; commit it and read the diff) |
| \`backend/\` | the entry points: a process that listens, a process that consumes queues, an ORM configuration and the operator commands |
${members.admin ? '| `admin/` | the operator interface — the admin shell, mounted over the screens your modules ship |\n' : ''}${members.docs ? '| `docs/` | the documentation site — a page per module, written by the module that ships it |\n' : ''}
${String(dependencyCount)} packages are declared today. Every one of them is a dependency, so a
fix in any of them reaches you through \`pnpm update\` with no file in this tree edited.

## The commands this tree declares

\`\`\`
pnpm install
${commandBlock(scripts)}
\`\`\`

Your modules arrive as installed packages, and a package is installed by \`module:install\` and
by **no boot**: that command applies its migrations, reconciles its settings and runs its
install hook. Until it has run, \`start\` refuses and names the modules the platform requires.
Adding a module later is \`pnpm add\`, then \`pnpm run migrate\` and \`module:install\` again —
both are idempotent, so running them over a set that is already installed changes nothing.

## Changing what the platform does

Four seams before a fork, in order of cost: the EventBus, an API interceptor, a strategy port,
and \`ctx.di.decorate\` from your own overlay module in \`apps/${input.deployment}/modules/\`.
Decoration is the only way an instance changes a platform behaviour — there is no file to
shadow, because there is no file.

Whatever you reach for, \`pnpm run generate\` records it in
\`apps/${input.deployment}/divergence.generated.md\`: every seam you used, which module owns
the thing you changed, what that seam costs on the escalation ladder, and the sentence you
wrote about it in \`divergence.ts\`. A divergence with no sentence is reported; so is a
sentence describing a divergence that is gone.

A module you will never publish belongs in that directory. A module you intend to publish or
install into a second instance is a package: \`pnpm pack\`, then install the tarball. A
\`pnpm link\` is deliberately invisible to the platform's discovery, so it is neither.

## Next

\`endora new storefront <dir>\` writes the customer-facing storefront. It is a separate
repository on purpose: it shares two \`.env\` values with this tree and nothing else.
`;
}

// ── the admin member (§2.4) ─────────────────────────────────────────────────
//
// `contracts/instance-tree.md` §2.4 in full: *"`admin/index.html`,
// `admin/src/main.tsx`, `admin/vite.config.ts`, `admin/tailwind.config.ts`, the
// brand assets, the theme **overrides**, and the **generated** contribution
// registry and stylesheet enumeration (§2.6). Nothing else."*
//
// Two of those nouns no longer describe the tree and are written down here
// rather than discovered by the next reader.
//
//   * **`tailwind.config.ts` does not exist**, in this repository or anywhere
//     else: Tailwind v4 has no configuration file, and its `@theme` and
//     `@source` are CSS. What the member holds in its place is `src/index.css`
//     — the two imports and the override slot, which is §2.4's *"theme
//     overrides"* and `admin-stylesheet-composition.md` R3.1's.
//   * **`package.json` and `tsconfig.json` are not in §2.4's list** and a
//     workspace member is neither without them. §2.3 lists both for the backend;
//     the omission there is the list's rather than the design's.
//
// **The brand assets are not written**, and that is a decision rather than a
// gap: a logo, a favicon and a PWA icon set are exactly the values R2.5a says a
// command may not invent, and an instance that shipped ours would be wearing
// our name. The reference deployment's `public/` also carries the admin service
// worker, so `registerAdminServiceWorker` — which the shell exports and this
// entry point does **not** call — would register an asset the tree does not
// serve. A client drops their own files in `admin/public/` and links them from
// `index.html`, both of which are theirs.

/** What `planInstance` needs to know about §2.4 before it writes anything else. */
interface AdminMemberDecision {
  readonly written: boolean;
  readonly files: readonly PlannedFile[];
  /** The sentence printed under `omitted admin/`, or `null` when it is written. */
  readonly omission: string | null;
}

/**
 * The packages the admin member declares, each range read off a manifest this
 * run resolved (R2.5a) — or the names that had none.
 *
 * **It declares no module**, and that is R3.6: *"the set appears exactly once in
 * the written tree — the root manifest's `dependencies`"*. An instance is a
 * workspace whose root holds the module packages, so pnpm links them into the
 * root's `node_modules`, which is where this member's own resolution reaches
 * them. A second spelling here is the one disagreement nothing in a client's
 * tree could detect.
 *
 * What it does declare is what its **own two source files name**: the shell
 * `main.tsx` mounts, the design system `index.css` imports, React, and the
 * build tools. The ranges for those come off the shell's own manifest — its
 * `peerDependencies` are what a host that mounts it must resolve, and its
 * optional peers are the shell's statement about what kind of application a
 * host is.
 */
function adminMemberPackages(input: PlanInput): {
  readonly dependencies: readonly (readonly [string, string])[];
  readonly devDependencies: readonly (readonly [string, string])[];
  readonly missing: readonly string[];
} {
  const missing: string[] = [];
  const range = (name: string): string | null => {
    const found = input.adminRanges.get(name);
    if (found === undefined || found.length === 0 || found.startsWith('workspace:')) {
      missing.push(name);
      return null;
    }
    return found;
  };
  const dependencies = new Map<string, string>([
    [`${input.scope}admin-kit`, `^${input.adminKitVersion ?? ''}`],
    [`${input.scope}admin-shell`, `^${input.adminShellVersion ?? ''}`],
  ]);
  const devDependencies: (readonly [string, string])[] = [
    [`${input.scope}cli`, `^${input.cliVersion}`],
  ];
  for (const name of ['react', 'react-dom'] as const) {
    const declared = range(name);
    if (declared !== null) dependencies.set(name, declared);
  }
  // Nothing else. What the **installed modules** declare optional is the root
  // manifest's, for the reason written beside it there: pnpm resolves a peer
  // from the dependent's context, and their dependent is the root.
  // `typescript` is the CLI's own (R2.3's first named source), exactly as the
  // backend member's is; the four build tools are the shell's optional peers.
  const typescript = input.declaredRanges.get('typescript');
  if (typescript === undefined || typescript.length === 0) missing.push('typescript');
  else devDependencies.push(['typescript', typescript]);
  for (const name of ['@tailwindcss/vite', '@vitejs/plugin-react', 'tailwindcss', 'vite'] as const) {
    const declared = range(name);
    if (declared !== null) devDependencies.push([name, declared]);
  }
  return {
    dependencies: [...dependencies].sort(([a], [b]) => a.localeCompare(b)),
    devDependencies: devDependencies.sort(([a], [b]) => a.localeCompare(b)),
    missing,
  };
}

/**
 * The four the admin member declares as `devDependencies` rather than as
 * dependencies, because they build the bundle and are not in it.
 *
 * They reach this command as the admin shell's own optional peers — its
 * statement that a host which mounts it is a Vite application compiled with
 * Tailwind v4 — and that is one set, whichever block a consumer files each
 * member under.
 */
const BUILD_TOOL_PEERS: ReadonlySet<string> = new Set([
  '@tailwindcss/vite',
  '@vitejs/plugin-react',
  'tailwindcss',
  'vite',
]);

/**
 * §2.4a, decided and rendered — or omitted, in the admin member's own grammar.
 *
 * **Why a member at all.** `instance-tree.md` §2.6 lists the documentation
 * registry among the three artefacts an instance generates and §2 listed no
 * member that would hold it, so the `.gitignore` this command writes has named
 * `docs/sidebars.modules.generated.js` since the command landed and nothing
 * wrote a site for it. A client installs thirty module packages, each shipping
 * its own `docs/` layer in its tarball, and until this member existed there was
 * nowhere for a human to read one.
 *
 * **Why an omission and not a refusal**, exactly as for the admin member: the
 * owner's subject is a backend instance, and a command that refused to write one
 * until Docusaurus had a range would be a command nobody could use. And **why
 * not silence**: a client who does not know they have no documentation site goes
 * looking for one.
 *
 * **Four files and no `tsconfig.json`.** The configuration and the sidebar are
 * `.js` rather than `.ts` — Docusaurus reads both — which is what keeps the
 * member off `@docusaurus/tsconfig`, `@docusaurus/types` and
 * `@docusaurus/module-type-aliases`, three more ranges this command would have
 * to find a source for in order to write a file whose whole content is two
 * objects. `sidebars.js` is also the name `resolveDocsLayout` looks for.
 */
function docsMember(input: PlanInput): AdminMemberDecision {
  const missing = ['@docusaurus/core', '@docusaurus/preset-classic'].filter((name) => {
    const range = input.docsRanges.get(name);
    return range === undefined || range.length === 0 || range.startsWith('workspace:');
  });
  if (missing.length > 0) {
    return {
      written: false,
      files: [],
      omission:
        `no manifest this run resolved declares a range for ${missing.join(', ')}, and the ` +
        `documentation site is built with ${missing.length === 1 ? 'it' : 'them'}. A range ` +
        `this command chose would be a value nobody reviewed, so none is written and the ` +
        `pages your module packages ship have no site to be read in`,
    };
  }
  return { written: true, files: docsFiles(input), omission: null };
}

/** The four files §2.4a's member is, in the order the plan writes them. */
function docsFiles(input: PlanInput): readonly PlannedFile[] {
  return [
    {
      path: 'docs/package.json',
      kind: 'derived',
      member: 'docs',
      content: json({
        name: `${input.name}-docs`,
        private: true,
        scripts: {
          // `endora generate` first, for the reason the admin member's `build`
          // runs it first: Docusaurus is a static build, so a navigation that
          // is stale or absent is a site with pages missing, and
          // `onBrokenLinks: 'throw'` turns the *absent* half into a crash
          // rather than a silence — which is the better of the two failures and
          // still not one a client should have to meet.
          generate: 'endora generate',
          dev: 'endora generate && docusaurus start',
          build: 'endora generate && docusaurus build',
          serve: 'docusaurus serve',
        },
        dependencies: {
          '@docusaurus/core': input.docsRanges.get('@docusaurus/core')!,
          '@docusaurus/preset-classic': input.docsRanges.get('@docusaurus/preset-classic')!,
        },
        devDependencies: { [`${input.scope}cli`]: `^${input.cliVersion}` },
      }),
    },
    {
      path: 'docs/docusaurus.config.js',
      kind: 'client',
      member: 'docs',
      content: docsConfig(input),
    },
    {
      path: 'docs/sidebars.js',
      kind: 'client',
      member: 'docs',
      content: docsSidebar(),
    },
    {
      path: 'docs/docs/intro.md',
      kind: 'client',
      member: 'docs',
      content: docsIntro(input),
    },
  ];
}

/**
 * The site's configuration — the client's, in the sense `admin/vite.config.ts`
 * is theirs: build-tool configuration they will edit.
 *
 * Three values are load-bearing rather than decorative. `onBrokenLinks: 'throw'`
 * is what makes a navigation entry naming a page that is not there fail the
 * build instead of serving a 404 nobody notices — it is the property feature
 * 100's own `build:docs` job exists for. The docs plugin declares **no**
 * `path`, so the content root is Docusaurus's own `docs/`, which is where
 * `endora generate` puts the pages your modules ship. And `routeBasePath: '/'`
 * makes the documentation the site rather than a section of one: an instance's
 * documentation site has nothing else in it.
 */
function docsConfig(input: PlanInput): string {
  return `// @ts-check
// The documentation site of this instance. Yours to brand and to extend — the
// title, the URL and the navbar below are values nobody but you can supply.
//
// What you should not remove:
//
//   * \`onBrokenLinks: 'throw'\` — a navigation entry naming a page that is not
//     there fails the build instead of serving a 404 nobody notices;
//   * the docs plugin's absent \`path\` — the content root is Docusaurus's own
//     \`docs/\`, which is where \`endora generate\` copies the pages your module
//     packages ship.

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: '${input.name} documentation',
  tagline: 'Every module this instance installed, documented by the module that ships it.',
  url: 'https://example.com',
  baseUrl: '/',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  favicon: undefined,
  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.js',
          routeBasePath: '/',
        },
        blog: false,
      },
    ],
  ],
  themeConfig: {
    navbar: {
      title: '${input.name}',
      items: [{ type: 'docSidebar', sidebarId: 'main', position: 'left', label: 'Documentation' }],
    },
  },
};

module.exports = config;
`;
}

/**
 * The navigation — the client's own, with one generated category in it.
 *
 * It is `admin/src/index.css`'s shape rather than `admin/src/main.tsx`'s: the
 * file is yours, and one line of it names a file a generator writes. Everything
 * you add goes beside \`'intro'\`; nothing you add has to know that the Modules
 * category is derived.
 */
function docsSidebar(): string {
  return `// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  main: [
    'intro',
    {
      type: 'category',
      label: 'Modules',
      link: { type: 'generated-index', title: 'Modules' },
      // Generated by \`endora generate\` over the module packages THIS instance
      // installed, and not committed: a different module set is a different
      // navigation. Run \`pnpm run generate\` before the first build.
      items: require('./sidebars.modules.generated.js'),
    },
  ],
};

module.exports = sidebars;
`;
}

/** The page the site opens on. Yours from the first word. */
function docsIntro(input: PlanInput): string {
  return `---
title: ${input.name}
sidebar_label: Start here
slug: /
---

# ${input.name}

This is your instance's documentation site. Everything under **Modules** is
written by the module that ships it and copied in by \`pnpm run generate\`, so a
module you install brings its own pages and a module you remove takes them with
it. Nothing under that category is yours to edit — the next \`generate\` undoes
it.

Everything else is yours. Write your own operating notes beside this page and
add them to \`sidebars.js\`.
`;
}


/**
 * §2.4, decided and rendered — or omitted, in `new storefront`'s own grammar.
 *
 * **Why an omission and not a refusal**, unchanged from the build that wrote no
 * admin at all: *"the owner's subject is a backend instance, and a command that
 * refused to write one until an unrelated package existed would be a command
 * nobody could use to find out whether any of this works."* **Why not silence**:
 * `instance-repository.md` R8.2's reasoning one surface over — a client who does
 * not know they have no operator interface spends their first hour looking for
 * one.
 *
 * There are now two ways to reach that omission and they are reported apart,
 * because the remedies are different: a build in which the shell or the design
 * system does not resolve, and a build in which one of them does and a range its
 * own manifest should have declared is not there. The second is R2.5a — *"a
 * value the tool invented is a value nobody reviewed"* — and naming the range
 * is what makes it actionable rather than mysterious.
 */
function adminMember(input: PlanInput): AdminMemberDecision {
  const absent = [
    ...(input.adminShellVersion === null ? [`${input.scope}admin-shell`] : []),
    ...(input.adminKitVersion === null ? [`${input.scope}admin-kit`] : []),
  ];
  if (absent.length > 0) {
    return {
      written: false,
      files: [],
      omission:
        `${absent.join(' and ')} ${absent.length === 1 ? 'does' : 'do'} not resolve at the ` +
        `version being installed, and the admin member is mounted on ${
          absent.length === 1 ? 'it' : 'them'
        }; an instance scaffolded now is a headless API`,
    };
  }
  const packages = adminMemberPackages(input);
  if (packages.missing.length > 0) {
    return {
      written: false,
      files: [],
      omission:
        `no manifest this run resolved declares a range for ${packages.missing.join(', ')}, ` +
        `and the admin member cannot be built without ${
          packages.missing.length === 1 ? 'it' : 'them'
        }. A range this command chose would be a value nobody reviewed, so none is written ` +
        `and an instance scaffolded now is a headless API`,
    };
  }
  return { written: true, files: adminFiles(input, packages), omission: null };
}

/** The six files §2.4's member is, in the order the plan writes them. */
function adminFiles(
  input: PlanInput,
  packages: ReturnType<typeof adminMemberPackages>,
): readonly PlannedFile[] {
  return [
    {
      path: 'admin/package.json',
      kind: 'derived',
      member: 'admin',
      content: json({
        name: `${input.name}-admin`,
        private: true,
        type: 'module',
        scripts: {
          // `endora generate` renders §2.6's two artefacts over the packages
          // this instance installed, and `build` runs it first for the reason
          // both artefacts exist: Vite and Tailwind are static, so a stale or
          // absent registry is a bundle with screens missing and a stylesheet
          // with classes missing, neither of which fails loudly.
          generate: 'endora generate',
          dev: 'endora generate && vite',
          build: 'endora generate && vite build',
          preview: 'vite preview',
          typecheck: 'tsc --noEmit',
        },
        dependencies: Object.fromEntries(packages.dependencies),
        devDependencies: Object.fromEntries(packages.devDependencies),
      }),
    },
    {
      path: 'admin/tsconfig.json',
      kind: 'client',
      member: 'admin',
      content: json({
        compilerOptions: {
          target: 'ES2023',
          lib: ['DOM', 'DOM.Iterable', 'ES2023'],
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'react-jsx',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          types: ['vite/client'],
          baseUrl: '.',
          // The `"@/*"` alias is how `endora generate` finds this project: both
          // artefacts land in the source root of the workspace member that
          // declares it, which is the derivation `check:admin-surface` and
          // `check:admin-zones` already share. Renaming it moves the artefacts;
          // deleting it leaves the generator with no project to write to.
          paths: { '@/*': ['./src/*'] },
        },
        include: ['src'],
      }),
    },
    {
      path: 'admin/index.html',
      kind: 'client',
      member: 'admin',
      content: adminIndexHtml(input),
    },
    {
      path: 'admin/vite.config.ts',
      kind: 'client',
      member: 'admin',
      content: adminViteConfig(),
    },
    {
      path: 'admin/src/main.tsx',
      kind: 'wiring',
      member: 'admin',
      content: `import { createRoot } from 'react-dom/client';
import { AdminRoot } from '${input.scope}admin-shell';
import { MODULE_ADMIN_CONTRIBUTIONS } from './modules.generated.js';
import './index.css';

const root = document.getElementById('root');
if (root === null) throw new Error('index.html has no #root to mount into.');

createRoot(root).render(<AdminRoot contributions={MODULE_ADMIN_CONTRIBUTIONS} />);
`,
    },
    {
      path: 'admin/src/index.css',
      kind: 'client',
      member: 'admin',
      content: adminStylesheet(input),
    },
  ];
}

/** The document the bundle mounts into — the client's, and the client's to brand. */
function adminIndexHtml(input: PlanInput): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <!-- An operator interface is not a public page. -->
    <meta name="robots" content="noindex, nofollow" />
    <title>${input.name} — Admin</title>
    <!--
      This file is yours. A favicon, a web app manifest, your own fonts and
      your own <meta> all go here, and the files they name go in \`public/\`.
      The scaffold writes none of them: a logo is exactly the value a tool may
      not invent for you.
    -->
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

/**
 * The build, which is Vite's business and therefore the client's file.
 *
 * Two plugins and a port. `@tailwindcss/vite` is what compiles `index.css`, and
 * without it every class in this admin is an unrecognised token — silently,
 * which is the failure `admin-stylesheet-composition.md` is about.
 */
function adminViteConfig(): string {
  return `import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  // \`loadEnv(mode, cwd, '')\` — the empty prefix lets this file read an
  // unprefixed variable such as \`PORT\`. Only \`VITE_*\` reaches the bundle.
  const env = loadEnv(mode, process.cwd(), '');
  const port = Number(env['PORT']) || 3002;
  return {
    plugins: [react(), tailwindcss()],
    server: { port, strictPort: true },
    preview: { port, strictPort: true },
    // No source maps in a built admin: \`dist\` is served as static files, and a
    // \`.map\` beside a chunk is every module's screens, route guards and
    // permission codes, readable by anyone who can reach the app. A
    // reproduction runs \`pnpm run dev\`, which has them.
    build: { outDir: 'dist', sourcemap: false },
  };
});
`;
}

/**
 * The stylesheet — three imports and the override slot, in that order
 * (`admin-stylesheet-composition.md` R2.3, R3.1, R3.4).
 *
 * The order is the whole mechanism: Tailwind first, the design system's tokens
 * and classes second, the installed packages' `@source` declarations third, and
 * this deployment's redeclarations **last**, so a later rule wins over the
 * package's default. Each semantic token is an indirection, so a utility the
 * design system's own build never saw still resolves against the `:root` below.
 */
function adminStylesheet(input: PlanInput): string {
  return `@import "tailwindcss";

/*
 * The admin's design system — its tokens **and** its class vocabulary. It is a
 * package's, not this project's: a copy of it here would be a fork frozen on
 * the day you scaffolded, and a module release adding one class would render
 * unstyled in this instance with no diagnostic anywhere.
 *
 * Change a token by redeclaring it in the slot at the bottom of this file, and
 * a class by writing a later rule there. Never by editing the package.
 */
@import "${input.scope}admin-kit/theme.css";

/*
 * The packages this admin composes, each declaring its own sources.
 *
 * Generated by \`pnpm run generate\` (\`endora generate\`) over the packages this
 * instance installed, and git-ignored: which packages those are is a fact about
 * the install rather than about this tree. Tailwind is a static scan and says
 * nothing about a source that matches nothing, so a package that is not scanned
 * loses every utility class only it declares — silently. Here the failures are
 * loud instead: a package that is not installed is \`Can't resolve\`, and one
 * whose tarball omits the file is \`ERR_PACKAGE_PATH_NOT_EXPORTED\`.
 */
@import "./tailwind.generated.css";

/*
 * Your overrides go here, last. A \`:root\` line for a token, an ordinary rule
 * for a class. This slot is empty rather than absent: your first edit is a line
 * below this comment, and nothing above it is yours to change.
 */
`;
}
