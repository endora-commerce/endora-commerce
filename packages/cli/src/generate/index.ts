/**
 * `endora generate` — the artefacts an instance builds from and commits none of
 * (`contracts/instance-repository.md` R3.2, `contracts/instance-tree.md` §2.6).
 *
 * ## Why the command exists
 *
 * An instance's admin project holds six files and imports two it does not have:
 * the contribution registry `main.tsx` hands the shell, and the stylesheet
 * enumeration `index.css` imports. Both are **facts about the process** — which
 * packages this client installed — so R3.1 says they are resolved at build time
 * and never committed, and R3.2 says Vite and Tailwind are static, so they have
 * to exist as files before either runs.
 *
 * Until this command existed the renderer lived in `backend/scripts`, which no
 * client can reach: the file manifest §2.4 writes was a tree that could not be
 * built. The renderer is `../lib/admin-artefacts.js`' now and is the **same**
 * program `composer:generate` runs over this repository's workspace members —
 * R3.5's *"one generator, one derivation … never a second implementation"*.
 *
 * ## It reports what it excluded (R8.2)
 *
 * A `link:`, a `file:` and a workspace member are invisible to the platform's
 * runtime discovery by design (§8 R8.1), and these artefacts apply the same
 * rule because they must: *"an admin registry naming a module the backend will
 * not compose is a nav entry that 404s"*. So every exclusion is printed with the
 * package name and the real path it resolved to. A module that is simply not
 * there is indistinguishable from a module nobody installed, and a client whose
 * screen never appeared has nothing to read.
 *
 * ## Exit codes are `cli-surface.md` §2's, unchanged
 *
 * **0** it did what it was asked, **1** a refusal the operator can act on, **2**
 * an input it could not read. An instance with no admin member is **1** and
 * names the remedy; a directory that is no workspace at all is **2**, because a
 * run that could not find the tree it was pointed at has said nothing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import {
  adminRegistryOutputPathIn,
  collectAdminContributions,
  collectTailwindSources,
  emitAdminRegistry,
  emitTailwindRegistry,
  tailwindRegistryOutputPathIn,
} from '../lib/admin-artefacts.js';
import { AdminLayoutUnresolvableError } from '../lib/admin-surfaces.js';
import {
  collectDocsIntoSiteFrom,
  docsRegistryOf,
  installedDocsModules,
  renderDocsSidebarFrom,
  renderModuleMapFrom,
  renderModuleReferencesFrom,
  type DocsCollection,
} from '../lib/docs-artefacts.js';
import { DocsLayoutUnresolvableError, resolveDocsLayout } from '../lib/module-docs.js';
import {
  scanInstalledModulePackages,
  type SkippedInstalledPackage,
} from '../lib/module-packages.js';
import {
  renderInstanceDivergence,
  DivergenceHostError,
  type InstanceDivergence,
} from './divergence.js';

/** A refusal the operator can act on — exit 1. */
export class GenerateInputError extends Error {
  override readonly name = 'GenerateInputError';
}

/** An input this run could not read — exit 2. */
export class GenerateHostError extends Error {
  override readonly name = 'GenerateHostError';
}

export interface GenerateOptions {
  /** Where the run was invoked. The instance root is found upwards from here. */
  readonly cwd?: string | undefined;
  /** Report what would be written, and write nothing. */
  readonly dryRun?: boolean | undefined;
}

/** One artefact this run rendered. */
export interface GeneratedArtefact {
  /** Absolute. */
  readonly path: string;
  readonly content: string;
  /** What it is, for the line the command prints. */
  readonly label: string;
}

export interface GenerateResult {
  /** The workspace root this run rendered for. */
  readonly root: string;
  readonly artefacts: readonly GeneratedArtefact[];
  /** How many installed module packages the population held. */
  readonly modules: number;
  /** R8.2 — every candidate the discovery excluded, with its reason. */
  readonly excluded: readonly SkippedInstalledPackage[];
  /**
   * A member this instance does not have, and therefore an artefact family this
   * run did not render — named rather than silently skipped.
   *
   * `instance-tree.md` §2.4's own reasoning: *"a client who does not know they
   * have no operator interface spends their first hour looking for one"*. The
   * same holds for a documentation site, and the member is legitimately absent
   * — `endora new instance` omits either one when the packages it is mounted on
   * do not resolve.
   */
  readonly omitted: readonly string[];
  /** What the documentation copy step did, or `null` when there is no site. */
  readonly collected: DocsCollection | null;
  /**
   * Reference pages this run removed because no installed module renders them
   * any more — the category's half of {@link GenerateResult.collected}.
   */
  readonly swept: readonly string[];
  /**
   * One divergence report per deployment this instance holds
   * (`specs/107-override-report-and-ladder/contracts/divergence-report.md`).
   *
   * **Unlike the other three families these are committed**, and the predicate
   * that decides it is §1's: an artefact is committed when its content is a fact
   * about the tree. Which packages a client installed is a fact about the
   * install; what their own overlay modules decorate is a fact about their
   * repository, and it is only worth having because it turns up in the merge
   * request that creates it.
   */
  readonly divergence: readonly InstanceDivergence[];
  readonly dryRun: boolean;
}

