/**
 * "Does this app's Tailwind build read a module package's sources?" — the probe
 * both frontends' guards are built from (feature 080, T044).
 *
 * ## The defect, and why it is silent
 *
 * Both apps run Tailwind v4 with **automatic** source detection, and v4 roots
 * that detection at the build tool's own base directory: `config.root` for
 * `@tailwindcss/vite` (admin) and `process.cwd()` for `@tailwindcss/postcss`
 * (storefront). Measured on this tree — a `.tsx` at `admin/` is scanned, one at
 * the repository root is not, and one under `packages/modules/blog/src` is not —
 * so both apps stop at their own workspace member and neither reaches
 * `packages/`.
 *
 * A class used only inside a module package's component is therefore dropped
 * from the built stylesheet with **no error and no warning**: the component
 * renders unstyled in production. Nothing in a type-check, a lint or a test run
 * observes it, which is what makes a guard the deliverable rather than the
 * repair.
 *
 * ## What the probe does
 *
 * It writes a file carrying an arbitrary-value utility (`mt-[483721px]`) into
 * each module package, asks the app to compile its own stylesheet through its
 * own toolchain, and looks for the declaration that utility must produce. Two
 * extensions per package, because a `@source` that lists one and not the other
 * would otherwise pass; and one **control** probe at the repository root, which
 * must *not* survive — without it the assertion could be satisfied by a build
 * that emits everything, and the guard would agree with itself.
 *
 * The probes are the only honest population available: both module packages in
 * this repository ship zero `.tsx` files today (their admin UI is still in
 * `admin/src/modules/`), so a guard keyed on what is already there would be
 * green because it was looking at nothing.
 *
 * ## What it deliberately does not do
 *
 * It does not parse `@source` and re-implement Tailwind's glob semantics. A
 * matcher of our own would answer this question in a second implementation that
 * can agree with itself while disagreeing with the build — and the build is the
 * thing that drops the class. The compile is real in both apps: Vite with the
 * app's own `vite.config.ts` for admin, PostCSS with the app's own plugin for
 * the storefront.
 *
 * The population is derived from each package's own `endora` block, through
 * `backend/scripts/lib/workspace-packages.ts`, never from a path: 63 more module
 * packages are coming, and `packages/modules/*` written down here would be a
 * derived fact written down (D-100).
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  modulePackages,
  nodeWorkspaceFs,
  workspaceMembers,
  type WorkspaceFs,
} from '../backend/scripts/lib/workspace-packages.js';

/** Extensions a module package's UI can be written in, both of which must be scanned. */
export const PROBE_EXTENSIONS: readonly string[] = ['ts', 'tsx'];

/**
 * The filename stem every probe uses.
 *
 * Matched by a `.gitignore` rule at the repository root, so a run killed
 * between the write and the cleanup leaves nothing `git status` reports and
 * nothing a later commit can pick up by accident.
 */
export const PROBE_STEM = '__tailwind-source-probe__';

/** One file written, and what the compiled stylesheet must say about it. */
export interface TailwindSourceProbe {
  /** What this probe is a statement about — a package name, or the control. */
  readonly subject: string;
  /** The file written, absolute. */
  readonly file: string;
  /** The utility as written into that file. */
  readonly utility: string;
  /** The substring the compiled stylesheet carries iff the utility was scanned. */
  readonly needle: string;
  /** `true` for a module package, `false` for the control. */
  readonly expected: boolean;
}

/** Raised when there is nothing to probe, so a vacuous pass is impossible. */
export class NoModulePackagesError extends Error {
  override readonly name = 'NoModulePackagesError';
}

/**
 * A distinct arbitrary-value utility per probe.
 *
 * `mt-[<n>px]` compiles to `margin-top:<n>px`, so the needle is a literal the
 * stylesheet cannot contain for any other reason. The seed makes two runs of
 * two different apps — `pnpm --filter '!backend' run test` runs them
 * concurrently — write different values into the same package directory, so
 * neither can read the other's probe as its own success.
 */
