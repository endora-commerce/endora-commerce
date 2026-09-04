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
 * The last tests are about this repository rather than a fixture: one keeps
 * the `tsconfig.base.json` `paths` block complete, which is what makes `tsc`
 * resolve `@endora-commerce/*` inside the checkout it is run from, and one asserts that the
 * checkout running the suite is itself correctly wired.
 *
 * The final `describe` asks a different question, and it is the one nothing
 * asked until 2026-08-28: **which runs consult the guard at all?** The guard's
 * own population is complete — it classifies every declared consumer→package
 * link in the checkout, 234 of them today, whichever workspace invoked it — but
 * it is evaluated only when `vitest.config.base.ts` is imported, so a workspace
 * that runs vitest without a configuration merging the base never asks. Five
 * packages sat there for as long as they had existed, green and unexamined,
 * while AGENTS.md correctly said the guard "covers `backend`, `admin` and
 * `storefront` in one place". That sentence was true; being true is not the
 * same as being complete, and a list is what let the difference go unnoticed.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  nodeWorkspaceFs,
  workspaceMembers,
  type WorkspaceMember,
} from '../../../scripts/lib/workspace-packages.js';
import { platformSourceRootOf } from '../../../scripts/lib/platform-root.js';
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

/**
 * A workspace member's `tsconfig.build.json`, or `null` when it has none.
 *
 * Injected so the two answers below enter at the top of the analysis rather
 * than at a value the predicate normally computes (issue #130): "this member
 * ships no build config" is a **file-level** fact, and a fixture handing in a
 * parsed `rootDir` would leave the branch that reads the file unrun — which is
 * the branch that was missing.
 */
export type BuildConfigReader = (memberDir: string) => string | null;

/** The real filesystem behind {@link BuildConfigReader}. Absence is `null`, never a throw. */
export function nodeBuildConfigReader(): BuildConfigReader {
  return (memberDir: string): string | null => {
    try {
      return readFileSync(join(memberDir, 'tsconfig.build.json'), 'utf8');
    } catch {
      return null;
    }
  };
}

/**
 * Does this member publish sources that live under its own directory?
 *
 * Three answers, and the first is the one feature 080's T041a added:
 *
 *   * **no `tsconfig.build.json` at all** → `true`. A member that produces no
 *     build keeps its sources where they are, so they *are* its own, and a
 *     `paths` entry is therefore **required** for it. That is not a
 *     technicality: D-140 rules that a module package ships source and emits no
 *     `dist`, so `packages/modules/<id>` is the first member with no build
 *     config, and the previous unguarded `readFileSync` threw `ENOENT` on it —
 *     a crash where a verdict belongs. It is written as an explicit
 *     missing-file branch rather than a `try`/`catch` around the parse, because
 *     "the file is not there" and "the file is there and unreadable" are
 *     different facts and only the first has an honest default.
 *   * **a build config with no `rootDir`** → `true`, for the same reason: the
 *     default root is the config's own directory.
 *   * **a `rootDir` outside the member** → `false`. `@endora-commerce/platform`
 *     is the only one today.
 */
