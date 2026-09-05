/**
 * A whole synthetic checkout for `check-release-intent`, in memory.
 *
 * The check's input is a *repository* — `pnpm-workspace.yaml`, a manifest per
 * member, `.changeset/config.json` and the changeset files — and every one of
 * its findings is a disagreement *between* those files. A fixture that
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
 *
 * **Both library packages are public and fit**, and that changed with the
 * owner's publication ruling of 2026-09-05. It is not cosmetic: a fixture whose
 * *default* state is a violation makes every other proof read against noise,
 * and under `unpublished-package` two `private: true` members are two findings
 * in every run of every case. The two states that genuinely need a private
 * member — `version-disabled` and the first half of `tag-policy-unstated` —
 * ask for one explicitly through {@link PRIVATE_BETA}, which is the direction
 * that keeps each proof's precondition visible in the proof.
 */
export const DEFAULT_CHECKOUT: FileMap = {
  'pnpm-workspace.yaml': 'packages:\n  - apps/host\n  - packages/*\n',
  'package.json': '{ "name": "root", "version": "0.0.0", "private": true }',
  // The application is a **Next** application. That was how the check found the
  // reference storefront whose dependency closure was the publication set
  // (feature 104, FR-001); the ruling of 2026-09-05 retired that closure, and
  // the shape stays because `ignore` and `unignored-application` are about an
  // application and this is the only one in the fixture. It declares no `@fx/*`
  // dependency — `PUBLISHED_ALPHA` is the override that adds one, which several
  // proofs still want for reasons of their own.
  'apps/host/package.json': JSON.stringify({
    name: 'host',
    version: '0.0.0',
    private: true,
    scripts: { build: 'next build' },
    dependencies: { next: '^15.0.0' },
  }),
  'packages/alpha/package.json': JSON.stringify({
    name: '@fx/alpha',
    version: '1.0.0',
    repository: { type: 'git', url: 'https://example.invalid/fx.git', directory: 'packages/alpha' },
    publishConfig: { access: 'public' },
  }),
  'packages/beta/package.json': JSON.stringify({
    name: '@fx/beta',
    version: '1.0.0',
    repository: { type: 'git', url: 'https://example.invalid/fx.git', directory: 'packages/beta' },
    publishConfig: { access: 'public' },
  }),
  // The emit configuration of each versionable package. `--since` reads it to
  // answer "which files does this package publish", and both defaults are the
  // ordinary shape: sources inside the package, which is the shape
  // `changeset status` already sees. The host-sourced shape is an override, so
  // a proof of it enters as a *configuration* rather than as a verdict.
  'packages/alpha/tsconfig.build.json':
    '{ "compilerOptions": { "rootDir": "./src" }, "include": ["src/**/*"] }',
  'packages/beta/tsconfig.build.json':
    '{ "compilerOptions": { "rootDir": "./src" }, "include": ["src/**/*"] }',
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

/**
 * `@fx/beta` re-shaped the way `@endora-commerce/platform` is (!891): the
 * manifest and both tsconfigs stay under `packages/beta`, and the code it
 * publishes lives in the application directory that `ignore` exempts. `include`
 * sits in the **extended** `tsconfig.json`, which is where !891 puts it — a
 * reader of the build file alone finds none and concludes the package publishes
 * nothing outside its own directory, which is the silence under test.
 */
export const HOST_SOURCED_PACKAGE: FileMap = {
  'packages/beta/tsconfig.build.json':
    '{ "extends": "./tsconfig.json", "compilerOptions": { "rootDir": "../../apps/host/src", "noEmit": false } }',
  'packages/beta/tsconfig.json':
    '{ "include": ["../../apps/host/src/kernel/**/*"], "exclude": ["../../apps/host/src/**/*.test.ts"] }',
};

/**
 * `@fx/alpha` published, the way a package that may be public actually looks.
 *
 * Three separate facts, and the fixture carries all three because a proof of any
 * one of the publication findings needs the other two out of the way: the
 * reference storefront **depends** on it (so it is in the derived publication
 * set), and it declares `repository` and `publishConfig.access` (so it is fit).
 * Overriding one field of it at a time is how each finding is driven — which is
 * also why this is a `FileMap` and not a boolean flag.
 */
export const PUBLISHED_ALPHA: FileMap = {
  'apps/host/package.json': JSON.stringify({
    name: 'host',
    version: '0.0.0',
    private: true,
    scripts: { build: 'next build' },
    dependencies: { next: '^15.0.0', '@fx/alpha': 'workspace:*' },
  }),
  'packages/alpha/package.json': JSON.stringify({
    name: '@fx/alpha',
    version: '1.0.0',
    repository: { type: 'git', url: 'https://example.invalid/fx.git', directory: 'packages/alpha' },
    publishConfig: { access: 'public' },
  }),
};

/**
 * `@fx/beta` back to `private: true` — the one state three findings are
 * conditional on.
 *
 * `version-disabled` and the first half of `tag-policy-unstated` both ask their
 * question *while a versionable package is private*, so a checkout with none
 * answers neither: their red proofs would go green for the wrong reason, which
 * is the silence this whole check is about. It is also `unpublished-package`'s
 * own subject. One override, because it is one fact — this workspace has a
 * package `changeset publish` would skip.
 */
export const PRIVATE_BETA: FileMap = {
  'packages/beta/package.json': '{ "name": "@fx/beta", "version": "1.0.0", "private": true }',
};

/** {@link PUBLISHED_ALPHA}'s manifest, with `mutate` applied to it. */
export function publishedAlphaAs(mutate: (manifest: Record<string, unknown>) => void): FileMap {
  const manifest = JSON.parse(PUBLISHED_ALPHA['packages/alpha/package.json'] as string) as Record<
    string,
    unknown
  >;
  mutate(manifest);
  return { ...PUBLISHED_ALPHA, 'packages/alpha/package.json': JSON.stringify(manifest) };
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

/**
 * One public package a *second* workspace glob puts a directory deeper — the
 * shape `packages/modules/*` has in this repository, and the one the publish
 * job's own derivation could not see.
 *
 * It is a whole checkout override rather than a flag because the thing under
 * test is the walk: the workspace file gains the nested entry, the member sits
 * under it, and `packages/*` goes on matching `packages/modules` itself, which
 * carries no manifest and is therefore the parent of members rather than a
 * member. That is the directory whose absent `package.json` the retired
 * `readdir` threw on.
 *
 * `@fx/alpha` and `@fx/beta` are put **back** to private here, so the nested
 * member is the **only** public package: a derivation that cannot reach it
 * resolves no scope at all rather than a subtly narrower one, which is what
 * makes the proof discriminate. They are private by override rather than by
 * default since the ruling of 2026-09-05 — the discrimination is this
 * fixture's, so it says so itself instead of inheriting it.
 */
export const NESTED_FAMILY_PACKAGE: FileMap = {
  'pnpm-workspace.yaml': 'packages:\n  - apps/host\n  - packages/*\n  - packages/modules/*\n',
  'packages/alpha/package.json': '{ "name": "@fx/alpha", "version": "1.0.0", "private": true }',
  'packages/beta/package.json': '{ "name": "@fx/beta", "version": "1.0.0", "private": true }',
  'apps/host/package.json': JSON.stringify({
    name: 'host',
    version: '0.0.0',
    private: true,
    scripts: { build: 'next build' },
    dependencies: { next: '^15.0.0', '@fx/gamma': 'workspace:*' },
  }),
  'packages/modules/gamma/package.json': JSON.stringify({
    name: '@fx/gamma',
    version: '1.0.0',
    repository: {
      type: 'git',
      url: 'https://example.invalid/fx.git',
      directory: 'packages/modules/gamma',
    },
    publishConfig: { access: 'public' },
  }),
  'packages/modules/gamma/tsconfig.build.json':
    '{ "compilerOptions": { "rootDir": "./src" }, "include": ["src/**/*"] }',
};
