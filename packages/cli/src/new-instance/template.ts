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
 * The backend member's wiring names four symbols the platform publishes on
 * `./composition` and `./db`. `composeApp` is one of them since T118 — the
 * position §2.3 stated (*"`composeApp` is imported, never written (R1.2)"*) is
 * met, and the file below supplies the one argument that composition takes:
 * `deploymentRoot`, the directory holding `apps/`, which no package can derive
 * because in an instance the platform came out of `node_modules`
 * (`contracts/application-root-supplier.md` R1.1). **No contribute callback is
 * supplied and there is nowhere in this tree to write one** — R2.4 — so a
 * client's instance contributes over no name a module defaults.
 *
 * `configuredMigrations`, `configuredEntities` and `resolvedManifestEntries`
 * are `./db`'s and `./lifecycle`'s under other names; the ORM configuration
 * below is the one place an instance restates its own artefacts, and it has
 * none, so the platform's `*From` factories answer over the packages it
 * installed.
 *
 * §2.3's sixth wiring file, `backend/src/cli.ts`, is a different case and is
 * **not written**. T117 has since landed and the *dispatcher* now has an
 * address — `<scope>platform/cli` carries the enumeration, the lookup and the
 * find-gate-invoke — but the entry point around it still names surface the
 * platform's `exports` map does not declare: the demo layer, which feature 113
 * Phase 0 deliberately left unpublished pending an argument of its own. So the
 * omission stands on a narrower reason than the one written here first, and
 * rendering a file against a name somebody would have had to invent for it is
 * still exactly what R2.5a refuses.
 */
import { INSTANCE_BUILD_INPUTS, type InstanceBuildInput } from '../lib/instance-build-inputs.js';
import { InstanceInputError } from './host.js';

/** §1.1's three kinds, and there is no fourth. */
export type FileKind = 'client' | 'wiring' | 'derived';

/** Which member of the workspace a file belongs to, or the workspace root. */
export type MemberName = 'root' | 'deployment' | 'backend' | 'admin';

