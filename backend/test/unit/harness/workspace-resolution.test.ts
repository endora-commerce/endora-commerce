/**
 * The guard that refuses a run whose `@endora-commerce/*` source is another checkout's
 * (issue #255).
 *
 * Every fixture here enters at the **top** of the analysis — a whole synthetic
 * checkout behind the injected {@link ResolutionFs} — so discovery, the
 * containment test and the message are all exercised by it. Handing
 * `workspaceResolutionRefusal` a hand-built report would prove the wording and
 * leave the part that actually goes wrong (which link is read, and where it
 * lands) untested.
 *
 * The last two tests are about this repository rather than a fixture: one keeps
 * the `tsconfig.base.json` `paths` block complete, which is what makes `tsc`
 * resolve `@endora-commerce/*` inside the checkout it is run from, and one asserts that the
 * checkout running the suite is itself correctly wired.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  nodeWorkspaceFs,
  workspaceMembers,
} from '../../../scripts/lib/workspace-packages.js';
import {
  ALLOW_FOREIGN_ENV,
  assertWorkspacePackagesAreLocal,
  findCheckoutRoot,
  inspectWorkspaceResolution,
  isInsideCheckout,
  nodeResolutionFs,
  workspaceResolutionRefusal,
  type ResolutionFs,
} from '../../../../scripts/workspace-resolution.js';

const ROOT = '/repo';

interface FakeCheckout {
  /**
   * Directory paths relative to the root, each getting a manifest.
   *
   * A bare name means `packages/<name>` and `@endora-commerce/<name>`, which is the
   * layout this repository has today. A path with a slash is taken as written,
   * which is what the nested case needs (feature 080, T040a).
   */
  readonly packages: readonly string[];
  /**
   * The `packages:` globs the fixture's `pnpm-workspace.yaml` declares.
   *
   * Defaults to this repository's own. The whole point of T040a is that this
   * list is the authority, so a fixture that wants a nested package tree says
   * so here rather than relying on a directory scan.
   */
  readonly globs?: readonly string[];
  /** Consumer directory → the `@endora-commerce/*` specifiers its manifest declares. */
  readonly workspaces: Readonly<Record<string, readonly string[]>>;
  /**
   * `<consumer>/node_modules/<specifier>` → absolute path it resolves to.
   * A pair with no entry here has no link on disk at all.
   */
  readonly links: Readonly<Record<string, string>>;
}

const DEFAULT_GLOBS: readonly string[] = [
  'backend',
  'storefront',
  'admin',
  'packages/*',
  'docs',
];

/** `contracts` → `packages/contracts`; `packages/modules/blog` → itself. */
function packageDirectoryOf(entry: string): string {
  return entry.includes('/') ? entry : `packages/${entry}`;
}

/** `packages/modules/blog` → `@endora-commerce/blog`; `contracts` → `@endora-commerce/contracts`. */
function packageNameOf(entry: string): string {
  const segments = entry.split('/');
  return `@endora-commerce/${segments[segments.length - 1]!}`;
}

/** A whole checkout, as the questions {@link ResolutionFs} asks of one. */
function fakeCheckout(checkout: FakeCheckout): ResolutionFs {
  const files = new Map<string, string>();
  const workspaceYaml = ['packages:', ...(checkout.globs ?? DEFAULT_GLOBS).map((g) => `  - ${g}`)];
  files.set(join(ROOT, 'pnpm-workspace.yaml'), `${workspaceYaml.join('\n')}\n`);

  const manifests = new Map<string, unknown>();
  for (const pkg of checkout.packages) {
    manifests.set(join(ROOT, packageDirectoryOf(pkg), 'package.json'), {
      name: packageNameOf(pkg),
    });
  }
  for (const [dir, deps] of Object.entries(checkout.workspaces)) {
    const path = join(ROOT, dir, 'package.json');
    const existing = manifests.get(path);
    const name = (existing as { name?: string } | undefined)?.name ?? dir;
    manifests.set(path, {
      name,
      dependencies: Object.fromEntries(deps.map((dep) => [dep, 'workspace:^'])),
    });
  }
  for (const [path, manifest] of manifests) files.set(path, JSON.stringify(manifest));

  const directories = new Map<string, Set<string>>();
  const noteDirectory = (parent: string, child: string): void => {
    const bucket = directories.get(parent) ?? new Set<string>();
    bucket.add(child);
    directories.set(parent, bucket);
  };
  const noteTree = (dir: string): void => {
    const segments = dir.split('/');
    let parent = ROOT;
    for (const segment of segments) {
      if (segment === '.' || segment === '') continue;
      noteDirectory(parent, segment);
      parent = join(parent, segment);
    }
  };
  for (const pkg of checkout.packages) noteTree(packageDirectoryOf(pkg));
  for (const dir of Object.keys(checkout.workspaces)) noteTree(dir);

  return {
    readText: (path) => files.get(path) ?? null,
    readJson: (path) => manifests.get(path) ?? null,
    listDirectories: (path) => [...(directories.get(path) ?? [])],
    realpath: (path) => {
      for (const [link, target] of Object.entries(checkout.links)) {
        if (path === join(ROOT, link)) return target;
      }
      return files.has(path) ? path : null;
    },
  };
}