export function sourcesAreItsOwn(memberDir: string, read: BuildConfigReader): boolean {
  const build = read(memberDir);
  if (build === null) return true;
  const withoutComments = build
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
  const rootDir = (JSON.parse(withoutComments) as { compilerOptions?: { rootDir?: string } })
    .compilerOptions?.rootDir;
  if (rootDir === undefined) return true;
  return isInsideCheckout(memberDir, resolve(memberDir, rootDir));
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

  it('answers for a member that ships source and no build, instead of throwing (T041a)', () => {
    // The fixture enters at the file: a reader that reports the build config
    // **absent**, which is what `packages/modules/<id>` is under D-140 — source,
    // no `dist`, no `tsconfig.build.json`. Before this branch existed the
    // predicate called `readFileSync` unguarded and the first module package
    // made this assertion die with ENOENT rather than answer.
    const absent: BuildConfigReader = () => null;

    expect(sourcesAreItsOwn('/repo/packages/modules/blog', absent)).toBe(true);
  });

  it('keeps both other answers, so the missing-file branch is not the only one (T041a)', () => {
    // The discrimination the branch above must not swallow. A member that
    // *does* ship a build config still answers from its `rootDir`, and the two
    // answers must stay different — a guard written as "return true on
    // anything unreadable" would make every package's sources its own and the
    // `wronglyMapped` half of the assertion below would stop measuring.
    const ownRoot: BuildConfigReader = () =>
      '{\n  // a comment, which JSON.parse cannot take\n  "compilerOptions": { "rootDir": "./src" }\n}';
    const elsewhere: BuildConfigReader = () =>
      '{ "compilerOptions": { "rootDir": "../../backend/src" } }';
    const noRootDir: BuildConfigReader = () => '{ "compilerOptions": { "outDir": "./dist" } }';

    expect(sourcesAreItsOwn('/repo/packages/contracts', ownRoot)).toBe(true);
    expect(sourcesAreItsOwn('/repo/packages/platform', elsewhere)).toBe(false);
    expect(sourcesAreItsOwn('/repo/packages/contracts', noRootDir)).toBe(true);
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
    // its own directory, and refused for a package the running process composes
    // — the host and every module package** (feature 080, the relocation and
    // T040b).
    //
    // The refusal used to follow from the derivation: `@endora-commerce/platform`
    // compiled `backend/src`, so there was nothing for a `paths` entry to
    // redirect *into* the package. The relocation moved those five directories
    // into `packages/platform/src`, so `sourcesAreItsOwn` now answers `true` for
    // it and the derivation alone would **require** the entry. It is still
    // refused, and for a reason the other five packages do not have.
    //
    // `paths` is honoured by `tsc` and by `tsx`, and **not** by `vitest` or by
    // `node`. An entry pointing at `packages/platform/src` would therefore make
    // the application resolve the platform's *source* under `tsx` and its
    // *`dist`* under vitest and in production — two module records for one set
    // of files, which is precisely the duplication this package was relocated to
    // end. For `contracts` and the three component packages that split costs
    // nothing: they export schemas, types and React components, and
    // nothing compares one of those by identity. The platform exports
    // `HttpError` (`instanceof`, at two dispatch sites), `SalesChannel` (an ORM
    // entity class, `Duplicate entity names are not allowed`), `effectiveState`
    // and `getResolvedChannel` (module-scoped singletons), and every one of them
    // is wrong in a way `tsc` cannot see.
    //
    // **A module package is refused on the same grounds, one step sharper**
    // (T040b). It exports `@Entity()` classes, which the ORM keys its metadata
    // on, so a second copy is `Duplicate entity names are not allowed` or —
    // measured, D-160.6 — a silent drop from discovery. And a module package
    // ships `dist` *because* its decorated source cannot be loaded by a `tsx`
    // process at all (D-164): `tsx` applies one tsconfig per process and lowers
    // a file outside it with standard decorator semantics, so an entry here
    // would point every `tsx` entry point — `dev`, `db:fresh`, the composer
    // itself — at eleven entity files that die on load.
    //
    // The refusal is **derived, not listed**: a member that declares an
    // `endora` block is one this platform composes into its own process, and
    // that is the whole predicate. The other five declare none, and a 66th
    // module package changes this answer by existing rather than by being added
    // here.
    // `test/unit/kernel/platform-single-copy.test.ts` measures the property this
    // protects.
    //
    // **The reason recorded here until feature 080's T041a was false, and is
    // corrected rather than dropped.** It said an entry would capture
    // `backend/acceptance/fixture-package`'s host import and produce TS6059.
    // It would not: that tsconfig sets `"paths": {}` and says so in its own
    // comment, so nothing in `tsconfig.base.json` reaches it.
    //
    // Both halves are derived — `sourcesAreItsOwn` from each package's own
    // `tsconfig.build.json`, and which member is the platform from its own
    // `endora: { type: 'platform' }` block, the same declaration every walk in
    // `scripts/lib/platform-root.ts` reads. Neither is a list here: a package
    // that moves its sources, or a repository that stops shipping a platform,
    // changes this answer in the merge request that does it.
    const tsconfig = JSON.parse(readFileSync(join(root!, 'tsconfig.base.json'), 'utf8')) as {
      compilerOptions?: { paths?: Record<string, readonly string[]> };
    };
    const paths = tsconfig.compilerOptions?.paths ?? {};
    const report = inspectWorkspaceResolution(root!, nodeResolutionFs());
    const members = workspaceMembers(root!, nodeWorkspaceFs());

    const read = nodeBuildConfigReader();
    const publishesItsOwnSources = (name: string): boolean => {
      const member = members.find((m) => m.name === name);
      return member === undefined ? true : sourcesAreItsOwn(member.dir, read);
    };

    // Required means **both** entries — the bare specifier and the subpath one.
    // Refused means **neither**: one of the two is still a capture.
    const fullyMapped = (name: string): boolean =>
      paths[name] !== undefined && paths[`${name}/*`] !== undefined;
    const mappedAtAll = (name: string): boolean =>
      paths[name] !== undefined || paths[`${name}/*`] !== undefined;

    const platformDir = platformSourceRootOf(members);
    const isPlatform = (name: string): boolean => {
      const member = members.find((m) => m.name === name);
      return member !== undefined && platformDir !== null && platformDir.startsWith(member.dir);
    };
    /**
     * A member the running platform **composes**: the host, or a module package.
     *
     * The predicate is the `endora` block's `type`, and it used to be the block's
     * mere presence — true while `'platform'` and `'module'` were the only two
     * values, and false the day feature 091's P5c gave `@endora-commerce/admin-kit`
     * an `endora: { type: 'admin-ui' }` block so that two instruments could find
     * every package of admin UI by declaration instead of by name. That is a
     * third value and it is not a composed member: an admin-ui package is
     * resolved by `admin` as a library, exactly as the kit was before it carried
     * the block, so it keeps its `paths` entries and this test went red on
     * `master` for asserting the opposite.
     *
     * What the refusal is actually about is unchanged: `paths` is honoured by
     * `tsc` and `tsx` and not by `vitest` or `node`, so an entry for something
     * the platform composes would make one process resolve its source and
     * another its `dist`. Nothing composes an admin-ui package, and both
     * frontends resolve it through its own `exports` map in every process.
     */
    const isComposed = (name: string): boolean => {
      const member = members.find((m) => m.name === name);
      const endora = member?.manifest['endora'];
      if (typeof endora !== 'object' || endora === null || Array.isArray(endora)) return false;
      const type = (endora as Record<string, unknown>)['type'];
      return type === 'platform' || type === 'module';
    };

    const unmapped = report.packages.filter(
      (name) => publishesItsOwnSources(name) && !isComposed(name) && !fullyMapped(name),
    );
    const wronglyMapped = report.packages.filter(
      (name) => (!publishesItsOwnSources(name) || isComposed(name)) && mappedAtAll(name),
    );

    expect(report.packages.length).toBeGreaterThan(0);
    // Both populations must be non-empty for this to be measuring anything:
    // five packages are mapped because their sources are their own, and the
    // composed ones are refused because of what their exports are.
    expect(
      report.packages.filter((name) => publishesItsOwnSources(name) && !isComposed(name)).length,
    ).toBeGreaterThan(0);
    expect(report.packages.filter(isPlatform).length).toBe(1);
    expect(report.packages.filter(isComposed).length).toBeGreaterThan(1);
    expect(unmapped).toEqual([]);
    expect(wronglyMapped).toEqual([]);
  });
});

