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
  scanInstalledModulePackages,
  type SkippedInstalledPackage,
} from '../lib/module-packages.js';

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
export function runGenerate(options: GenerateOptions = {}): GenerateResult {
  const cwd = options.cwd ?? process.cwd();
  const root = findInstanceRoot(cwd);
  if (root === null) {
    throw new GenerateHostError(
      `no \`pnpm-workspace.yaml\` above ${cwd}, so there is no instance to render artefacts ` +
        `for. This command renders the two files an instance's admin project is built from ` +
        `and both land in that project; run it inside the tree \`endora new instance\` wrote.`,
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

  let artefacts: readonly GeneratedArtefact[];
  try {
    const contributions = collectAdminContributions(scan.packages);
    const sources = collectTailwindSources(root, scan.packages);
    artefacts = [
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
    ];
  } catch (error: unknown) {
    // The admin project is found through the `"@/*"` tsconfig alias, exactly as
    // every other admin derivation in this estate finds it. A workspace with no
    // such member is an instance with no admin project, which is a refusal the
    // operator can act on rather than an input this run could not read.
    if (error instanceof AdminLayoutUnresolvableError) {
      throw new GenerateInputError(
        `${error.message}\n\nBoth artefacts this command renders land in the admin project's ` +
          `own source root, and the project is found by the \`"@/*"\` path its tsconfig ` +
          `declares. An instance scaffolded without an admin member has nothing for this ` +
          `command to write; scaffold one with \`endora new instance\` and keep that alias.`,
      );
    }
    throw error;
  }

  if (options.dryRun !== true) {
    for (const artefact of artefacts) {
      mkdirSync(dirname(artefact.path), { recursive: true });
      writeFileSync(artefact.path, artefact.content, 'utf8');
    }
  }
  return {
    root,
    artefacts,
    modules: scan.packages.length,
    excluded: scan.skipped,
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
