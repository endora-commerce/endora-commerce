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
 * **Module packages are out too, and this run says so on its own line** rather
 * than passing over them. Their inputs are declared in `manifest.ts` and that
 * lands with this feature's Phase 3; until then, 28 module-owned variables are
 * judged by nothing, and a check that knew that and printed nothing would be
 * the silent skip the whole estate is against.
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
import { readdirSync, readFileSync, type Dirent } from 'node:fs';
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

/** Exit 2 — the run could not see what it judges, which is not a verdict. */
function refuse(message: string): never {
  console.error(`${PREFIX} ${message}; refusing to report a vacuous pass`);
  process.exit(2);
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const layout = await requireModuleLayout(PREFIX);
  const { repoRoot } = layout;

  const members = new Map(
    workspaceMembers(repoRoot, nodeWorkspaceFs()).map((member) => [member.name, member.dir]),
  );

  const files: EnvSourceFile[] = [];
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

    const roots =
      tree.consumer === 'backend'
        ? [
            ...tree.walk.map((sub) => join(memberDir, sub)),
            // The platform is a root of its own: it is not the application's
            // and not a module's, and 5 of the 21 host inputs are read inside
            // it. `platformRoot` is `null` only on a workspace with no member
            // declaring `endora.type: "platform"`, which this one is not.
            ...(layout.platformRoot === null ? [] : [layout.platformRoot]),
          ]
        : tree.walk.map((sub) => join(memberDir, sub));

    const before = files.length;
    for (const root of roots) {
      // `.` names the member's own directory and is walked one level deep:
      // `instrumentation.ts`, `middleware.ts` and `next.config.js` are runtime
      // sources at a Next application's root, and recursing from there would
      // pull in the trees the other entries name explicitly.
      const recurse = root !== memberDir;
      for (const path of walkFiles(root, recurse, [])) {
        files.push({
          path: keyOf(repoRoot, path),
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

  const reads = collectEnvironmentReads(files);
  if (reads.length === 0) {
    // Refusal five, and the one a careless implementation omits: #237's shape,
    // where the file count holds steady while the syntax walk goes blind. With
    // no read at all every declaration is `unread-input` and no read is
    // undeclared — a healthy `files=` beside a report that is entirely wrong.
    refuse('the walk classified no environment read at all across the three trees');
  }

  const result = checkEnvironmentInputs({ declarations, reads });

  if (listMode) {
    for (const declaration of declarations) {
      for (const entry of declaration.inputs) {
        console.log(
          `${entry.requirement.kind.padEnd(13)} ${entry.secret ? 'secret ' : '       '}` +
            `${entry.generable ? 'generable ' : '          '}${entry.name.padEnd(32)} ` +
            `[${entry.consumers.join(',')}]`,
        );
      }
    }
    console.log('');
  }

  // What this run did **not** judge, printed rather than waived. The count is
  // the generated manifest index's, so it moves with the tree and is written
  // down nowhere (D-100).
  console.log(
    `${PREFIX} not judged: ${layout.registeredIds.length} module packages — a module's ` +
      'environment inputs are declared in its `manifest.ts`, which lands with ' +
      '`specs/117-instance-bring-up/` Phase 3',
  );

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
    ],
  });
  console.log(
    `${PREFIX} declared=${result.declared} reads=${reads.length} ` +
      `findings=${result.findings.length}`,
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
