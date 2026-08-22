/**
 * A whole synthetic checkout for `check-release-intent`, in memory.
 *
 * The check's input is a *repository* — `pnpm-workspace.yaml`, a manifest per
 * member, `.changeset/config.json` and the changeset files — and every one of
 * its eight findings is a disagreement *between* those files. A fixture that
 * handed the analysis a ready-made list of "versionable packages" would leave
 * the derivation that produces that list unproven, and the derivation is the
 * part that has to survive 66 module packages arriving under a second scope
 * (D-160.2). So the fixture is the file map, and it enters where a real run
 * enters: `checkReleaseIntent(root, fs, listChangesets)` (issue #130).
 *
 * It lives here rather than beside the companion test because the inventory's
 * red proofs need the same tree.
 */
import type { WorkspaceFs } from '../../scripts/lib/workspace-packages.js';

/** Where the synthetic checkout is rooted. Never touched on disk. */
export const FIXTURE_ROOT = '/fixture';

/** Repository-relative path → contents. A `null` value deletes a default file. */
export type FileMap = Readonly<Record<string, string | null>>;

/**
 * The default checkout: two library packages under a family glob, one
 * application under a literal entry, and a configuration that passes.
 *
 * It is deliberately *not* a copy of this repository's five packages — a red
 * proof that mutated the real names would read as a claim about them, and the
 * rule under test is about the shape of the workspace rather than about
 * `@endora-commerce/*`. The scope is a second one on purpose: `@fx/` is what
 * `@endora-commerce/` will be.
 */
export const DEFAULT_CHECKOUT: FileMap = {
  'pnpm-workspace.yaml': 'packages:\n  - apps/host\n  - packages/*\n',
  'package.json': '{ "name": "root", "version": "0.0.0", "private": true }',
  'apps/host/package.json': '{ "name": "host", "version": "0.0.0", "private": true }',
  'packages/alpha/package.json': '{ "name": "@fx/alpha", "version": "1.0.0", "private": true }',
  'packages/beta/package.json': '{ "name": "@fx/beta", "version": "1.0.0", "private": true }',
  '.changeset/config.json': JSON.stringify(
    {
      baseBranch: 'master',
      ignore: ['host'],
      fixed: [],
      linked: [['@fx/alpha', '@fx/beta']],
      updateInternalDependencies: 'patch',
      privatePackages: { version: true, tag: false },
    },
    null,
    2,
  ),
};

export interface Checkout {
  readonly fs: WorkspaceFs;
  readonly listChangesets: (dir: string) => readonly string[] | null;
}

/** Merge `overrides` into {@link DEFAULT_CHECKOUT} and expose it as a filesystem. */
export function checkout(overrides: FileMap = {}): Checkout {
  const files = new Map<string, string>();
  for (const [path, content] of Object.entries({ ...DEFAULT_CHECKOUT, ...overrides })) {
    if (content !== null) files.set(`${FIXTURE_ROOT}/${path}`, content);
  }
  const directories = new Set<string>();
  for (const path of files.keys()) {
    const segments = path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join('/'));
    }
  }
  return {
    fs: {
      readText: (path) => files.get(path) ?? null,
      listDirectories: (path) =>
        [...directories]
          .filter((candidate) => candidate.startsWith(`${path}/`))
          .map((candidate) => candidate.slice(path.length + 1))
          .filter((tail) => !tail.includes('/')),
    },
    listChangesets: (dir) => {
      const prefix = `${dir}/`;
      const names = [...files.keys()]
        .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map((path) => path.slice(prefix.length));
      return names.length > 0 || directories.has(dir) ? names : null;
    },
  };
}

/** The `.changeset/config.json` of the default checkout, with `mutate` applied. */
export function configuredAs(mutate: (config: Record<string, unknown>) => void): FileMap {
  const config = JSON.parse(DEFAULT_CHECKOUT['.changeset/config.json'] as string) as Record<
    string,
    unknown
  >;
  mutate(config);
  return { '.changeset/config.json': JSON.stringify(config, null, 2) };
}