/**
 * The instance root: the nearest directory above `from` holding a
 * `pnpm-workspace.yaml`.
 *
 * Upwards, so the command works from the admin member as well as from the root
 * — `pnpm -C admin run generate` runs it with the member as its working
 * directory, and a client typing it in the directory they are editing is the
 * ordinary case.
 */
export function findInstanceRoot(from: string): string | null {
  let current = resolve(from);
  for (;;) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Render the instance's build artefacts, and write them unless this is a dry
 * run.
 *
 * Every artefact is rendered **before** any is written, in `new instance`'s own
 * discipline (R5.2): a half-written pair is a bundle that names modules the
 * stylesheet did not scan, which is the silent failure
 * `admin-stylesheet-composition.md` exists to remove.
 */
export async function runGenerate(options: GenerateOptions = {}): Promise<GenerateResult> {
  const cwd = options.cwd ?? process.cwd();
  const root = findInstanceRoot(cwd);
  if (root === null) {
    throw new GenerateHostError(
      `no \`pnpm-workspace.yaml\` above ${cwd}, so there is no instance to render artefacts ` +
        `for. This command renders the files an instance's admin project and documentation ` +
        `site are built from; run it inside the tree \`endora new instance\` wrote.`,
    );
  }

  const scan = scanInstalledModulePackages(root);
  if (scan.root === null) {
    throw new GenerateHostError(
      `${join(root, 'node_modules')} is not there, so which modules this instance installed ` +
        `cannot be read and the artefacts would name none. Run \`pnpm install\` first — an ` +
        `empty registry is a bundle with no screens in it, rendered without an error.`,
    );
  }

  const artefacts: GeneratedArtefact[] = [];
  const omitted: string[] = [];

  // --- the admin project's two (§2.6) --------------------------------------
  //
  // The project is found through the `"@/*"` tsconfig alias, exactly as every
  // other admin derivation in this estate finds it. A workspace with no such
  // member is an instance with no admin project, which is an **omission** and
  // not a refusal: `endora new instance` writes one only when the shell and the
  // design system resolve, so a headless instance is a tree this command must
  // still be able to serve.
  try {
    const contributions = collectAdminContributions(scan.packages);
    const sources = collectTailwindSources(root, scan.packages);
    artefacts.push(
      {
        path: adminRegistryOutputPathIn(root),
        content: emitAdminRegistry(contributions, GENERATED_REGISTRY_HEADER),
        label: `the admin contribution registry (${String(contributions.length)} module(s))`,
      },
      {
        path: tailwindRegistryOutputPathIn(root),
        content: emitTailwindRegistry(sources, GENERATED_STYLESHEET_HEADER),
        label: `the admin stylesheet enumeration (${String(sources.length)} package(s))`,
      },
    );
  } catch (error: unknown) {
    if (!(error instanceof AdminLayoutUnresolvableError)) throw error;
    omitted.push(
      `the admin project's two artefacts — ${error.message}. They land in the source root of ` +
        `the workspace member declaring the \`"@/*"\` path its tsconfig carries, so an instance ` +
        `scaffolded without an admin member has nothing here to write`,
    );
  }

  // --- the documentation site's (§2.6, feature 100) -------------------------
  //
  // The site is found by the workspace member holding a Docusaurus
  // configuration — the same derivation `check:module-docs` and
  // `composer:generate` share — and the population is the packages above, so a
  // navigation names exactly the modules this client installed. Same omission
  // discipline as the admin half.
  let collected: DocsCollection | null = null;
  let swept: readonly string[] = [];
  try {
    const layout = resolveDocsLayout(root);
    const registry = docsRegistryOf(layout, installedDocsModules(scan.packages), scan.packages);
    artefacts.push(
      {
        path: renderDocsSidebarFrom(registry, INSTANCE_DOCS_HEADER).outputPath,
        content: renderDocsSidebarFrom(registry, INSTANCE_DOCS_HEADER).content,
        label: `the documentation navigation (${String(registry.entries.length)} module(s))`,
      },
      {
        path: renderModuleMapFrom(registry, INSTANCE_DOCS_PAGE_HEADER).outputPath,
        content: renderModuleMapFrom(registry, INSTANCE_DOCS_PAGE_HEADER).content,
        label: 'the module map',
      },
    );
    // `stray: 'sweep'` because in an instance this category is generated and
    // git-ignored: a module the client uninstalled would otherwise leave a page
    // that refuses every subsequent run, with a remedy (`git rm`) naming a tool
    // the file is not under.
    const references = await renderModuleReferencesFrom(registry, {
      header: INSTANCE_DOCS_PAGE_HEADER,
      stray: options.dryRun === true ? 'report' : 'sweep',
    });
    for (const page of references.pages) {
      artefacts.push({ path: page.outputPath, content: page.content, label: page.label });
    }
    swept = references.swept;
    // The copies are a filesystem operation rather than a rendered artefact —
    // a module's page is copied verbatim, byte for byte — so it is not in the
    // list above and is skipped on a dry run with everything else.
    if (options.dryRun !== true) collected = collectDocsIntoSiteFrom(registry);
  } catch (error: unknown) {
    if (!(error instanceof DocsLayoutUnresolvableError)) throw error;
    omitted.push(
      `the documentation site's artefacts — ${error.message}. The site is the workspace member ` +
        `holding a Docusaurus configuration; an instance scaffolded without one has nothing ` +
        `here to write`,
    );
  }

  // --- the deployment's own (§2.2, feature 107) ---------------------------
  //
  // Not an `artefacts.push`, and the difference is the whole of the report
  // contract's §1: those three are `.gitignore`d facts about *this install* and
  // these are a committed fact about the client's own tree. Rendering them in
  // the same run is right — one walk of `node_modules` answers both — but
  // mixing them into one list would put a committed artefact under a header
  // telling its reader not to commit it.
  //
  // A deployment tree that is not there is an omission and not a refusal, in the
  // discipline the two members above already use: `endora new instance` writes
  // `apps/<deployment>/`, and a client who deleted it has said something.
  let divergence: readonly InstanceDivergence[] = [];
  try {
    divergence = renderInstanceDivergence({ root, packages: scan.packages });
    if (divergence.length === 0) {
      omitted.push(
        `the divergence report — this instance has no \`apps/<deployment>/\` tree, so there is ` +
          `no deployment whose divergence from core could be derived. \`endora new instance\` ` +
          `writes one`,
      );
    }
  } catch (error: unknown) {
    if (!(error instanceof DivergenceHostError)) throw error;
    // Exit 2, never a silent skip: the report's own §5 is one refusal per input
    // whose absence would make a predicate vacuously clean, and every one of
    // this half's inputs is of that kind — an unread composition reports every
    // decoration as owned by nobody.
    throw new GenerateHostError(error.message);
  }

  // No member and no deployment is a workspace this command has anything to do
  // with, and a run that wrote nothing and said it succeeded is the silent green
  // the whole estate refuses. It is a refusal the operator can act on — exit 1 —
  // because the remedy is theirs: scaffold a member, or stop running this.
  //
  // The divergence half counts toward "it rendered something": a headless
  // instance with a deployment tree is a tree this command still has an answer
  // for, and refusing it would be the command declining to describe the one
  // thing about that tree a client is asked to trust.
  if (artefacts.length === 0 && divergence.length === 0) {
    throw new GenerateInputError(
      `${root} has no admin project, no documentation site and no \`apps/<deployment>/\` tree, ` +
        `so this command has nothing to render:\n${omitted.map((reason) => `  - ${reason}`).join('\n')}`,
    );
  }

  if (options.dryRun !== true) {
    for (const artefact of artefacts) {
      mkdirSync(dirname(artefact.path), { recursive: true });
      writeFileSync(artefact.path, artefact.content, 'utf8');
    }
    for (const report of divergence) {
      for (const rendering of report.renderings) {
        mkdirSync(dirname(rendering.outputPath), { recursive: true });
        writeFileSync(rendering.outputPath, rendering.content, 'utf8');
      }
    }
  }
  return {
    root,
    artefacts,
    modules: scan.packages.length,
    excluded: scan.skipped,
    omitted,
    collected,
    swept,
    divergence,
    dryRun: options.dryRun === true,
  };
}

/** The lines the command prints, in order. Exported so a proof reads them. */
export function generateReport(result: GenerateResult): readonly string[] {
  const lines = result.artefacts.map(
    (artefact) =>
      `${result.dryRun ? 'would write' : 'wrote'} ${relative(result.root, artefact.path)} — ` +
      `${artefact.label}`,
  );
  if (result.swept.length > 0) {
    lines.push(
      `removed ${String(result.swept.length)} module reference page(s) no installed module ` +
        `renders any more`,
    );
  }
  for (const report of result.divergence) {
    for (const rendering of report.renderings) {
      lines.push(
        `${result.dryRun ? 'would write' : 'wrote'} ` +
          `${relative(result.root, rendering.outputPath)} — ${rendering.label} ` +
          `(${String(report.overlayModules.length)} overlay module(s), ` +
          `${String(report.entries)} divergence(s)). Commit it: it is a fact about your tree`,
      );
    }
    // The generator writes the artefact whatever it found, exactly as this
    // repository's does; a finding is something the client can act on and the
    // person running this is the person who can.
    for (const finding of report.findings) {
      lines.push(`  [${finding.kind}] ${finding.where}: ${finding.detail}`);
    }
    // Never folded into "declares nothing": an absent declaration and one this
    // run could not read are the same answer only if you let them be.
    for (const field of report.unresolvedDeclaration) {
      lines.push(
        `  [unreadable-declaration] ${report.deployment}: ${field} is not written as a literal, ` +
          `so this report was derived as though it were absent`,
      );
    }
  }
  if (result.collected !== null) {
    lines.push(
      `copied ${String(result.collected.copied.length)} module-owned page(s) into ` +
        `${result.collected.modulesRoot}` +
        (result.collected.removed.length === 0
          ? ''
          : `, removing ${String(result.collected.removed.length)} the previous run wrote`),
    );
  }
  // A member this instance does not have is named, never silently skipped:
  // a client who does not know a surface is missing goes looking for it.
  for (const reason of result.omitted) lines.push(`omitted ${reason}`);
  // R8.2 — the exclusion is said out loud. A module that is simply not there is
  // indistinguishable from a module nobody installed.
  for (const skipped of result.excluded) {
    lines.push(
      skipped.kind === 'links-out-of-node-modules'
        ? `excluded ${skipped.name} — links-out-of-node-modules, real path ${skipped.realPath}. ` +
          `A linked package is invisible to this instance's runtime discovery too, so an ` +
          `artefact naming it would register a screen the backend never composes. Develop it ` +
          `as an overlay module under \`apps/<deployment>/modules/\`, or \`pnpm pack\` it and ` +
          `install the tarball.`
        : `excluded ${skipped.at} — unreadable: ${skipped.reason}`,
    );
  }
  return lines;
}

/** Is this instance's admin registry the same as the one on disk? */
export function artefactIsCurrent(artefact: GeneratedArtefact): boolean {
  if (!existsSync(artefact.path)) return false;
  return readFileSync(artefact.path, 'utf8') === artefact.content;
}

/**
 * The "do not edit" header the documentation artefacts carry in an instance.
 *
 * A separate value from the registry's because the comment syntax differs — a
 * `.js` sidebar fragment and a markdown page — and separate from
 * `composer:generate`'s because the two hosts tell a reader different things to
 * run. An artefact naming `composer:generate` would send a client to a script
 * their tree does not have.
 */
const INSTANCE_DOCS_HEADER =
  `// AUTO-GENERATED by \`endora generate\` — DO NOT EDIT, and do not commit.\n` +
  `// It names the module packages THIS instance installed, so it is a fact about\n` +
  `// the install and not about the tree. \`.gitignore\` covers it;\n` +
  `// \`pnpm run generate\` rewrites it.\n`;

/** The same, for a markdown page, whose comment syntax is HTML's. */
const INSTANCE_DOCS_PAGE_HEADER =
  `<!-- AUTO-GENERATED by \`endora generate\` — DO NOT EDIT, and do not commit.\n` +
  `     It names the module packages THIS instance installed, so it is a fact\n` +
  `     about the install and not about the tree. \`.gitignore\` covers it;\n` +
  `     \`pnpm run generate\` rewrites it. -->`;

/** The "do not edit" header an instance's artefacts carry. */
const GENERATED_REGISTRY_HEADER =
  `// AUTO-GENERATED by \`endora generate\` — DO NOT EDIT, and do not commit.\n` +
  `// It names the module packages THIS instance installed, so it is a fact about\n` +
  `// the install and not about the tree: a different module set is a different\n` +
  `// bundle. \`.gitignore\` covers it; \`pnpm run generate\` rewrites it.\n`;

/** The same, for the stylesheet, whose comment syntax is CSS's. */
const GENERATED_STYLESHEET_HEADER =
  `/* AUTO-GENERATED by \`endora generate\` — DO NOT EDIT, and do not commit.\n` +
  ` * It names the packages THIS instance installed, so it is a fact about the\n` +
  ` * install and not about the tree. \`.gitignore\` covers it; \`pnpm run generate\`\n` +
  ` * rewrites it.\n`;