function utilityFor(seed: number, index: number): { utility: string; needle: string } {
  const pixels = 100_000 + ((seed * 97 + index * 7919) % 800_000);
  return { utility: `mt-[${pixels}px]`, needle: `${pixels}px` };
}

/**
 * Where a probe goes inside a package: its `src` directory when it has one.
 *
 * `src` is where this repository's module packages keep their sources and where
 * a screen would land, so a `@source` narrowed to it later still passes. A
 * package with no `src` is probed at its root rather than skipped — skipping
 * would be a package silently outside the population.
 */
function probeDirectoryOf(packageDir: string): string {
  const source = join(packageDir, 'src');
  return existsSync(source) ? source : packageDir;
}

/**
 * Every probe this run will write, for a given seed.
 *
 * @throws NoModulePackagesError when the workspace declares none — the guard
 * would otherwise assert over an empty list and report a pass.
 */
export function planTailwindSourceProbes(
  repoRoot: string,
  seed: number = process.pid,
  fs: WorkspaceFs = nodeWorkspaceFs(),
): readonly TailwindSourceProbe[] {
  const packages = modulePackages(workspaceMembers(repoRoot, fs));
  if (packages.length === 0) {
    throw new NoModulePackagesError(
      `no workspace member of ${repoRoot} declares \`endora.type: "module"\` — this guard ` +
        'asserts that each of them is scanned, and over an empty list it would assert nothing',
    );
  }
  const probes: TailwindSourceProbe[] = [];
  let index = 0;
  for (const modulePackage of packages) {
    for (const extension of PROBE_EXTENSIONS) {
      const { utility, needle } = utilityFor(seed, index++);
      probes.push({
        subject: `${modulePackage.name} (.${extension})`,
        file: join(probeDirectoryOf(modulePackage.dir), `${PROBE_STEM}${seed}.${extension}`),
        utility,
        needle,
        expected: true,
      });
    }
  }
  const control = utilityFor(seed, index);
  probes.push({
    subject: 'control: the repository root, which no source covers',
    file: join(repoRoot, `${PROBE_STEM}${seed}.tsx`),
    utility: control.utility,
    needle: control.needle,
    expected: false,
  });
  return probes;
}

/**
 * The probe's contents.
 *
 * Deliberately free of JSX so the file is valid TypeScript under any `jsx`
 * setting: a concurrent `tsc` that catches a probe mid-run must not fail on it.
 */
function contentsOf(probe: TailwindSourceProbe): string {
  return (
    '// Written by the Tailwind module-package source guard (feature 080, T044).\n' +
    '// Deleted by the same test; a leftover is ignored by .gitignore.\n' +
    `export const tailwindSourceProbe = '${probe.utility}';\n`
  );
}

export function writeTailwindSourceProbes(probes: readonly TailwindSourceProbe[]): void {
  for (const probe of probes) {
    mkdirSync(join(probe.file, '..'), { recursive: true });
    writeFileSync(probe.file, contentsOf(probe), 'utf8');
  }
}

export function removeTailwindSourceProbes(probes: readonly TailwindSourceProbe[]): void {
  for (const probe of probes) rmSync(probe.file, { force: true });
}

/** One probe's verdict, in a shape a failing assertion prints usefully. */
export interface TailwindSourceVerdict {
  readonly subject: string;
  readonly file: string;
  readonly utility: string;
  readonly scanned: boolean;
}

/** What the compiled stylesheet says, and what it must say. */
export function readTailwindSourceVerdicts(
  probes: readonly TailwindSourceProbe[],
  css: string,
): { readonly actual: readonly TailwindSourceVerdict[]; readonly expected: readonly TailwindSourceVerdict[] } {
  const describe = (probe: TailwindSourceProbe, scanned: boolean): TailwindSourceVerdict => ({
    subject: probe.subject,
    file: probe.file,
    utility: probe.utility,
    scanned,
  });
  return {
    actual: probes.map((probe) => describe(probe, css.includes(probe.needle))),
    expected: probes.map((probe) => describe(probe, probe.expected)),
  };
}