/**
 * A workspace member's vitest configuration files: filename → source text.
 *
 * Injected so the two findings below enter at the **top** of the analysis
 * (issue #130). "This member has no vitest configuration" and "this
 * configuration does not import the base" are both file-level facts, and a
 * fixture handing in a pre-classified verdict would leave the reading — which
 * is the half that goes wrong — unrun.
 *
 * An unreadable configuration is recorded with empty text rather than skipped,
 * so it fails as unmerged: a file the reader cannot open is a file whose
 * imports nobody has seen.
 */
export type VitestConfigReader = (memberDir: string) => ReadonlyMap<string, string>;

/** The real filesystem behind {@link VitestConfigReader}. Absence is an empty map, never a throw. */
export function nodeVitestConfigReader(): VitestConfigReader {
  return (memberDir: string): ReadonlyMap<string, string> => {
    const found = new Map<string, string>();
    let entries: readonly string[];
    try {
      entries = readdirSync(memberDir);
    } catch {
      return found;
    }
    for (const entry of entries) {
      if (!/^vitest[\w.-]*\.config\.(?:[cm])?[jt]s$/.test(entry)) continue;
      try {
        found.set(entry, readFileSync(join(memberDir, entry), 'utf8'));
      } catch {
        found.set(entry, '');
      }
    }
    return found;
  };
}

