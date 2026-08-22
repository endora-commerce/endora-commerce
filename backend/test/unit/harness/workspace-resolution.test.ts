/**
 * The guard that refuses a run whose `@b2b/*` source is another checkout's
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
 * resolve `@b2b/*` inside the checkout it is run from, and one asserts that the
 * checkout running the suite is itself correctly wired.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  /** Directory names under `packages/`, each getting a `@b2b/<name>` manifest. */
  readonly packages: readonly string[];
  /** Consumer directory → the `@b2b/*` specifiers its manifest declares. */
  readonly workspaces: Readonly<Record<string, readonly string[]>>;
  /**
   * `<consumer>/node_modules/<specifier>` → absolute path it resolves to.
   * A pair with no entry here has no link on disk at all.
   */
  readonly links: Readonly<Record<string, string>>;
}

/** A whole checkout, as the three questions {@link ResolutionFs} asks of one. */
function fakeCheckout(checkout: FakeCheckout): ResolutionFs {
  const manifests = new Map<string, unknown>();
  for (const pkg of checkout.packages) {
    manifests.set(join(ROOT, 'packages', pkg, 'package.json'), { name: `@b2b/${pkg}` });
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

  const directories = new Map<string, Set<string>>();
  const noteDirectory = (parent: string, child: string): void => {
    const bucket = directories.get(parent) ?? new Set<string>();
    bucket.add(child);
    directories.set(parent, bucket);
  };
  for (const pkg of checkout.packages) noteDirectory(join(ROOT, 'packages'), pkg);
  for (const dir of Object.keys(checkout.workspaces)) {
    const segments = dir.split('/');
    if (segments.length === 1 && segments[0] !== '.') noteDirectory(ROOT, segments[0]!);
    if (segments.length === 2) noteDirectory(join(ROOT, segments[0]!), segments[1]!);
  }

  return {
    readJson: (path) => manifests.get(path) ?? null,
    listDirectories: (path) => [...(directories.get(path) ?? [])],
    realpath: (path) => {
      for (const [link, target] of Object.entries(checkout.links)) {
        if (path === join(ROOT, link)) return target;
      }
      return manifests.has(path) ? path : null;
    },
  };
}

/** The wiring a correct checkout has: every link inside `/repo`. */
function wiredCorrectly(): ResolutionFs {
  return fakeCheckout({
    packages: ['contracts', 'page-builder-core'],
    workspaces: {
      backend: ['@b2b/contracts', '@b2b/page-builder-core'],
      'packages/contracts': [],
    },
    links: {
      'backend/node_modules/@b2b/contracts': `${ROOT}/packages/contracts`,
      'backend/node_modules/@b2b/page-builder-core': `${ROOT}/packages/page-builder-core`,
    },
  });
}

describe('workspace resolution guard', () => {
  it('accepts a checkout whose @b2b links all land inside it', () => {
    const report = inspectWorkspaceResolution(ROOT, wiredCorrectly());

    expect(report.packages).toEqual(['@b2b/contracts', '@b2b/page-builder-core']);
    expect(report.links.map((link) => link.verdict)).toEqual(['local', 'local']);
    expect(workspaceResolutionRefusal(report)).toBeNull();
  });

  it('refuses a link that re-roots at another checkout — the symlinked worktree', () => {
    // Exactly what `ln -s /main/backend/node_modules <worktree>/backend/node_modules`
    // produces: the relative `@b2b` link inside it resolves at the main tree.
    const fs = fakeCheckout({
      packages: ['contracts', 'page-builder-core'],
      workspaces: { backend: ['@b2b/contracts', '@b2b/page-builder-core'] },
      links: {
        'backend/node_modules/@b2b/contracts': '/home/dev/b2b-platform/packages/contracts',
        'backend/node_modules/@b2b/page-builder-core': `${ROOT}/packages/page-builder-core`,
      },
    });

    const report = inspectWorkspaceResolution(ROOT, fs);
    const refusal = workspaceResolutionRefusal(report);

    expect(report.links.find((link) => link.specifier === '@b2b/contracts')?.verdict).toBe(
      'foreign',
    );
    expect(refusal?.kind).toBe('foreign');
    expect(refusal?.message).toContain('backend/node_modules/@b2b/contracts');
    expect(refusal?.message).toContain('/home/dev/b2b-platform/packages/contracts');
    expect(refusal?.message).toContain(ALLOW_FOREIGN_ENV);
  });

  it('refuses a declared link that is not installed', () => {
    const fs = fakeCheckout({
      packages: ['contracts'],
      workspaces: { admin: ['@b2b/contracts'] },
      links: {},
    });

    const refusal = workspaceResolutionRefusal(inspectWorkspaceResolution(ROOT, fs));

    expect(refusal?.kind).toBe('missing');
    expect(refusal?.message).toContain('admin/node_modules/@b2b/contracts');
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
    // `@b2b/page-builder-core` is a peer *and* a devDependency of the two
    // component packages. pnpm links it because of the devDependency; a
    // peer-only entry would be reported missing on a perfectly good tree.
    const fs: ResolutionFs = {
      readJson: (path) => {
        if (path === join(ROOT, 'packages', 'page-builder-core', 'package.json')) {
          return { name: '@b2b/page-builder-core' };
        }
        if (path === join(ROOT, 'packages', 'cms-components', 'package.json')) {
          return {
            name: '@b2b/cms-components',
            peerDependencies: { '@b2b/page-builder-core': 'workspace:^' },
            devDependencies: { '@b2b/page-builder-core': 'workspace:^' },
          };
        }
        if (path === join(ROOT, 'packages', 'email-components', 'package.json')) {
          return {
            name: '@b2b/email-components',
            peerDependencies: { '@b2b/page-builder-core': 'workspace:^' },
          };
        }
        return null;
      },
      listDirectories: (path) =>
        path === join(ROOT, 'packages')
          ? ['page-builder-core', 'cms-components', 'email-components']
          : [],
      realpath: (path) =>
        path === join(ROOT, 'packages/cms-components/node_modules/@b2b/page-builder-core')
          ? `${ROOT}/packages/page-builder-core`
          : null,
    };

    const report = inspectWorkspaceResolution(ROOT, fs);

    expect(report.links).toHaveLength(1);
    expect(report.links[0]?.consumer).toBe('packages/cms-components');
    expect(workspaceResolutionRefusal(report)).toBeNull();
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

  it('resolves every @b2b/* package to its own packages/ directory', () => {
    // The guard `vitest.config.base.ts` already ran, as a test: a worktree
    // wired at another checkout fails here with the same sentence.
    const report = inspectWorkspaceResolution(root!, nodeResolutionFs());
    const refusal = workspaceResolutionRefusal(report);

    expect(refusal === null ? null : refusal.message).toBeNull();
    expect(report.links.length).toBeGreaterThan(0);
  });

  it('maps every workspace package in tsconfig.base.json paths', () => {
    // `paths` is what makes `tsc` read the worktree's own packages instead of
    // whatever the node_modules symlink points at, and it is relative to this
    // file, so it re-roots with the checkout. It is also hand-written:
    // `@b2b/page-builder-core` was added to `packages/` without an entry, and
    // for as long as that stood, one run type-checked one branch and executed
    // another.
    const tsconfig = JSON.parse(readFileSync(join(root!, 'tsconfig.base.json'), 'utf8')) as {
      compilerOptions?: { paths?: Record<string, readonly string[]> };
    };
    const paths = tsconfig.compilerOptions?.paths ?? {};
    const report = inspectWorkspaceResolution(root!, nodeResolutionFs());

    const unmapped = report.packages.filter(
      (name) => paths[name] === undefined || paths[`${name}/*`] === undefined,
    );

    expect(report.packages.length).toBeGreaterThan(0);
    expect(unmapped).toEqual([]);
  });
});