/** The wiring a correct checkout has: every link inside `/repo`. */
function wiredCorrectly(): ResolutionFs {
  return fakeCheckout({
    packages: ['contracts', 'page-builder-core'],
    workspaces: {
      backend: ['@endora-commerce/contracts', '@endora-commerce/page-builder-core'],
      'packages/contracts': [],
    },
    links: {
      'backend/node_modules/@endora-commerce/contracts': `${ROOT}/packages/contracts`,
      'backend/node_modules/@endora-commerce/page-builder-core': `${ROOT}/packages/page-builder-core`,
    },
  });
}

describe('workspace resolution guard', () => {
  it('accepts a checkout whose @endora-commerce links all land inside it', () => {
    const report = inspectWorkspaceResolution(ROOT, wiredCorrectly());

    expect(report.packages).toEqual(['@endora-commerce/contracts', '@endora-commerce/page-builder-core']);
    expect(report.links.map((link) => link.verdict)).toEqual(['local', 'local']);
    expect(workspaceResolutionRefusal(report)).toBeNull();
  });

  it('refuses a link that re-roots at another checkout — the symlinked worktree', () => {
    // Exactly what `ln -s /main/backend/node_modules <worktree>/backend/node_modules`
    // produces: the relative `@endora-commerce` link inside it resolves at the main tree.
    const fs = fakeCheckout({
      packages: ['contracts', 'page-builder-core'],
      workspaces: { backend: ['@endora-commerce/contracts', '@endora-commerce/page-builder-core'] },
      links: {
        'backend/node_modules/@endora-commerce/contracts': '/home/dev/b2b-platform/packages/contracts',
        'backend/node_modules/@endora-commerce/page-builder-core': `${ROOT}/packages/page-builder-core`,
      },
    });

    const report = inspectWorkspaceResolution(ROOT, fs);
    const refusal = workspaceResolutionRefusal(report);

    expect(report.links.find((link) => link.specifier === '@endora-commerce/contracts')?.verdict).toBe(
      'foreign',
    );
    expect(refusal?.kind).toBe('foreign');
    expect(refusal?.message).toContain('backend/node_modules/@endora-commerce/contracts');
    expect(refusal?.message).toContain('/home/dev/b2b-platform/packages/contracts');
    expect(refusal?.message).toContain(ALLOW_FOREIGN_ENV);
  });

  it('refuses a declared link that is not installed', () => {
    const fs = fakeCheckout({
      packages: ['contracts'],
      workspaces: { admin: ['@endora-commerce/contracts'] },
      links: {},
    });

    const refusal = workspaceResolutionRefusal(inspectWorkspaceResolution(ROOT, fs));

    expect(refusal?.kind).toBe('missing');
    expect(refusal?.message).toContain('admin/node_modules/@endora-commerce/contracts');
  });

  it('refuses a tree that holds no workspace package — it can answer nothing', () => {
    const fs = fakeCheckout({ packages: [], workspaces: { backend: [] }, links: {} });

    expect(workspaceResolutionRefusal(inspectWorkspaceResolution(ROOT, fs))?.kind).toBe(
      'no-packages',
    );
  });

  it('refuses a tree where nothing declares a workspace package', () => {
    const fs = fakeCheckout({
      packages: ['contracts'],
      workspaces: { backend: [] },
      links: {},
    });

    expect(workspaceResolutionRefusal(inspectWorkspaceResolution(ROOT, fs))?.kind).toBe(
      'no-links',
    );
  });

  it('reads devDependencies as well as dependencies, and never peerDependencies', () => {
    // `@endora-commerce/page-builder-core` is a peer *and* a devDependency of the two
    // component packages. pnpm links it because of the devDependency; a
    // peer-only entry would be reported missing on a perfectly good tree.
    const manifestOf = (path: string): unknown => {
      if (path === join(ROOT, 'packages', 'page-builder-core', 'package.json')) {
        return { name: '@endora-commerce/page-builder-core' };
      }
      if (path === join(ROOT, 'packages', 'cms-components', 'package.json')) {
        return {
          name: '@endora-commerce/cms-components',
          peerDependencies: { '@endora-commerce/page-builder-core': 'workspace:^' },
          devDependencies: { '@endora-commerce/page-builder-core': 'workspace:^' },
        };
      }
      if (path === join(ROOT, 'packages', 'email-components', 'package.json')) {
        return {
          name: '@endora-commerce/email-components',
          peerDependencies: { '@endora-commerce/page-builder-core': 'workspace:^' },
        };
      }
      return null;
    };
    const fs: ResolutionFs = {
      readText: (path) => {
        if (path === join(ROOT, 'pnpm-workspace.yaml')) return 'packages:\n  - packages/*\n';
        const manifest = manifestOf(path);
        return manifest === null ? null : JSON.stringify(manifest);
      },
      readJson: manifestOf,
      listDirectories: (path) =>
        path === join(ROOT, 'packages')
          ? ['page-builder-core', 'cms-components', 'email-components']
          : path === ROOT
            ? ['packages']
            : [],
      realpath: (path) =>
        path === join(ROOT, 'packages/cms-components/node_modules/@endora-commerce/page-builder-core')
          ? `${ROOT}/packages/page-builder-core`
          : null,
    };

    const report = inspectWorkspaceResolution(ROOT, fs);

    expect(report.links).toHaveLength(1);
    expect(report.links[0]?.consumer).toBe('packages/cms-components');
    expect(workspaceResolutionRefusal(report)).toBeNull();
  });

  it('sees a package the globs nest, which a scan of `packages/` cannot (T040a)', () => {
    // The #255 guard's population used to be `readdir('packages')` filtered by
    // the literal `'@endora-commerce/'`. Feature 080 puts 66 module packages one level
    // deeper, and a package this guard cannot see is a package with **no**
    // protection: its `node_modules` link can re-root at another checkout and
    // the run compiles that branch while reporting a clean tick. So the fixture
    // declares the deeper glob and plants the foreign link under it — a run
    // that still scanned one level would report `no-links` and pass.
    const fs = fakeCheckout({
      globs: ['backend', 'packages/*', 'packages/modules/*'],
      packages: ['contracts', 'packages/modules/blog'],
      workspaces: { backend: ['@endora-commerce/contracts', '@endora-commerce/blog'] },
      links: {
        'backend/node_modules/@endora-commerce/contracts': `${ROOT}/packages/contracts`,
        'backend/node_modules/@endora-commerce/blog': '/home/dev/b2b-platform/packages/modules/blog',
      },
    });

    const report = inspectWorkspaceResolution(ROOT, fs);
    const refusal = workspaceResolutionRefusal(report);

    expect(report.packages).toEqual(['@endora-commerce/blog', '@endora-commerce/contracts']);
    expect(refusal?.kind).toBe('foreign');
    expect(refusal?.message).toContain('backend/node_modules/@endora-commerce/blog');
  });

  it('reports the scopes its own globs produce, not a scope written down (T040a)', () => {
    // The other half of the same defect. `WORKSPACE_SCOPE = '@endora-commerce/'` was a
    // constant, and a second scope — which is what an extension-package
    // programme introduces — would have been invisible to the predicate and
    // absent from the message. Both are derived now, so a run says which
    // scopes it was answering about.
    const fs = fakeCheckout({
      globs: ['backend', 'packages/*', 'packages/modules/*'],
      packages: ['contracts', 'packages/modules/blog'],
      workspaces: { backend: ['@endora-commerce/contracts'] },
      links: { 'backend/node_modules/@endora-commerce/contracts': `${ROOT}/packages/contracts` },
    });

    expect(inspectWorkspaceResolution(ROOT, fs).scopes).toEqual(['@endora-commerce/']);
  });

  it('does not mistake a sibling directory with a shared prefix for this checkout', () => {
    expect(isInsideCheckout('/srv/app', '/srv/app-2/packages/contracts')).toBe(false);
    expect(isInsideCheckout('/srv/app', '/srv/app/packages/contracts')).toBe(true);
    expect(isInsideCheckout('/srv/app', '/srv/app')).toBe(true);
  });

  it('lets a deliberate cross-checkout measurement through the override', () => {
    expect(() =>
      assertWorkspacePackagesAreLocal('/nowhere', { [ALLOW_FOREIGN_ENV]: '1' }),
    ).not.toThrow();
  });
});