/**
 * Does this script invoke vitest?
 *
 * A word test over the script text: `vitest run`, `pnpm exec vitest run --config …`,
 * `NODE_OPTIONS=… vitest`. It is deliberately over-approximating — `echo vitest` would match
 * — because the two answers are not symmetrical. A false positive costs one configuration
 * file nobody needed; a false negative is a workspace that runs vitest and is reported as not
 * running it, which is this whole file's failure shape.
 */
function invokesVitest(script: string): boolean {
  return /(^|[\s;&|])vitest(\s|$)/.test(script);
}

/**
 * Every workspace member whose vitest runs would not evaluate the #255 guard.
 *
 * Two findings, because the tree has produced both:
 *
 *   * **`no-configuration`** — a member with a script that invokes vitest and no
 *     `vitest*.config.*` file at all. vitest then runs on its own defaults,
 *     imports nothing of ours, and the run is outside the guard with nothing in
 *     its output to say so. `contracts`, `api-client`, `cms-components` and
 *     `email-components` were all this, and the absence of a file is precisely
 *     what made it invisible in review.
 *   * **`unmerged-configuration`** — a configuration that exists and does not
 *     name the base. Worse than the first, because the file is there:
 *     `page-builder-core` shipped one for as long as it had tests.
 *   * **`cjs-loaded-configuration`** — a configuration that names the base and
 *     that vite must load as CommonJS. Worse than both, because the file is
 *     there **and** it names the base, so the two findings above read it as
 *     guarded while the run does not start at all. The base's import chain
 *     reaches `@endora-commerce/cli`, which is `"type": "module"` and publishes
 *     no CJS entry point, so a `require` of it is
 *     `ESM file cannot be loaded by \`require\``: a **startup** error, before
 *     the first test file and before any guard line. `storefront` was this from
 *     2026-08-30, when `backend/scripts/lib/workspace-packages.ts` became a
 *     re-export of that package, until it was found on 2026-09-02 — three days
 *     in which its 80 files and 514 tests did not run and `test:frontend`
 *     reported the failure as the whole job's rather than as one suite going
 *     dark. It is the one workspace member with no `"type": "module"`, which is
 *     the entire reason it was the only one affected.
 *
 * The third predicate is **derived from how vite loads a config**, not from a
 * list of members: `.mts`/`.mjs` is ESM whatever the manifest says, `.cts`/`.cjs`
 * is CJS whatever the manifest says, and a bare `.ts`/`.js` takes the member's
 * own `type` field. So a member that adds `"type": "module"` stops being a
 * finding in the same run, and a sixth package arriving without one becomes a
 * finding by existing.
 *
 * The predicate is the **import**, not `mergeConfig`. The refusal is a
 * module-level call in `vitest.config.base.ts`, so importing it is what
 * evaluates it; a configuration that imported the base and merged nothing would
 * still be guarded, and one that merges a base it does not import cannot exist.
 */