/** One file the command would write. */
export interface PlannedFile {
  /** Relative to the target directory, with `/` separators. */
  readonly path: string;
  readonly kind: FileKind;
  readonly member: MemberName;
  readonly content: string;
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
  readonly platformVersion: string;
  readonly enginesNode: string;
  readonly packageManager: string | undefined;
  /** The resolved module set: id -> npm name and version. */
  readonly modules: readonly { readonly id: string; readonly packageName: string }[];
  /** `null` when the admin shell does not resolve at the version being installed. */
  readonly adminShellVersion: string | null;
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

/** The two derived artefacts an instance generates and commits none of (§2.6). */
export const GENERATED_ARTEFACTS = [
  'admin/src/modules.generated.ts',
  'docs/sidebars.modules.generated.js',
] as const;

/** Lines of wiring in a plan — R1.4's bound, measured rather than intended. */
export function wiringLineCount(plan: InstancePlan): number {
  return plan.files
    .filter((file) => file.kind === 'wiring')
    .reduce((total, file) => total + file.content.split('\n').length, 0);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** `.env.example` — one entry per `INSTANCE_BUILD_INPUTS` member (§2.1). */
export function envExample(inputs: readonly InstanceBuildInput[]): string {
  const lines = [
    '# The per-instance build inputs. Every one is yours to set: this file is an example and',
    '# `.env` is git-ignored, so nothing here is a value anybody but you chose.',
    '#',
    '# An entry with no value on the right of the `=` is one the platform has no honest',
    '# default for — the declaration says so, and the refusal belongs to whatever reads it.',
  ];
  for (const input of inputs) {
    lines.push('', `# ${input.meaning}`, `# example: ${input.example}`);
    lines.push(`${input.name}=${input.default ?? ''}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The plan. Nothing here touches the filesystem, so `--dry-run` reports exactly
 * what a real run writes rather than a second derivation of it (R5.3).
 */
export function planInstance(input: PlanInput): InstancePlan {
  const files: PlannedFile[] = [];
  const omitted: PlannedOmission[] = [];

  const dependencies = new Map<string, string>();
  dependencies.set(`${input.scope}platform`, `^${input.platformVersion}`);
  for (const module of [...input.modules].sort((a, b) => a.id.localeCompare(b.id))) {
    dependencies.set(module.packageName, `^${input.platformVersion}`);
  }

  // §2.4 — the admin member. It is not written by this build, and its absence
  // is printed rather than silent for `instance-repository.md` R8.2's reason
  // one surface over: a member that is simply not there is indistinguishable
  // from one nobody asked for, and a client who does not know they have no
  // operator interface spends their first hour looking for one.
  // §2.3's host CLI dispatcher. Named rather than silently absent, for the
  // same reason the admin member is: a client who does not know a file is
  // missing spends their first hour looking for it.
  omitted.push({
    path: 'backend/src/cli.ts',
    reason:
      `the host CLI entry point names surface this build does not publish — the ` +
      `dispatcher itself is \`${input.scope}platform/cli\`, but the demo layer around it ` +
      `is exported under no subpath — and this command writes no file against a name it ` +
      `would have to invent. A module's own operator command is unavailable until it ` +
      `does; the five \`module:*\` commands are not, and are written`,
  });

  omitted.push({
    path: 'admin/',
    reason:
      input.adminShellVersion === null
        ? `${input.scope}admin-shell does not resolve at the version being installed; an ` +
          `instance scaffolded now is a headless API`
        : `${input.scope}admin-shell resolves at ${input.adminShellVersion}, and the member's ` +
          `file manifest is \`contracts/instance-tree.md\` §2.4's, which this build does not ` +
          `write; an instance scaffolded now is a headless API`,
  });

  // --- the workspace root (§2.1) -------------------------------------------
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
      scripts: {
        migrate: 'pnpm --filter backend run migrate',
        dev: 'pnpm --filter backend run dev',
        build: 'pnpm --filter backend run build',
        start: 'pnpm --filter backend run start',
        'module:install': 'pnpm --filter backend run module:install',
        'module:uninstall': 'pnpm --filter backend run module:uninstall',
        'module:enable': 'pnpm --filter backend run module:enable',
        'module:disable': 'pnpm --filter backend run module:disable',
        'module:status': 'pnpm --filter backend run module:status',
      },
      dependencies: Object.fromEntries([...dependencies].sort(([a], [b]) => a.localeCompare(b))),
      devDependencies: Object.fromEntries(devDependenciesFor(input)),
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
    content: envExample(INSTANCE_BUILD_INPUTS),
  });

