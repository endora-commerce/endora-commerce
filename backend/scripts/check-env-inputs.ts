/**
 * CI check — every environment value a running Endora reads is declared, and
 * every declared input is read. **Repository-scope host** over the relocated
 * analysis.
 *
 * The rule lives in `@endora-commerce/cli/rules/env-inputs.js`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6: one analysis,
 * two hosts). This file supplies the population — the three trees a running
 * Endora is made of, each with the declaration its own author ships — and the
 * refusals that keep a short walk from reading as a clean one.
 *
 * Usage: `tsx scripts/check-env-inputs.ts [--list]`
 * Exit 0 = every read is declared and every declaration is read; 1 = at least
 * one is not; 2 = the run could not see the population it judges.
 *
 * ## The population, and what is deliberately outside it
 *
 * Per consumer, the tree that runs: the backend's own sources plus the
 * platform's, the storefront's application sources, the admin's. **Test
 * sources are out**, and that is a decision rather than an omission: a
 * Playwright configuration reads `VR_CATEGORY_PATH` and `ADMIN_CMS_EDITOR_PATH`
 * to steer a visual-regression run, and declaring those would put a test knob
 * in the prompt a client's operator answers and in the `.env` their shop runs
 * on. The boundary is *what a served instance reads*, so a file that only a
 * test process ever loads is not in it.
 *
 * **Module packages are in, since Phase 3** (T3-B). Each one contributes its own
 * sources to the tree it runs in — a module's `src/admin/` and `src/admin-ui/`
 * are browser code and belong to the admin tree, everything else to the
 * backend's — and its own `env` declaration out of its `manifest.ts`. Until then
 * this run printed a `not judged: 74 module packages` line rather than passing
 * over them in silence; that line is gone because the walk answers for them.
 *
 * ## A module declares only what it owns, and a sibling's declaration is not its
 *
 * A read resolves against the platform's declaration, the application tree's,
 * and the **reading module's own** — never another module's
 * (`contracts/environment-inputs.md` §R2.2). That last clause is the one worth
 * stating: `MEILISEARCH_URL` is read by `search` and, independently, by
 * `health_checks`' liveness probe, which declares no dependency on `search` and
 * should not. If one module's declaration covered the other's read, a client who
 * installed `health_checks` alone would be short a variable this check had
 * reported green — and would meet it as a probe that says the platform is
 * degraded.
 *
 * The mirror of that rule is `module-declares-a-platform-input`: 7 of the 28
 * variables the module tree reads are the platform's, read by thirty modules
 * between them, and a module that declares what it *reads* rather than what it
 * *owns* puts one fact in thirty manifests (D-100).
 *
 * ## Why the declarations are read as text
 *
 * See `@endora-commerce/cli/rules/env-inputs.js` — importing an emitted
 * declaration would answer about the previous build (D-164), which is the
 * `stale-artefact` class `check:action-route-permissions` grew a refusal for
 * after three measured false greens. The `exports` subpath every *runtime*
 * reader takes is held open by `test/unit/packages/platform-env-subpath.test.ts`
 * instead, so nothing about it is unproven.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ENVIRONMENT_CONSUMERS,
  EnvironmentInputSchema,
  type EnvironmentConsumer,
  type EnvironmentInput,
} from '@endora-commerce/contracts';
import {
  checkEnvironmentInputs,
  collectEnvironmentReads,
  DeclarationUnreadableError,
  evaluateDeclarationArray,
  evaluateManifestEnvDeclaration,
  loadModuleVerdictShards,
  PREFIX,
  REMEDIES,
  type DeclarationSource,
  type EnvInputFindingKind,
  type EnvSourceFile,
} from '@endora-commerce/cli/rules/env-inputs.js';
import {
  nodeWorkspaceFs,
  workspaceMembers,
} from '@endora-commerce/cli/lib/workspace-packages.js';
import { UI_LAYER_DIRECTORIES } from '@endora-commerce/cli/lib/ui-layer.js';

import { adminHostRootsOf, AdminLayoutUnresolvableError } from './lib/admin-surfaces.js';
import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

/**
 * One tree a running Endora is made of, and where its declaration lives.
 *
 * The **member name** is what is written down, never a directory: a workspace
 * member that moved is followed, and one that is gone is exit 2 rather than a
 * consumer silently contributing nothing. The three names are the three values
 * of `ENVIRONMENT_CONSUMERS`, which is the contract package's enum and this
 * table's independent second author — a fourth tree makes this table short in
 * the same run it is added.
 */
