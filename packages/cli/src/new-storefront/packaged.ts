/**
 * The reference storefront a **published** CLI carries.
 *
 * ## Why there is one
 *
 * `endora new storefront` copies the reference storefront out of a checkout of
 * the platform repository (`./reference.ts`). A stranger who typed
 * `npx create-endora-commerce` has no checkout, so until this file existed the
 * one-shot refused the storefront everywhere a stranger stands and
 * `cli-product.md` R3.1c recorded it as the gap it was.
 *
 * The answer is not a second copy of the transformation. This CLI's own `build`
 * runs {@link planStorefront} — the same derivation, over the same checkout —
 * and writes the **plan** into `dist`: every file already rewritten, every
 * `workspace:` range already published semver, every omission already decided.
 * Outside a checkout the command reads that plan back and writes it. Nothing
 * about *what a scaffold is* is stated here.
 *
 * ## Why inside this package and not a package of its own
 *
 * A `storefront-reference` package would need this CLI to build it and this CLI
 * would need it to run: a cycle, resolved only by fetching the reference at run
 * time — which makes `endora new storefront`, a command that writes a tree and
 * runs nothing, into one that needs a registry and a package manager. Carried
 * here it is version-locked to the CLI by construction and works offline.
 *
 * ## What it leaves out, and says so
 *
 * The tracked reference is about 10.8 MB, of which 8.8 MB is Playwright's
 * screenshot baselines — pixel captures of this repository's demo shop on the
 * machine that recorded them. Carried, they would take this package's tarball
 * from under 1 MB to over 9 MB for every `npx` and every instance that installs
 * it. So the packaged plan omits them, **as a reported omission**
 * ({@link snapshotBaselines}): the run names each directory of them and the
 * command that records the client's own. That is the one difference from a checkout's
 * scaffold, and it is in the output rather than in a footnote.
 *
 * ## A build that cannot derive it writes none, and a pack refuses
 *
 * The plan needs git (the copy population is `git ls-files`' answer) and the
 * storefront tree. A container image build has neither — `.git` is in
 * `.dockerignore` and the backend image never copies `storefront/` — and must
 * still build this package, so there the step writes nothing and says so. What
 * may not happen is a tarball published without it: `prepack`
 * (`scripts/assert-storefront-reference.mjs`) refuses to pack a `dist` that
 * carries none.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DECLARATION_FILE, loadTreeDeclaration } from '../inputs/declaration.js';
import {
  findRepoRoot,
  memberDirectories,
  resolveReference,
  STOREFRONT_DECLARATION_EXPORT,
  StorefrontHostError,
  type ReferenceKind,
} from './reference.js';
import {
  planStorefront,
  withRegistry,
  type OmittedFile,
  type PlannedFile,
  type RangeRewrite,
  type StorefrontPlan,
} from './rewrite.js';

/** The directory under the CLI's `dist` that holds the packaged reference. */
export const PACKAGED_REFERENCE_DIRECTORY = 'storefront-reference';

/** The plan's file inside it. */
export const PACKAGED_REFERENCE_FILE = 'reference.json';

/** The shape's own version: a reader refuses one it does not know. */
export const PACKAGED_REFERENCE_FORMAT = 1;

/** One file of the packaged plan. */
export interface PackagedFile {
  readonly path: string;
  readonly note: string | null;
  /**
   * Whether the plan **authored** it — a rewritten manifest, a vendored
   * configuration, a rendered Dockerfile — rather than copying it. It is what a
   * checkout's plan says with `source: null`, kept because every file here has
   * lost the file it was copied from.
   */
  readonly authored: boolean;
  /** `utf8` when the bytes round-trip through a string, `base64` otherwise. */
  readonly encoding: 'utf8' | 'base64';
  readonly content: string;
}

/** The plan as the build wrote it. */
export interface PackagedReference {
  readonly format: number;
  /** The version of the CLI whose build wrote it. */
  readonly cliVersion: string;
  readonly files: readonly PackagedFile[];
  readonly ranges: readonly RangeRewrite[];
  /**
   * `target` is **repository-relative** here, not absolute: an absolute path
   * would publish the layout of the machine that built the tarball.
   */
  readonly rewrites: readonly {
    readonly file: string;
    readonly kind: ReferenceKind;
    readonly specifier: string;
    readonly target: string;
    readonly to: string;
  }[];
  readonly omitted: readonly OmittedFile[];
}

/**
 * The screenshot baselines among `files`.
 *
 * Derived from the test runner's own convention rather than from a directory
 * name of ours: Playwright stores the baselines of `<spec>` in a sibling
 * directory called `<spec>-snapshots`. So a file is a baseline when one of its
 * directories is named after a **file the same population holds** plus that
 * suffix. A directory that merely ends in `-snapshots` and sits beside no such
 * file is application content and stays.
 */
export function snapshotBaselines(files: readonly string[]): readonly string[] {
  const population = new Set(files);
  const suffix = '-snapshots';
  return files.filter((file) => {
    const segments = file.split('/');
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index]!;
      if (!segment.endsWith(suffix)) continue;
      const owner = [...segments.slice(0, index), segment.slice(0, -suffix.length)].join('/');
      if (population.has(owner)) return true;
    }
    return false;
  });
}