describe('this checkout', () => {
  const root = findCheckoutRoot(process.cwd());

  it('is a checkout of this repository', () => {
    expect(root).not.toBeNull();
  });

  it('resolves every @endora-commerce/* package to its own packages/ directory', () => {
    // The guard `vitest.config.base.ts` already ran, as a test: a worktree
    // wired at another checkout fails here with the same sentence.
    const report = inspectWorkspaceResolution(root!, nodeResolutionFs());
    const refusal = workspaceResolutionRefusal(report);

    expect(refusal === null ? null : refusal.message).toBeNull();
    expect(report.links.length).toBeGreaterThan(0);
  });

  it('maps a workspace package in tsconfig.base.json paths exactly when its sources are its own', () => {
    // Since feature 080's T040a `report.packages` comes from the workspace
    // globs rather than from `readdir('packages')`, so this assertion now
    // covers a package the globs nest as well — which is what makes it the
    // enforcement point for the `paths` entries F4's module packages will
    // need. No entry is added here in advance: `paths` maps a directory that
    // exists, and writing one for a package T040b has not created yet would be
    // a guess about a layout nobody has chosen.
    // `paths` is what makes `tsc` read the worktree's own packages instead of
    // whatever the node_modules symlink points at, and it is relative to this
    // file, so it re-roots with the checkout. It is also hand-written:
    // `@endora-commerce/page-builder-core` was added to `packages/` without an entry, and
    // for as long as that stood, one run type-checked one branch and executed
    // another.
    //
    // **It is required exactly when the package's published sources live under
    // its own directory, and refused when they do not** (feature 080, T042a).
    // The host package `@endora-commerce/platform` is the second case and is
    // the reason this is two-way rather than one: its `rootDir` is
    // `backend/src`, so its sources are already this checkout's own — `tsc`
    // compiles them directly, through no specifier, and there is nothing for a
    // `paths` entry to redirect. An entry would not be merely idle: every
    // tsconfig in this repository extends `tsconfig.base.json`, including
    // `backend/acceptance/fixture-package`, whose entire purpose is a
    // resolution path that does **not** lead back into this repository. A
    // `paths` entry would capture that package's `@endora-commerce/platform`
    // import, resolve it into `backend/src`, and put a file outside the
    // fixture's `rootDir` in its program — TS6059, and the acceptance criterion
    // stops measuring what it says it measures.
    //
    // Both halves are derived from each package's own `tsconfig.build.json`,
    // never from a list here: a package that moves its sources changes this
    // answer in the same merge request that moves them.
    const tsconfig = JSON.parse(readFileSync(join(root!, 'tsconfig.base.json'), 'utf8')) as {
      compilerOptions?: { paths?: Record<string, readonly string[]> };
    };
    const paths = tsconfig.compilerOptions?.paths ?? {};
    const report = inspectWorkspaceResolution(root!, nodeResolutionFs());
    const members = workspaceMembers(root!, nodeWorkspaceFs());

    const sourcesAreItsOwn = (name: string): boolean => {
      const member = members.find((m) => m.name === name);
      if (member === undefined) return true;
      const build = readFileSync(join(member.dir, 'tsconfig.build.json'), 'utf8')
        .split('\n')
        .map((line) => (/^\s*\/\//.test(line) ? '' : line))
        .join('\n');
      const rootDir = (
        JSON.parse(build) as { compilerOptions?: { rootDir?: string } }
      ).compilerOptions?.rootDir;
      if (rootDir === undefined) return true;
      return isInsideCheckout(member.dir, resolve(member.dir, rootDir));
    };

    // Required means **both** entries — the bare specifier and the subpath one.
    // Refused means **neither**: one of the two is still a capture.
    const fullyMapped = (name: string): boolean =>
      paths[name] !== undefined && paths[`${name}/*`] !== undefined;
    const mappedAtAll = (name: string): boolean =>
      paths[name] !== undefined || paths[`${name}/*`] !== undefined;

    const unmapped = report.packages.filter((name) => sourcesAreItsOwn(name) && !fullyMapped(name));
    const wronglyMapped = report.packages.filter(
      (name) => !sourcesAreItsOwn(name) && mappedAtAll(name),
    );

    expect(report.packages.length).toBeGreaterThan(0);
    // Both populations must be non-empty for this to be measuring anything, and
    // they are: five packages compile their own `src`, and the host compiles
    // `backend/src`.
    expect(report.packages.filter(sourcesAreItsOwn).length).toBeGreaterThan(0);
    expect(report.packages.filter((name) => !sourcesAreItsOwn(name)).length).toBeGreaterThan(0);
    expect(unmapped).toEqual([]);
    expect(wronglyMapped).toEqual([]);
  });
});