/**
 * Will vite load this configuration file as an ES module?
 *
 * The extension wins where it is explicit — `.mts`/`.mjs` and `.cts`/`.cjs` each
 * declare the answer outright — and a bare `.ts`/`.js` takes the member's own
 * `type` field, which is Node's rule and the one vite follows.
 */
function loadsAsEsm(file: string, manifest: Readonly<Record<string, unknown>>): boolean {
  if (/\.m[jt]s$/.test(file)) return true;
  if (/\.c[jt]s$/.test(file)) return false;
  return manifest['type'] === 'module';
}

export function runsOutsideTheGuard(
  members: readonly WorkspaceMember[],
  read: VitestConfigReader,
): readonly string[] {
  const findings: string[] = [];
  for (const member of members) {
    const scripts = (member.manifest['scripts'] ?? {}) as Readonly<Record<string, string>>;
    const configs = read(member.dir);
    for (const [file, source] of configs) {
      if (!source.includes('vitest.config.base')) {
        findings.push(`unmerged-configuration ${member.name} ${file}`);
        continue;
      }
      // It names the base; whether it can *load* it is the separate question.
      if (!loadsAsEsm(file, member.manifest)) {
        findings.push(`cjs-loaded-configuration ${member.name} ${file}`);
      }
    }
    if (configs.size > 0) continue;
    const runner = Object.entries(scripts).find(([, script]) => invokesVitest(script));
    if (runner !== undefined) {
      findings.push(`no-configuration ${member.name} (script \`${runner[0]}\`)`);
    }
  }
  return findings.sort();
}