/** The plan over the checkout holding `cwd`, in the shape the build writes. */
export function buildPackagedReference(cwd: string, cliVersion: string): PackagedReference {
  const reference = resolveReference(cwd);
  const members = memberDirectories(reference.repoRoot);
  // Where the scaffold "is" decides nothing here: a retargeted glob is written
  // relative to the file that names it, so any directory gives the same text.
  const plan = planStorefront(reference, members, join(reference.repoRoot, '.scaffold'));
  const baselines = new Set(snapshotBaselines(plan.files.map((file) => file.path)));
  let baselineBytes = 0;
  const files: PackagedFile[] = [];
  for (const file of plan.files) {
    const bytes =
      file.content !== null ? Buffer.from(file.content, 'utf8') : readFileSync(file.source!);
    if (baselines.has(file.path)) {
      baselineBytes += bytes.length;
      continue;
    }
    const text = bytes.toString('utf8');
    const roundTrips = Buffer.from(text, 'utf8').equals(bytes);
    files.push({
      path: file.path,
      note: file.note,
      authored: file.source === null,
      encoding: roundTrips ? 'utf8' : 'base64',
      content: roundTrips ? text : bytes.toString('base64'),
    });
  }
  // One line per baseline **directory**, not per picture: a run that printed
  // forty-four omissions for one decision buried the one omission a reader
  // has to act on.
  const megabytes = (baselineBytes / (1024 * 1024)).toFixed(1);
  const directories = new Map<string, number>();
  for (const path of baselines) {
    const directory = path.slice(0, path.lastIndexOf('/') + 1);
    directories.set(directory, (directories.get(directory) ?? 0) + 1);
  }
  const omitted: OmittedFile[] = [
    ...plan.omitted,
    ...[...directories]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([directory, count]) => ({
        path: directory,
        reason:
          `its ${String(count)} ${count === 1 ? 'file is a screenshot baseline' : 'files are screenshot baselines'} ` +
          `of the reference storefront, recorded on the machine that captured them — ` +
          `${megabytes} MB across ${String(baselines.size)} in all, which the published CLI does ` +
          `not carry. \`pnpm exec playwright test --update-snapshots\` records your own, against ` +
          `your own shop`,
      })),
  ];
  return {
    format: PACKAGED_REFERENCE_FORMAT,
    cliVersion,
    files,
    ranges: plan.ranges,
    rewrites: plan.rewrites.map((rewrite) => ({
      file: rewrite.file,
      kind: rewrite.kind,
      specifier: rewrite.specifier,
      target: relative(reference.repoRoot, rewrite.target).split(sep).join('/'),
      to: rewrite.to,
    })),
    omitted,
  };
}

/** What the build step did. */
export type PackagedReferenceWrite =
  | { readonly written: true; readonly files: number; readonly omitted: number; readonly bytes: number }
  | { readonly written: false; readonly reason: string };

/**
 * The build step: derive the packaged reference for the CLI package at `cliDir`
 * and write it under `outDir` (its `dist/storefront-reference` by default).
 *
 * A checkout this cannot read a reference storefront out of — no workspace, no
 * git, no storefront member — writes **nothing**, removes a stale one, and
 * answers why. A reference it can read and cannot make standalone is a throw:
 * that is a defect in the tree, and a build that swallowed it would ship the
 * previous release's storefront or none.
 *
 * The declaration is written beside the plan as the file it is, and loaded from
 * there before this returns: it is read by `import()` at run time
 * (`inputs/declaration.ts`), so "it loads from the place it is shipped in" is
 * proved at build rather than assumed.
 */
export async function writePackagedReference(
  cliDir: string,
  outDir: string = join(cliDir, 'dist', PACKAGED_REFERENCE_DIRECTORY),
): Promise<PackagedReferenceWrite> {
  rmSync(outDir, { recursive: true, force: true });
  const own = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf8')) as { version?: unknown };
  if (typeof own.version !== 'string') {
    throw new Error(`${join(cliDir, 'package.json')} declares no \`version\`.`);
  }
  if (findRepoRoot(cliDir) === null) {
    return { written: false, reason: `no pnpm-workspace.yaml above ${cliDir}` };
  }
  let packaged: PackagedReference;
  try {
    packaged = buildPackagedReference(cliDir, own.version);
  } catch (error: unknown) {
    if (error instanceof StorefrontHostError) return { written: false, reason: error.message };
    throw error;
  }
  const declaration = packaged.files.find((file) => file.path === DECLARATION_FILE);
  if (declaration === undefined || declaration.encoding !== 'utf8') {
    throw new Error(
      `the reference storefront holds no ${DECLARATION_FILE}, so a scaffold written from the ` +
        `packaged reference could not say what it needs from its environment.`,
    );
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, DECLARATION_FILE), declaration.content, 'utf8');
  await loadTreeDeclaration(outDir, STOREFRONT_DECLARATION_EXPORT);
  const text = `${JSON.stringify(packaged)}\n`;
  writeFileSync(join(outDir, PACKAGED_REFERENCE_FILE), text, 'utf8');
  return {
    written: true,
    files: packaged.files.length,
    omitted: packaged.omitted.length,
    bytes: Buffer.byteLength(text, 'utf8'),
  };
}