interface ConsumerTree {
  readonly consumer: EnvironmentConsumer;
  /** The `name` its `package.json` declares. */
  readonly member: string;
  /** Directories under the member to walk, relative to it. `.` is the member. */
  readonly walk: readonly string[];
  /** Where the declaration is, relative to the member. */
  readonly declaration: string;
  /** The exported binding holding it. */
  readonly exportName: string;
}

const TREES: readonly ConsumerTree[] = [
  {
    consumer: 'backend',
    member: 'backend',
    // The platform's own sources are appended below, from the layout: they are
    // not under `backend/`, and they hold 5 of the 21 host inputs.
    walk: ['src'],
    // The platform declares the backend's inputs, because it is the platform
    // that reads them — `LOG_LEVEL` and `CORS_ALLOWED_ORIGINS` are read in
    // `packages/platform/src/http/`, not in `backend/src` at all.
    declaration: '',
    exportName: 'PLATFORM_ENVIRONMENT_INPUTS',
  },
  {
    consumer: 'storefront',
    member: 'storefront',
    walk: ['app', 'components', 'lib', '.'],
    declaration: 'environment-inputs.mjs',
    exportName: 'STOREFRONT_ENVIRONMENT_INPUTS',
  },
  {
    consumer: 'admin',
    member: 'admin',
    walk: ['src'],
    declaration: 'environment-inputs.mjs',
    exportName: 'ADMIN_ENVIRONMENT_INPUTS',
  },
];

/**
 * Directory names no tree's runtime reads live under.
 *
 * `test`, `e2e` and `__tests__` are the population boundary explained in the
 * header; the rest are not source at all.
 */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  '.next',
  '.git',
  'test',
  'tests',
  '__tests__',
  'e2e',
  'coverage',
  'public',
  'scripts',
]);

const SOURCE_FILE = /\.(tsx?|mtsx?|mjs|js)$/;

/**
 * The Settings-debt ledger's shards, one per module (FR-004).
 *
 * Exported so the companion test names the same directory this run reads; a
 * second spelling is a second answer to where the ledger is.
 */
export const SETTINGS_LEDGER_ROOT = new URL(
  './ledgers/module-environment-inputs/',
  import.meta.url,
).pathname;

/**
 * A file only a test or a build tool ever loads.
 *
 * Deliberately narrow, and it was measured wrong in the other direction first:
 * a blanket `*.config.*` exclusion took `backend/src/db/mikro-orm.config.ts` and
 * `storefront/next.config.js` out of the walk, which is where `DATABASE_URL`,
 * `DB_DEBUG` and the build-time refusal on `NEXT_PUBLIC_API_BASE_URL` are read
 * — three declared inputs reported as read by nobody, in the check whose second
 * direction exists to catch exactly that. A *runtime* configuration file is
 * runtime; what is out is the tooling that never runs in a served instance.
 */
const NOT_RUNTIME =
  /(\.test\.|\.spec\.|^playwright[.\w-]*\.config\.|^vitest\.config\.|^eslint\.config\.|^postcss\.config\.)/;