describe('which runs consult the guard', () => {
  /** A member list with the manifest fields this predicate reads, and nothing else. */
  const member = (
    name: string,
    scripts: Readonly<Record<string, string>>,
    type?: 'module',
  ): WorkspaceMember => ({
    dir: `/repo/${name}`,
    name,
    manifest: type === undefined ? { name, scripts } : { name, scripts, type },
  });

  it('reports a member that runs vitest with no configuration at all', () => {
    // The four packages measured on 2026-08-28. The fixture enters at the
    // reader: a member directory holding no vitest configuration, which is the
    // fact the finding is about.
    const findings = runsOutsideTheGuard(
      [member('@endora-commerce/contracts', { test: 'vitest run' })],
      () => new Map(),
    );

    expect(findings).toEqual(['no-configuration @endora-commerce/contracts (script `test`)']);
  });

  it('reports a configuration that exists and does not import the base', () => {
    // `page-builder-core`, which is the shape a reader cannot spot: the file is
    // there, the run is green, and the guard was never loaded.
    const findings = runsOutsideTheGuard(
      [member('@endora-commerce/page-builder-core', { test: 'vitest run' })],
      () =>
        new Map([
          ['vitest.config.ts', "import { defineConfig } from 'vitest/config';\nexport default defineConfig({});\n"],
        ]),
    );

    expect(findings).toEqual([
      'unmerged-configuration @endora-commerce/page-builder-core vitest.config.ts',
    ]);
  });

  it('reports a configuration that names the base and that vite must load as CJS', () => {
    // `storefront` from 2026-08-30 to 2026-09-02. The file is there and it names
    // the base, so both findings above read it as guarded; what it cannot do is
    // `require` the base's ESM-only import chain, and the run dies at startup
    // with no guard line and no test file. The fixture enters at the reader and
    // at the manifest — the two facts the finding is derived from — rather than
    // at a verdict.
    const findings = runsOutsideTheGuard(
      [member('storefront', { test: 'vitest run' })],
      () =>
        new Map([
          ['vitest.config.ts', "import baseConfig from '../vitest.config.base.js';"],
        ]),
    );

    expect(findings).toEqual(['cjs-loaded-configuration storefront vitest.config.ts']);
  });

  it('accepts the same configuration under either spelling that makes it ESM', () => {
    // Both remedies, so the predicate cannot be satisfied by one of them alone:
    // the `.mts` extension, which is what `storefront` took, and a member that
    // declares `"type": "module"`, which is what the other four already had.
    const base = "import baseConfig from '../vitest.config.base.js';";

    expect(
      runsOutsideTheGuard(
        [member('storefront', { test: 'vitest run' })],
        () => new Map([['vitest.config.mts', base]]),
      ),
    ).toEqual([]);

    expect(
      runsOutsideTheGuard(
        [member('admin', { test: 'vitest run' }, 'module')],
        () => new Map([['vitest.config.ts', base]]),
      ),
    ).toEqual([]);
  });

  it('refuses an explicit `.cts` even in a member that declares `"type": "module"`', () => {
    // The extension is the stronger declaration in Node's own rule, so a member
    // whose manifest says ESM does not launder a file that says CJS. Without
    // this the predicate would read the manifest alone and miss the one spelling
    // that is CJS by its own name.
    const findings = runsOutsideTheGuard(
      [member('admin', { test: 'vitest run' }, 'module')],
      () =>
        new Map([['vitest.config.cts', "import baseConfig from '../vitest.config.base.js';"]]),
    );

    expect(findings).toEqual(['cjs-loaded-configuration admin vitest.config.cts']);
  });

  it('accepts a configuration that imports the base, and is silent about a member that runs no vitest', () => {
    // Both directions in one, so a predicate that simply reported everything
    // would fail here: `docs` runs an `echo` naming no runner and is not a
    // finding, and a merged configuration is not one either.
    const findings = runsOutsideTheGuard(
      [
        // `"type": "module"`, as the real package is — the configuration below
        // names the base, so an under-specified manifest here would make this
        // case assert the opposite of what it says.
        member('@endora-commerce/contracts', { test: 'vitest run' }, 'module'),
        member('docs', { test: "echo 'docs site has no tests'" }),
      ],
      (dir) =>
        dir.endsWith('contracts')
          ? new Map([['vitest.config.ts', "import baseConfig from '../../vitest.config.base.js';"]])
          : new Map(),
    );

    expect(findings).toEqual([]);
  });

  it('reads an unreadable configuration as unmerged rather than skipping it', () => {
    // A file the reader could not open has imports nobody has seen. Failing
    // closed is the only answer that cannot become a silent pass.
    const findings = runsOutsideTheGuard(
      [member('@endora-commerce/contracts', { test: 'vitest run' })],
      () => new Map([['vitest.config.ts', '']]),
    );

    expect(findings).toEqual(['unmerged-configuration @endora-commerce/contracts vitest.config.ts']);
  });

  it('every workspace that runs vitest in this checkout evaluates the guard', () => {
    // The derivation AGENTS.md now states instead of naming three workspaces:
    // coverage is every workspace whose vitest configuration imports
    // `vitest.config.base.ts`, and a run says so itself by printing the
    // `[workspace-resolution] read:` line. This is that sentence, enforced —
    // so the next package added to `packages/` is either covered or red here,
    // rather than quietly outside a list that used to be complete.
    const root = findCheckoutRoot(process.cwd());
    const members = workspaceMembers(root!, nodeWorkspaceFs());
    const read = nodeVitestConfigReader();

    // Floors, one per input whose silence would make this vacuous: members at
    // all, members that run vitest, and configuration files actually read.
    const runners = members.filter((m) =>
      Object.values((m.manifest['scripts'] ?? {}) as Readonly<Record<string, string>>).some(
        invokesVitest,
      ),
    );
    const configured = members.filter((m) => read(m.dir).size > 0);
    expect(members.length).toBeGreaterThan(0);
    expect(runners.length).toBeGreaterThan(0);
    expect(configured.length).toBeGreaterThan(0);

    expect(runsOutsideTheGuard(members, read)).toEqual([]);
  });
});