/** The package root above this module, and the version its manifest declares. */
function ownPackage(moduleUrl: string): { readonly dir: string; readonly version: string | undefined } {
  let current = dirname(fileURLToPath(moduleUrl));
  for (;;) {
    const manifestPath = join(current, 'package.json');
    if (existsSync(manifestPath)) {
      let version: unknown;
      try {
        version = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown }).version;
      } catch {
        version = undefined;
      }
      return { dir: current, version: typeof version === 'string' ? version : undefined };
    }
    const parent = dirname(current);
    if (parent === current) return { dir: dirname(fileURLToPath(moduleUrl)), version: undefined };
    current = parent;
  }
}

/**
 * Where this CLI's own packaged reference is: `dist/storefront-reference` of
 * the nearest package root above this module — the same directory from `src/`
 * in a checkout and from `dist/` in an installed tarball.
 */
export function ownPackagedReferenceDir(moduleUrl: string = import.meta.url): string {
  return join(ownPackage(moduleUrl).dir, 'dist', PACKAGED_REFERENCE_DIRECTORY);
}

/**
 * Read a packaged reference back, or `null` when `dir` holds none.
 *
 * Absent is an answer — a build made where there was nothing to derive it
 * from — and the caller says what that means. Present and unreadable is a
 * refusal (exit 2's shape): a plan this build cannot parse is not a smaller
 * storefront.
 *
 * `expectedVersion` is the CLI's own. The ranges inside the plan were written
 * from the workspace's versions at build time, and every release is one number
 * (lockstep), so a plan built at another version names packages this release
 * does not carry: a manifest bumped after its `dist` was built. It is refused
 * rather than installed.
 */
export function readPackagedReference(
  dir: string,
  expectedVersion?: string | undefined,
): PackagedReference | null {
  const file = join(dir, PACKAGED_REFERENCE_FILE);
  if (!existsSync(file)) return null;
  let parsed: PackagedReference;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8')) as PackagedReference;
  } catch (error: unknown) {
    throw new StorefrontHostError(
      `${file} is not JSON (${error instanceof Error ? error.message : String(error)}). ` +
        `Reinstall the CLI.`,
    );
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    parsed.format !== PACKAGED_REFERENCE_FORMAT ||
    !Array.isArray(parsed.files) ||
    parsed.files.length === 0 ||
    !Array.isArray(parsed.ranges) ||
    !Array.isArray(parsed.rewrites) ||
    !Array.isArray(parsed.omitted)
  ) {
    throw new StorefrontHostError(
      `${file} is not a packaged reference storefront this build reads (format ` +
        `${String(PACKAGED_REFERENCE_FORMAT)}, with at least one file). Reinstall the CLI.`,
    );
  }
  if (expectedVersion !== undefined && parsed.cliVersion !== expectedVersion) {
    throw new StorefrontHostError(
      `${file} was built for CLI ${parsed.cliVersion} and this CLI is ${expectedVersion}. The ` +
        `ranges inside it name the packages of that release, so a storefront written from it ` +
        `would install a release this CLI is not part of. Rebuild the package ` +
        `(\`pnpm --filter @endora-commerce/cli run build\`) or reinstall it.`,
    );
  }
  return parsed;
}

/** This CLI's own packaged reference, checked against its own version. */
export function ownPackagedReference(
  moduleUrl: string = import.meta.url,
): { readonly dir: string; readonly packaged: PackagedReference } | null {
  const own = ownPackage(moduleUrl);
  const dir = join(own.dir, 'dist', PACKAGED_REFERENCE_DIRECTORY);
  const packaged = readPackagedReference(dir, own.version);
  return packaged === null ? null : { dir, packaged };
}

/**
 * The plan a packaged reference carries, as the writer takes it.
 *
 * `--registry` is applied here, at run time, through the same function a
 * checkout's plan goes through ({@link withRegistry}) — the plan in the tarball
 * is the public-registry one, which is what a stranger holds.
 */
export function planFromPackaged(
  packaged: PackagedReference,
  dir: string,
  options: { readonly registry?: string | undefined } = {},
): StorefrontPlan {
  // A copied file's source is the one file that now holds it; an authored one
  // has none, exactly as in a checkout's plan.
  const holder = join(dir, PACKAGED_REFERENCE_FILE);
  const files: PlannedFile[] = packaged.files.map((file) => {
    const source = file.authored ? null : holder;
    return file.encoding === 'utf8'
      ? { path: file.path, source, content: file.content, note: file.note }
      : {
          path: file.path,
          source,
          content: null,
          note: file.note,
          bytes: Buffer.from(file.content, 'base64'),
        };
  });
  const plan: StorefrontPlan = {
    files,
    ranges: packaged.ranges,
    rewrites: packaged.rewrites,
    omitted: packaged.omitted,
    registry: null,
  };
  return options.registry === undefined ? plan : withRegistry(plan, options.registry);
}