function walkFiles(directory: string, recurse: boolean, out: string[]): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!recurse || SKIPPED_DIRECTORIES.has(entry.name)) continue;
      walkFiles(path, true, out);
    } else if (SOURCE_FILE.test(entry.name) && !NOT_RUNTIME.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

const keyOf = (repoRoot: string, path: string): string =>
  relative(repoRoot, path).split(sep).join('/');

/**
 * Which tree a module's own file belongs to.
 *
 * A module package's `src/admin/` and `src/admin-ui/` are browser code —
 * `UI_LAYER_DIRECTORIES` is the one declaration of those names, already read by
 * the manifest generator and by `check:action-route-permissions` — and browser
 * code runs in the admin. Everything else a module ships runs in the backend.
 *
 * It is derived from that declaration rather than from the read's **dialect**,
 * which was the other candidate and is a heuristic: `import.meta.env` happens to
 * appear only in a module's UI layer today, and a rule keyed on it would be
 * answering "which bundler" when the question is "which tree an operator
 * configures". Zero module reads are the admin's on this tree, so the two agree
 * today and only one of them would keep agreeing.
 */
function moduleFileConsumer(moduleDirectory: string, path: string): EnvironmentConsumer {
  const relativePath = relative(moduleDirectory, path).split(sep).join('/');
  return UI_LAYER_DIRECTORIES.some(
    (layer) => relativePath === `src/${layer}` || relativePath.startsWith(`src/${layer}/`),
  )
    ? 'admin'
    : 'backend';
}

/** Exit 2 — the run could not see what it judges, which is not a verdict. */
function refuse(message: string): never {
  console.error(`${PREFIX} ${message}; refusing to report a vacuous pass`);
  process.exit(2);
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const layout = await requireModuleLayout(PREFIX);
  const { repoRoot } = layout;

  const workspace = workspaceMembers(repoRoot, nodeWorkspaceFs());
  const members = new Map(workspace.map((member) => [member.name, member.dir]));
  // Where the admin's own sources are — the project's and the shell package's
  // (feature 110, T122). Derived by the same function the two admin checks use,
  // so the three cannot come to disagree about which directories are the
  // admin's; its own refusals (no shell, two) reach this check as a throw and
  // are the honest verdict here too.
  let adminHostRoots: string[];
  try {
    adminHostRoots = [...adminHostRootsOf(workspace)];
  } catch (error: unknown) {
    // Refusal nine. The derivation's own refusals — no shell, or two — are the
    // honest verdict here as well, but only if they arrive as **exit 2**. Left
    // uncaught the throw exits **1** with a stack trace, which is this check
    // saying "the tree is in violation" about a population it could not locate:
    // issue #113's shape with the sign flipped, and the one state in which a
    // reader would go looking at the tree rather than at the run. Measured over
    // `moved-module-tree.test.ts`' fixture, which holds no admin shell.
    if (error instanceof AdminLayoutUnresolvableError) refuse(error.message);
    throw error;
  }

  const files: EnvSourceFile[] = [];
  /** Repository-relative key → the absolute path it was read from. */
  const absoluteOf = new Map<string, string>();
  const declarations: DeclarationSource[] = [];

  for (const tree of TREES) {
    const memberDir = members.get(tree.member);
    if (memberDir === undefined) {
      // Refusal one. A tree that is not a workspace member any more leaves its
      // declaration judged against nothing, and every input in it reading as
      // `unread-input` — a finding about the walk dressed as one about the tree.
      refuse(
        `the workspace declares no member named \`${tree.member}\`, so the ${tree.consumer} ` +
          'tree cannot be located',
      );
    }

    const declared = tree.walk.map((sub) => join(memberDir, sub));
    const roots =
      tree.consumer === 'backend'
        ? [
            ...declared,
            // The platform is a root of its own: it is not the application's
            // and not a module's, and 5 of the 21 host inputs are read inside
            // it. `platformRoot` is `null` only on a workspace with no member
            // declaring `endora.type: "platform"`, which this one is not.
            ...(layout.platformRoot === null ? [] : [layout.platformRoot]),
          ]
        : tree.consumer === 'admin'
          ? // The admin's own sources, wherever they are — the same shape the
            // backend has, one surface over (feature 110, T122). T120 moved the
            // router, the shell and every host screen into
            // `@endora-commerce/admin-shell`, and all three of the admin's
            // `import.meta.env` reads went with them: `VITE_API_BASE_URL` in
            // the federated sign-in, `VITE_BUILD_ID` in the service-worker
            // registration, `DEV` in two diagnostics. Left on the alias target
            // this tree contributes no read at all, which is refusal two above
            // — measured, on the merge request that moved them. The declaration
            // stays the admin project's, because a build input is the project's
            // and not the library's.
            adminHostRoots
          : declared;

    const before = files.length;
    for (const root of roots) {
      // `.` names the member's own directory and is walked one level deep:
      // `instrumentation.ts`, `middleware.ts` and `next.config.js` are runtime
      // sources at a Next application's root, and recursing from there would
      // pull in the trees the other entries name explicitly.
      const recurse = root !== memberDir;
      for (const path of walkFiles(root, recurse, [])) {
        const key = keyOf(repoRoot, path);
        // `_lifecycle`'s sources are the platform's, so the backend tree's walk
        // and the module walk below both reach them. One file is opened once, or
        // its reads are counted twice and `files=` describes no tree.
        if (absoluteOf.has(key)) continue;
        absoluteOf.set(key, path);
        files.push({
          path: key,
          text: readFileSync(path, 'utf8'),
          consumer: tree.consumer,
        });
      }
    }
    const opened = files.length - before;
    if (opened === 0) {
      // Refusal two — issue #215 over this population. A tree whose sources
      // stopped being found reads as a tree with nothing wrong in it, while the
      // other two keep the file count respectable.
      refuse(`the ${tree.consumer} tree contributed no source file`);
    }

    const declarationPath =
      tree.consumer === 'backend'
        ? layout.platformRoot === null
          ? null
          : join(layout.platformRoot, 'env', 'index.ts')
        : join(memberDir, tree.declaration);
    if (declarationPath === null) {
      refuse('this workspace declares no platform package, so the host inputs have no author');
    }

    let text: string;
    try {
      text = readFileSync(declarationPath, 'utf8');
    } catch {
      // Refusal three. Absent is never "this tree needs nothing": that is the
      // failure `manifest-locations.ts` was written to end, one surface over.
      refuse(
        `the ${tree.consumer} tree declares no inputs at ` +
          `${keyOf(repoRoot, declarationPath)} — a declaration that is not there is not a ` +
          'tree with no requirements',
      );
    }

    let raw: readonly unknown[];
    try {
      raw = evaluateDeclarationArray(text, keyOf(repoRoot, declarationPath), tree.exportName);
    } catch (error: unknown) {
      if (error instanceof DeclarationUnreadableError) refuse(error.message);
      throw error;
    }

    const inputs: EnvironmentInput[] = [];
    for (const entry of raw) {
      const parsed = EnvironmentInputSchema.safeParse(entry);
      if (!parsed.success) {
        // Refusal four. A declaration this run cannot read in full is one it
        // must not report on: the reconciliation below would silently be over
        // the entries that happened to parse.
        refuse(
          `${keyOf(repoRoot, declarationPath)} holds an entry this run cannot read as an ` +
            `environment input — ${parsed.error.issues
              .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
              .join('; ')}`,
        );
      }
      inputs.push(parsed.data);
    }
    if (inputs.length === 0) {
      refuse(`${keyOf(repoRoot, declarationPath)} declares no input at all`);
    }
    declarations.push({
      author:
        tree.consumer === 'backend'
          ? { kind: 'platform' }
          : { kind: 'application', application: tree.consumer },
      file: keyOf(repoRoot, declarationPath),
      inputs,
    });
  }

  // --- The module tree (Phase 3, T3-B). Every registered module contributes its
  // own sources and its own `env` declaration, on the same terms a core module,
  // an overlay module and an installed package all declare on.
  const moduleFileAbsolutePaths: string[] = [];
  const moduleOfKey = new Map<string, string>();
  for (const [moduleId, directory] of layout.moduleDirectories) {
    for (const path of walkFiles(directory, true, [])) {
      const key = keyOf(repoRoot, path);
      moduleFileAbsolutePaths.push(path);
      moduleOfKey.set(key, moduleId);
      if (absoluteOf.has(key)) continue;
      absoluteOf.set(key, path);
      files.push({
        path: key,
        text: readFileSync(path, 'utf8'),
        consumer: moduleFileConsumer(directory, path),
        module: moduleId,
      });
    }
  }
  // A file both walks reached — `_lifecycle`'s, whose sources are the platform's
  // — is the tree's for its consumer and the module's for its attribution. It is
  // rewritten rather than re-pushed, so it is opened once and judged once.
  for (const [index, file] of files.entries()) {
    if (file.module !== undefined) continue;
    const moduleId = moduleOfKey.get(file.path);
    if (moduleId === undefined) continue;
    files[index] = { ...file, module: moduleId };
  }

  // Refusal six — issue #215's shared floor over this population, and it matters
  // more here than in most checks: the three trees keep `files=` looking healthy
  // while the module half goes to zero, and with no module read at all every
  // module declaration reads as `unread-input` and no module read is undeclared.
  // A report entirely about the walk, wearing a report about the tree.
  const modulePopulation = await refuseVacuousModulePopulation({
    prefix: PREFIX,
    manifestIndexPath: layout.manifestIndexPath,
    files: moduleFileAbsolutePaths,
    moduleIdOf: layout.moduleIdOfPath,
  });

  for (const [moduleId, directory] of layout.moduleDirectories) {
    // A module package keeps its manifest at `src/manifest.ts`; a module whose
    // sources the host owns keeps it beside them. Both are probed, and neither
    // is written down as a convention a module has to follow: a module with no
    // manifest at either is refusal seven rather than a module that declares
    // nothing.
    const candidates = [join(directory, 'src', 'manifest.ts'), join(directory, 'manifest.ts')];
    const manifestPath = candidates.find((candidate) => existsSync(candidate));
    if (manifestPath === undefined) {
      refuse(
        `the registered module \`${moduleId}\` has no \`manifest.ts\` under ` +
          `${keyOf(repoRoot, directory)} — a module whose declaration this run cannot find is ` +
          'one it cannot report on, and "declares nothing" is not the same answer',
      );
    }

    let raw: readonly unknown[] | null;
    try {
      raw = evaluateManifestEnvDeclaration(
        readFileSync(manifestPath, 'utf8'),
        keyOf(repoRoot, manifestPath),
      );
    } catch (error: unknown) {
      if (error instanceof DeclarationUnreadableError) refuse(error.message);
      throw error;
    }
    if (raw === null || raw.length === 0) continue;

    const inputs: EnvironmentInput[] = [];
    for (const entry of raw) {
      const parsed = EnvironmentInputSchema.safeParse(entry);
      if (!parsed.success) {
        // Refusal eight, and the same reasoning as refusal four: a declaration
        // this run cannot read in full is one it must not report on.
        refuse(
          `${keyOf(repoRoot, manifestPath)} holds an \`env\` entry this run cannot read as an ` +
            `environment input — ${parsed.error.issues
              .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
              .join('; ')}`,
        );
      }
      inputs.push(parsed.data);
    }
    declarations.push({
      author: { kind: 'module', moduleId },
      file: keyOf(repoRoot, manifestPath),
      inputs,
    });
  }

  // The Settings-debt ledger (FR-004, `contracts/environment-inputs.md` §4).
  // Refusal ten: a directory that is not there would make every module-owned
  // declaration read as unjudged and every entry as describing nothing — two
  // confident findings out of one silence.
  let settingsVerdicts;
  try {
    settingsVerdicts = await loadModuleVerdictShards(SETTINGS_LEDGER_ROOT);
  } catch (error: unknown) {
    if (error instanceof DeclarationUnreadableError) refuse(error.message);
    throw error;
  }

  const reads = collectEnvironmentReads(files);
  if (reads.length === 0) {
    // Refusal five, and the one a careless implementation omits: #237's shape,
    // where the file count holds steady while the syntax walk goes blind. With
    // no read at all every declaration is `unread-input` and no read is
    // undeclared — a healthy `files=` beside a report that is entirely wrong.
    refuse('the walk classified no environment read at all across the three trees');
  }

  const result = checkEnvironmentInputs({ declarations, reads, settingsVerdicts });

  if (listMode) {
    for (const declaration of declarations) {
      const author =
        declaration.author.kind === 'module'
          ? declaration.author.moduleId
          : declaration.author.kind === 'application'
            ? declaration.author.application
            : 'platform';
      for (const entry of declaration.inputs) {
        console.log(
          `${entry.requirement.kind.padEnd(13)} ${entry.secret ? 'secret ' : '       '}` +
            `${entry.generable ? 'generable ' : '          '}${entry.name.padEnd(32)} ` +
            `[${entry.consumers.join(',')}] ${author}`,
        );
      }
    }
    console.log('');
  }

  reportReadSize({
    prefix: PREFIX,
    files: files.length,
    sites: reads.length,
    coverage: [
      {
        // The independent author: `ENVIRONMENT_CONSUMERS` is the contract
        // package's enum, written nowhere near this check and unmoved by
        // anything a declaration does. A consumer counts as covered only when
        // it both declares an input and contributed a read — the two halves of
        // being in this population — so losing either is a short walk rather
        // than a quiet one.
        source: 'declared-consumers',
        expected: ENVIRONMENT_CONSUMERS.length,
        covered: result.consumersCovered.length,
      },
      // The module half's independent author is the generated manifest index,
      // which neither this walk nor any declaration moves. It cannot be replaced
      // by the consumer token above: the backend tree alone satisfies that one,
      // and it is satisfied just as well by a run in which the module tree
      // contributed nothing at all.
      modulePopulation,
    ],
  });
  console.log(
    `${PREFIX} declared=${result.declared} (modules=${result.declaredByModules} in ` +
      `${result.modulesDeclaring.length} of ${layout.registeredIds.length} packages) ` +
      `reads=${reads.length} findings=${result.findings.length}`,
  );

  if (result.findings.length === 0) process.exit(0);

  const kinds = [...new Set(result.findings.map((finding) => finding.kind))].sort();
  for (const kind of kinds as EnvInputFindingKind[]) {
    console.error(`\n[${kind}]\n${REMEDIES[kind]}\n`);
    for (const finding of result.findings.filter((candidate) => candidate.kind === kind)) {
      console.error(`  - ${finding.name} (${finding.where})\n      ${finding.detail}`);
    }
  }
  process.exit(1);
}

// CLI only — importing this module (the companion test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}

export * from '@endora-commerce/cli/rules/env-inputs.js';