  files.push({
    path: '.gitignore',
    kind: 'derived',
    member: 'root',
    content: [
      '# The generated artefacts. An instance generates them and commits none of them:',
      '# a different module set is a different bundle, and committing one makes this tree',
      '# and the install disagree.',
      ...GENERATED_ARTEFACTS,
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
    content: readme(input, dependencies.size),
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
      scripts: {
        // `tsc` and `node --watch` rather than `tsx`: no manifest this run can
        // read declares a range for `tsx`, and a range this command chose would
        // be a value nobody reviewed (R2.5a).
        dev: 'tsc -p tsconfig.json --watch & node --watch dist/index.js',
        build: 'tsc -p tsconfig.json',
        start: 'node dist/index.js',
        worker: 'node dist/worker.js',
        migrate: 'node dist/migrate.js',
        'module:install': 'node dist/module-commands/install.js',
        'module:uninstall': 'node dist/module-commands/uninstall.js',
        'module:enable': 'node dist/module-commands/enable.js',
        'module:disable': 'node dist/module-commands/disable.js',
        'module:status': 'node dist/module-commands/status.js',
      },
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

  return {
    files,
    omitted,
    members: ['root', 'deployment', 'backend'],
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
export function devDependenciesFor(input: PlanInput): readonly (readonly [string, string])[] {
  const wanted: readonly (readonly [string, string])[] = [
    ['@mikro-orm/core', input.declaredRanges.get('@mikro-orm/core') ?? ''],
    ['@mikro-orm/postgresql', input.declaredRanges.get('@mikro-orm/postgresql') ?? ''],
    ['@mikro-orm/migrations', input.declaredRanges.get('@mikro-orm/core') ?? ''],
    ['fastify', input.declaredRanges.get('fastify') ?? ''],
    ['zod', input.declaredRanges.get('zod') ?? ''],
    ['ioredis', input.declaredRanges.get('ioredis') ?? ''],
    ['typescript', input.declaredRanges.get('typescript') ?? ''],
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
import { defineConfig } from '@mikro-orm/postgresql';
import { configuredEntities, configuredMigrations } from '${scope}platform/composition';

export default async function config() {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL must be set.');
  return defineConfig({
    clientUrl: url,
    entities: await configuredEntities(),
    migrations: { migrationsList: (await configuredMigrations()).migrations },
  });
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

  files.push({
    path: 'backend/src/module-commands/runtime.ts',
    kind: 'wiring',
    member: 'backend',
    content: `// The one OperatorRuntime the five commands beside this file share.
import { MikroORM } from '@mikro-orm/postgresql';
import { Redis } from 'ioredis';
import { resolvedManifestEntries } from '${scope}platform/lifecycle';
import type { OperatorResources, OperatorRuntime } from '${scope}platform/lifecycle';
import config from '../mikro-orm.config.js';

export async function operatorRuntime(): Promise<OperatorRuntime> {
  let opened: OperatorResources | undefined;
  return {
    // Opened on first use: an invocation that answers out of argv or the
    // registry alone opens no connection at all.
    resources: async () => {
      if (opened) return opened;
      const orm = await MikroORM.init(await config());
      const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
      });
      opened = { orm, em: () => orm.em.fork(), redis };
      return opened;
    },
    entries: await resolvedManifestEntries(),
    out: (line) => void process.stdout.write(line),
    err: (line) => void process.stderr.write(line),
  };
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
import { operatorRuntime } from './runtime.js';

process.exitCode = await ${runner}(process.argv.slice(2), await operatorRuntime());
`,
    });
  }

  return files;
}

/** The client's own README: what this tree is, and what maintains it. */
function readme(input: PlanInput, dependencyCount: number): string {
  return `# ${input.name}

An Endora Commerce instance. It **composes** the platform; it is not a fork of it and holds a
copy of no part of it.

## What is here

| | |
| --- | --- |
| \`package.json\` | the module list. There is no other: the \`dependencies\` are what this instance composes, and the platform discovers them from \`node_modules\` at runtime |
| \`apps/${input.deployment}/\` | your deployment — your overlay modules, and \`divergence.ts\` |
| \`backend/\` | the entry points: a process that listens, a process that consumes queues, an ORM configuration and the operator commands |

${String(dependencyCount)} packages are declared today. Every one of them is a dependency, so a
fix in any of them reaches you through \`pnpm update\` with no file in this tree edited.

## Two commands maintain it

\`\`\`
pnpm install && pnpm run migrate    # the schema, in the order the manifests compute
pnpm run start                      # the API
\`\`\`

## Changing what the platform does

Four seams before a fork, in order of cost: the EventBus, an API interceptor, a strategy port,
and \`ctx.di.decorate\` from your own overlay module in \`apps/${input.deployment}/modules/\`.
Decoration is the only way an instance changes a platform behaviour — there is no file to
shadow, because there is no file.

A module you will never publish belongs in that directory. A module you intend to publish or
install into a second instance is a package: \`pnpm pack\`, then install the tarball. A
\`pnpm link\` is deliberately invisible to the platform's discovery, so it is neither.

## Next

\`endora new storefront <dir>\` writes the customer-facing storefront. It is a separate
repository on purpose: it shares two \`.env\` values with this tree and nothing else.
`;
}
