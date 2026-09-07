/**
 * `endora new storefront` — the derivation, each rewrite, and every refusal.
 *
 * Two properties are asserted rather than the output being eyeballed, and they
 * are the two the command exists for:
 *
 *   * **the scaffold names nothing above its own directory.** Not "the seven
 *     declarations were rewritten" — the whole copy is re-analysed with the same
 *     derivation the command runs, and the answer has to be empty. A test
 *     asserting a count would go stale exactly as the roadmap's sentence did.
 *   * **an outward reference no rule classifies is a refusal**, with nothing
 *     written. That is what stops the first property from being achieved by a
 *     rule that quietly drops what it does not understand.
 *
 * Every fixture enters at the top of the analysis — a directory tree on disk, or
 * source text — never a value the command normally computes (issue #130).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EnvironmentInput } from '@endora-commerce/contracts';

import { main } from '../src/bin/endora.js';
import { DECLARATION_FILE } from '../src/inputs/declaration.js';
import { runNewStorefront } from '../src/new-storefront/index.js';
import {
  addressVariables,
  declaredVariablesOf,
  envExampleDeclarations,
  memberDirectories,
  outwardReferences,
  resolveReference,
  StorefrontHostError,
  StorefrontInputError,
  workspaceRanges,
} from '../src/new-storefront/reference.js';
import {
  authKeys,
  installedScopes,
  normalizeRegistry,
  npmrcContent,
  TOKEN_VARIABLE,
} from '../src/new-storefront/npmrc.js';
import {
  cutForeignImports,
  cutForeignJsonPaths,
  packageManagerFor,
  planStorefront,
  publishedRange,
  UnclassifiedReferenceError,
} from '../src/new-storefront/rewrite.js';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * Enough to satisfy the fixture storefront's one required input, and this
 * repository's reference storefront's five.
 *
 * A test that supplied none would not be exercising the copy at all — it would
 * be exercising the refusal, which has its own cases below. Both records are
 * written out rather than derived from the declaration, deliberately: deriving
 * them would make every assertion here pass over a declaration that had lost
 * its required inputs, which is the one thing they must not do.
 */
const FIXTURE_INPUTS = { NEXT_PUBLIC_API_BASE_URL: 'https://api.example.com' };

const REFERENCE_INPUTS = {
  NEXT_PUBLIC_API_BASE_URL: 'https://api.example.com',
  BACKEND_BASE_URL: 'https://api.internal.example.com',
  NEXT_PUBLIC_SITE_URL: 'https://shop.example.com',
  NEXT_PUBLIC_SALES_CHANNEL_CODE: 'default',
  REVALIDATE_SECRET: 'a-secret-both-trees-share',
};

function temp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * A minimal repository whose shape is the one the analysis reads: a workspace
 * file, a package with a version, and a Next application declaring it.
 *
 * It is a real tree because every refusal below is about a real tree — a
 * hand-built option record would enter the analysis below the thing under test.
 */
function fixtureRepo(options: { storefrontFiles: Record<string, string> }): string {
  const root = temp('endora-sf-fixture-');
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - shop\n  - packages/*\n');
  // The checkout's own `packageManager`, which the scaffold copies rather than
  // invents (FR-023). A fixture without it is the refusal, asserted below.
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture-root', private: true, packageManager: 'pnpm@9.15.0' }, null, 2)}\n`,
  );
  mkdirSync(join(root, 'packages', 'contracts'), { recursive: true });
  writeFileSync(
    join(root, 'packages', 'contracts', 'package.json'),
    JSON.stringify({ name: '@acme/contracts', version: '1.4.2', private: true }, null, 2),
  );
  mkdirSync(join(root, 'shop'), { recursive: true });
  // Every reference storefront declares what it needs from its environment
  // (feature 117, FR-001), so every fixture reference storefront does too: the
  // command loads it before it writes anything, and a fixture without one would
  // be testing the copy against a tree no client will ever hold. A caller that
  // supplies its own overrides this.
  const storefrontFiles = {
    [DECLARATION_FILE]: FIXTURE_DECLARATION,
    ...options.storefrontFiles,
  };
  for (const [path, content] of Object.entries(storefrontFiles)) {
    const absolute = join(root, 'shop', path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, content);
  }
  writeFileSync(join(root, 'tsconfig.base.json'), `${JSON.stringify({
    compilerOptions: {
      strict: true,
      paths: { '@acme/contracts': ['./packages/contracts/src/index.ts'] },
    },
  }, null, 2)}\n`);
  // git is the copy population's author, so the fixture has to be a checkout.
  for (const args of [['init', '-q'], ['add', '-A'], ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'f']]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    // `spawnSync` reports a *missing binary* in `error`, not in `stderr` — which stays
    // `undefined` while `status` is `null`. Reading only `stderr` produced
    // `git init -q: undefined` in a container with no git, a message naming neither git nor
    // its absence and sending its reader to look at the fixture. Say which of the two it is.
    if (result.error) {
      throw new Error(`git ${args.join(' ')} could not run — is git installed? ${result.error.message}`);
    }
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  }
  return root;
}

/**
 * The fixture storefront's declaration: a required input, an optional one, and
 * an address that is the shop's own.
 *
 * The first two are the resolution's — the required one is what a refusal, a
 * prompt and a flag are asserted over, and the optional one is what proves R1.4
 * (an optional input is never prompted for).
 *
 * The third is the **discrimination**. `NEXT_PUBLIC_SITE_URL` is a URL and is
 * not the backend's address, so it is what separates the predicate that reads
 * `addressOf` from the one this replaced, which read *an absolute `http(s)` URL
 * in `.env.example`* and would sweep it in. Its own `.env.example` value below
 * is deliberately an absolute URL, so a regression to the value-shape rule is
 * red rather than invisible.
 */
const FIXTURE_DECLARATION = `export const STOREFRONT_ENVIRONMENT_INPUTS = [
  {
    name: 'NEXT_PUBLIC_API_BASE_URL',
    describes: { en: 'the backend address.', pl: 'adres backendu.' },
    requirement: { kind: 'required' },
    secret: false,
    generable: false,
    owner: { kind: 'application', application: 'storefront' },
    consumers: ['storefront'],
    addressOf: 'backend',
  },
  {
    name: 'NEXT_PUBLIC_APP_NAME',
    describes: { en: 'the shop name.', pl: 'nazwa sklepu.' },
    requirement: {
      kind: 'optional',
      without: { en: 'the shortcut carries a default name.', pl: 'skrot ma domyslna nazwe.' },
    },
    secret: false,
    generable: false,
    owner: { kind: 'application', application: 'storefront' },
    consumers: ['storefront'],
    addressOf: null,
  },
  {
    name: 'NEXT_PUBLIC_SITE_URL',
    describes: { en: 'the public address of this shop.', pl: 'publiczny adres sklepu.' },
    requirement: {
      kind: 'optional',
      without: { en: 'canonicals name the compiled-in origin.', pl: 'kanoniczne adresy sa domyslne.' },
    },
    secret: false,
    generable: false,
    owner: { kind: 'application', application: 'storefront' },
    consumers: ['storefront'],
    addressOf: 'storefront',
  },
];
`;

const MANIFEST = JSON.stringify(
  {
    name: 'shop',
    version: '0.0.0',
    private: true,
    scripts: { build: 'next build' },
    dependencies: { '@acme/contracts': 'workspace:*', next: '^15.0.0' },
    devDependencies: { '@acme/contracts': 'workspace:^' },
  },
  null,
  2,
);

describe('the reference storefront is derived, never named', () => {
  it('finds the one workspace member that is a Next application', () => {
    const root = fixtureRepo({
      storefrontFiles: { 'package.json': MANIFEST, 'app/page.tsx': 'export default () => null;\n' },
    });
    try {
      const reference = resolveReference(root);
      expect(reference.dir).toBe(join(root, 'shop'));
      // The declaration travels in the copy (feature 117, §R2.3), so it is part
      // of the reference's own population like every other file in it.
      expect([...reference.files].sort()).toEqual([
        'app/page.tsx',
        'environment-inputs.mjs',
        'package.json',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a checkout holding two Next applications rather than picking one', () => {
    const root = fixtureRepo({ storefrontFiles: { 'package.json': MANIFEST } });
    try {
      writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - shop\n  - shop2\n  - packages/*\n');
      mkdirSync(join(root, 'shop2'), { recursive: true });
      writeFileSync(join(root, 'shop2', 'package.json'), MANIFEST);
      expect(() => resolveReference(root)).toThrow(/more than one Next application/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a directory that is not a checkout of this repository', () => {
    const outside = temp('endora-sf-outside-');
    try {
      expect(() => resolveReference(outside)).toThrow(StorefrontHostError);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('reads a `workspace:` range in every dependency field, not only `dependencies`', () => {
    const ranges = workspaceRanges(JSON.parse(MANIFEST) as Record<string, unknown>);
    expect(ranges.map((range) => `${range.field}:${range.declared}`)).toEqual([
      'dependencies:workspace:*',
      'devDependencies:workspace:^',
    ]);
  });
});

describe('rule 1 — a `workspace:` range becomes published semver', () => {
  it('applies pnpm\'s own publish semantics to the version the package declares', () => {
    expect(publishedRange('workspace:*', '1.4.2')).toBe('1.4.2');
    expect(publishedRange('workspace:^', '1.4.2')).toBe('^1.4.2');
    expect(publishedRange('workspace:~', '1.4.2')).toBe('~1.4.2');
    expect(publishedRange('workspace:>=1.0.0', '1.4.2')).toBe('>=1.0.0');
  });

  it('refuses a range naming a package no workspace member provides', async () => {
    const root = fixtureRepo({
      storefrontFiles: {
        'package.json': JSON.stringify({
          name: 'shop',
          version: '0.0.0',
          scripts: { build: 'next build' },
          dependencies: { '@acme/gone': 'workspace:*', next: '^15' },
        }),
      },
    });
    const target = join(temp('endora-sf-out-'), 'shop');
    try {
      await expect(runNewStorefront({ dir: target, cwd: root })).rejects.toThrow(
        /no workspace member of this checkout is called "@acme\/gone"/,
      );
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('rule 2 — a configuration the storefront extends is vendored and made standalone', () => {
  it('drops a `paths` entry whose target leaves the scaffold, and keeps one that does not', () => {
    const cut = cutForeignJsonPaths(
      `${JSON.stringify({
        compilerOptions: {
          strict: true,
          paths: { '@pkg/*': ['./packages/pkg/src/*'], '@self/*': ['./shop/lib/*'] },
        },
      })}\n`,
      '/repo',
      '/repo/shop',
    );
    const parsed = JSON.parse(cut.text) as { compilerOptions: { paths: Record<string, string[]> } };
    expect(Object.keys(parsed.compilerOptions.paths)).toEqual(['@self/*']);
    expect(cut.dropped).toEqual(['paths."@pkg/*"']);
  });

  it('drops a foreign import and the bare call of what it bound', () => {
    const cut = cutForeignImports(
      [
        "import { defineConfig } from 'vitest/config';",
        "import { assertLocal } from './scripts/guard.js';",
        '',
        'assertLocal();',
        '',
        'export default defineConfig({});',
      ].join('\n'),
      '/repo',
      '/repo/shop',
    );
    expect(cut.dropped).toEqual(['./scripts/guard.js']);
    expect(cut.text).not.toContain('assertLocal');
    expect(cut.text).toContain('defineConfig({})');
  });

  it('refuses to vendor a configuration that uses the foreign binding in an expression', () => {
    expect(() =>
      cutForeignImports(
        [
          "import { rules } from './scripts/guard.js';",
          'export default { ...rules, name: "x" };',
        ].join('\n'),
        '/repo',
        '/repo/shop',
      ),
    ).toThrow(UnclassifiedReferenceError);
  });
});

describe('rule 4 — an outward reference no rule classifies is a refusal', () => {
  it('refuses an application file reaching above the storefront, and writes nothing', async () => {
    const root = fixtureRepo({
      storefrontFiles: {
        'package.json': MANIFEST,
        'app/page.tsx': "import { thing } from '../../shared/thing.js';\nexport default thing;\n",
      },
    });
    const target = join(temp('endora-sf-out-'), 'shop');
    try {
      await expect(runNewStorefront({ dir: target, cwd: root })).rejects.toThrow(
        UnclassifiedReferenceError,
      );
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a test file when the application declares no test configuration to place it', async () => {
    // Fail closed: "I could not tell whether this is a test" must not read as
    // "it is one", or a file that genuinely reaches into the platform
    // repository is dropped out of the client's storefront in silence.
    const root = fixtureRepo({
      storefrontFiles: {
        'package.json': MANIFEST,
        'test/repo-shape.test.ts': "import { scan } from '../../scripts/scan.js';\nscan();\n",
      },
    });
    const target = join(temp('endora-sf-out-'), 'shop');
    try {
      await expect(runNewStorefront({ dir: target, cwd: root })).rejects.toThrow(
        UnclassifiedReferenceError,
      );
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('omits a test file whose reach cannot be made standalone, and says so', async () => {
    const root = fixtureRepo({
      storefrontFiles: {
        'package.json': MANIFEST,
        'app/page.tsx': 'export default () => null;\n',
        'vitest.config.mts': "export default { test: { include: ['test/**/*.test.ts'] } };\n",
        'test/repo-shape.test.ts': "import { scan } from '../../scripts/scan.js';\nscan();\n",
      },
    });
    const target = join(temp('endora-sf-out-'), 'shop');
    try {
      const result = await runNewStorefront({ dir: target, cwd: root, inputs: FIXTURE_INPUTS });
      expect(result.plan.omitted.map((entry) => entry.path)).toEqual(['test/repo-shape.test.ts']);
      expect(existsSync(join(target, 'test/repo-shape.test.ts'))).toBe(false);
      expect(existsSync(join(target, 'app/page.tsx'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the registry — an `.npmrc` the scaffold writes only when it is asked', () => {
  it('appends the trailing slash GitLab\'s own troubleshooting requires', () => {
    // R3.2: `//host/api/v4/packages/npm` without it is the documented
    // incorrect form, and it fails at the client's install rather than here.
    expect(normalizeRegistry('https://gitlab.example.com/api/v4/packages/npm')).toBe(
      'https://gitlab.example.com/api/v4/packages/npm/',
    );
    expect(normalizeRegistry(' https://gitlab.example.com/api/v4/packages/npm/ ')).toBe(
      'https://gitlab.example.com/api/v4/packages/npm/',
    );
  });

  it('refuses a registry carrying its own credentials — the one shape that would commit a secret', () => {
    expect(() => normalizeRegistry('https://ci:glpat-secret@gitlab.example.com/npm/')).toThrow(
      /holds no secret by construction/,
    );
  });

  it('refuses a blank value, a non-URL, a scheme npm cannot fetch, and a query', () => {
    expect(() => normalizeRegistry('   ')).toThrow(/omit the flag entirely/);
    expect(() => normalizeRegistry('gitlab.example.com/npm/')).toThrow(/not an absolute URL/);
    expect(() => normalizeRegistry('ftp://gitlab.example.com/npm/')).toThrow(/"ftp:" scheme/);
    expect(() => normalizeRegistry('https://gitlab.example.com/npm/?token=x')).toThrow(
      /query or a fragment/,
    );
  });

  it('names one registry line per scope, and the auth lines the endpoint and its host need', () => {
    const text = npmrcContent('https://gitlab.example.com/api/v4/packages/npm', [
      '@acme',
      '@other',
    ]);
    expect(text).toContain('@acme:registry=https://gitlab.example.com/api/v4/packages/npm/');
    expect(text).toContain('@other:registry=https://gitlab.example.com/api/v4/packages/npm/');
    expect(text).toContain(
      `//gitlab.example.com/api/v4/packages/npm/:_authToken=\${${TOKEN_VARIABLE}}`,
    );
    // The tarball a packument names is on the owning project's path, which the
    // endpoint key does not cover — `npmrc-auth-effect.test.ts` measures the
    // install this is the shape of.
    expect(text).toContain(`//gitlab.example.com/:_authToken=\${${TOKEN_VARIABLE}}`);
    // Two keys, not two per scope: a credential is a property of the endpoint.
    expect(text.match(/_authToken/g)).toHaveLength(2);
  });

  it('derives both keys from the endpoint, and writes one line when they are the same', () => {
    expect(authKeys('https://gitlab.example.com/api/v4/packages/npm')).toEqual([
      '//gitlab.example.com/api/v4/packages/npm/',
      '//gitlab.example.com/',
    ]);
    // A group endpoint is a different path and the same host.
    expect(authKeys('https://gitlab.example.com/api/v4/groups/7/-/packages/npm/')).toEqual([
      '//gitlab.example.com/api/v4/groups/7/-/packages/npm/',
      '//gitlab.example.com/',
    ]);
    // The port is part of the key, so a registry on one is not authenticated by
    // a line naming the bare host.
    expect(authKeys('https://npm.example.com:8443/api/v4/packages/npm/')).toEqual([
      '//npm.example.com:8443/api/v4/packages/npm/',
      '//npm.example.com:8443/',
    ]);
    // A registry at the root of its host: the two keys coincide, and a
    // duplicated line would read as though it said something.
    expect(authKeys('https://npm.example.com/')).toEqual(['//npm.example.com/']);
    expect(
      npmrcContent('https://npm.example.com/', ['@acme']).match(/_authToken/g),
    ).toHaveLength(1);
  });

  it('refuses a registry for a storefront that declares no scoped workspace dependency', () => {
    // An `.npmrc` naming no scope sends every fetch to the default registry
    // while reading as though it configured something.
    expect(() => npmrcContent('https://gitlab.example.com/npm/', [])).toThrow(
      /configures nothing/,
    );
  });

  it('derives the scopes from the ranges the storefront installs, in every field', () => {
    expect(
      installedScopes({
        dependencies: { '@other/ui': 'workspace:^', next: '^15.0.0' },
        devDependencies: { '@acme/contracts': 'workspace:*', typescript: '^5' },
      }),
    ).toEqual(['@acme', '@other']);
    expect(installedScopes({ dependencies: { next: '^15.0.0' } })).toEqual([]);
  });

  it('writes the file for --registry and no file without it, and never a token value', async () => {
    const root = fixtureRepo({
      storefrontFiles: { 'package.json': MANIFEST, 'app/page.tsx': 'export default () => null;\n' },
    });
    const plain = join(temp('endora-sf-plain-'), 'shop');
    const scoped = join(temp('endora-sf-scoped-'), 'shop');
    try {
      const bare = await runNewStorefront({ dir: plain, cwd: root, inputs: FIXTURE_INPUTS });
      expect(existsSync(join(plain, '.npmrc'))).toBe(false);
      expect(bare.plan.registry).toBeNull();

      const withRegistry = await runNewStorefront({
        dir: scoped,
        cwd: root,
        inputs: FIXTURE_INPUTS,
        registry: 'https://gitlab.example.com/api/v4/packages/npm',
      });
      const text = readFileSync(join(scoped, '.npmrc'), 'utf8');
      expect(text).toContain('@acme:registry=https://gitlab.example.com/api/v4/packages/npm/');
      expect(text).toContain(`\${${TOKEN_VARIABLE}}`);
      expect(withRegistry.plan.registry).toBe('https://gitlab.example.com/api/v4/packages/npm/');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('tells its reader about the registry it wrote, and never about tarballs', async () => {
    const root = fixtureRepo({
      storefrontFiles: { 'package.json': MANIFEST, 'app/page.tsx': 'export default () => null;\n' },
    });
    const target = join(temp('endora-sf-steps-'), 'shop');
    try {
      const result = await runNewStorefront({
        dir: target,
        cwd: root,
        dryRun: true,
        registry: 'https://gitlab.example.com/api/v4/packages/npm/',
      });
      const steps = result.nextSteps.join('\n');
      expect(steps).toContain('https://gitlab.example.com/api/v4/packages/npm/');
      expect(steps).toContain(TOKEN_VARIABLE);
      // The instruction publication made wrong. It named `pnpm pack` and a
      // `pnpm.overrides` entry, in a copy the client owns outright and nobody
      // comes back to correct.
      expect(steps).not.toContain('pnpm.overrides');
      expect(steps).not.toContain('tarball');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the scaffolded manifest declares `packageManager`', () => {
  it('prefers the storefront\'s own declaration to the repository root\'s', () => {
    const reference = {
      repoRoot: '/repo',
      dir: '/repo/shop',
      files: [],
      manifest: { packageManager: 'npm@11.16.0' },
    };
    expect(packageManagerFor(reference)).toBe('npm@11.16.0');
  });

  it('falls back to the checkout\'s root, and lands in the written manifest', async () => {
    const root = fixtureRepo({
      storefrontFiles: { 'package.json': MANIFEST, 'app/page.tsx': 'export default () => null;\n' },
    });
    const target = join(temp('endora-sf-pm-'), 'shop');
    try {
      await runNewStorefront({ dir: target, cwd: root, inputs: FIXTURE_INPUTS });
      const written = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as {
        packageManager?: string;
      };
      expect(written.packageManager).toBe('pnpm@9.15.0');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a checkout that declares none rather than inventing one', async () => {
    const root = fixtureRepo({
      storefrontFiles: { 'package.json': MANIFEST, 'app/page.tsx': 'export default () => null;\n' },
    });
    const target = join(temp('endora-sf-nopm-'), 'shop');
    try {
      rmSync(join(root, 'package.json'));
      await expect(runNewStorefront({ dir: target, cwd: root })).rejects.toThrow(
        /declares `packageManager`/,
      );
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a value corepack would not resolve', () => {
    expect(() =>
      packageManagerFor({
        repoRoot: '/repo',
        dir: '/repo/shop',
        files: [],
        manifest: { packageManager: 'pnpm' },
      }),
    ).toThrow(/corepack resolves/);
  });
});

describe('the scaffold names nothing above its own directory', () => {
  it('leaves no outward reference in a copy of this repository\'s own storefront', async () => {
    const parent = temp('endora-sf-real-');
    const target = join(parent, 'shop');
    try {
      const result = await runNewStorefront({ dir: target, cwd: REPO_ROOT, inputs: REFERENCE_INPUTS });
      // The same derivation the command runs, re-applied to what it wrote.
      const copied = {
        repoRoot: parent,
        dir: target,
        files: result.plan.files.map((file) => file.path),
        manifest: JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as Record<
          string,
          unknown
        >,
      };
      expect(outwardReferences(copied)).toEqual([]);
      expect(workspaceRanges(copied.manifest)).toEqual([]);
      // And the rewrites really happened, rather than the population being empty.
      expect(result.plan.ranges.length).toBeGreaterThan(0);
      expect(result.plan.rewrites.length).toBeGreaterThan(0);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }, 120_000);

  it('plans the same thing twice from the same tree', () => {
    const reference = resolveReference(REPO_ROOT);
    const members = memberDirectories(reference.repoRoot);
    const first = planStorefront(reference, members, '/tmp/a');
    const second = planStorefront(reference, members, '/tmp/a');
    expect(first.files.map((file) => file.path)).toEqual(second.files.map((file) => file.path));
    expect(first.ranges).toEqual(second.ranges);
  }, 120_000);
});

describe('the argv layer', () => {
  it('refuses a target directory that exists and is not empty, exit 1, writing nothing', async () => {
    const target = temp('endora-sf-occupied-');
    writeFileSync(join(target, 'keep.txt'), 'mine\n');
    try {
      await expect(runNewStorefront({ dir: target, cwd: REPO_ROOT })).rejects.toThrow(
        StorefrontInputError,
      );
      expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('mine\n');
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('refuses a target inside the reference storefront', async () => {
    const reference = resolveReference(REPO_ROOT);
    await expect(
      runNewStorefront({ dir: join(reference.dir, 'copy'), cwd: REPO_ROOT }),
    ).rejects.toThrow(/inside the reference storefront/);
  });

  it('exits 1 with no directory, and 2 outside a checkout', async () => {
    const errors: string[] = [];
    const spy = (chunk: string): boolean => {
      errors.push(chunk);
      return true;
    };
    const original = process.stderr.write.bind(process.stderr);
    const originalOut = process.stdout.write.bind(process.stdout);
    process.stderr.write = spy as typeof process.stderr.write;
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      expect(await main(['new', 'storefront'], REPO_ROOT)).toBe(1);
      const outside = temp('endora-sf-nohost-');
      try {
        expect(await main(['new', 'storefront', join(outside, 'shop')], outside)).toBe(2);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    } finally {
      process.stderr.write = original;
      process.stdout.write = originalOut;
    }
    expect(errors.join('')).toMatch(/has no default/);
  });

  it('writes nothing on --dry-run and reports every rewrite', async () => {
    const parent = temp('endora-sf-dry-');
    const target = join(parent, 'shop');
    const out: string[] = [];
    const originalOut = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      out.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      expect(await main(['new', 'storefront', target, '--dry-run'], REPO_ROOT)).toBe(0);
    } finally {
      process.stdout.write = originalOut;
      rmSync(parent, { recursive: true, force: true });
    }
    expect(existsSync(target)).toBe(false);
    expect(out.join('')).toContain('dry run, nothing written');
    expect(out.join('')).toMatch(/workspace:\S* -> /);
  }, 120_000);
});

/**
 * The backend address, which the scaffold's own guidance named wrongly.
 *
 * The reference storefront reads two variables — one server-side, one baked
 * into the browser bundle — and both are declared in its `.env.example`. The
 * next step told its reader to set `PUBLIC_API_BASE_URL`, which no file in the
 * copy reads: an operator who followed it got a storefront quietly talking to
 * the compiled-in fallback rather than one that refused. So the names are
 * derived from the copy's own declaration rather than written into a sentence,
 * which is what keeps them true when the storefront renames one.
 */
describe('the address variables are derived from the copy\'s own declaration', () => {
  const declared = (over: Record<string, unknown>): EnvironmentInput =>
    ({
      name: 'X',
      describes: { en: 'a value.', pl: 'wartosc.' },
      requirement: { kind: 'required' },
      secret: false,
      generable: false,
      owner: { kind: 'application', application: 'storefront' },
      consumers: ['storefront'],
      addressOf: null,
      ...over,
    }) as EnvironmentInput;

  it('takes every input whose `addressOf` names the member, in declaration order', () => {
    const inputs = [
      declared({ name: 'PORT' }),
      declared({ name: 'BACKEND_BASE_URL', addressOf: 'backend' }),
      declared({ name: 'NEXT_PUBLIC_SITE_URL', addressOf: 'storefront' }),
      declared({ name: 'NEXT_PUBLIC_API_BASE_URL', addressOf: 'backend' }),
      declared({ name: 'REVALIDATE_SECRET', secret: true }),
    ];
    expect(addressVariables(inputs, 'backend')).toEqual([
      'BACKEND_BASE_URL',
      'NEXT_PUBLIC_API_BASE_URL',
    ]);
    expect(addressVariables(inputs, 'storefront')).toEqual(['NEXT_PUBLIC_SITE_URL']);
  });

  /**
   * The predicate this replaced, as a red proof.
   *
   * It read `.env.example` for *a declaration whose value is an absolute
   * `http(s)` URL*, which is right only while the file declares no address but
   * the backend's. All four values below are absolute URLs and only two of them
   * name a backend, so a regression to the value-shape rule fails here rather
   * than in a client's `.env` a year later.
   */
  it('does not answer from the shape of a value: a URL is not thereby a backend', () => {
    const inputs = [
      declared({ name: 'BACKEND_BASE_URL', addressOf: 'backend' }),
      declared({ name: 'NEXT_PUBLIC_API_BASE_URL', addressOf: 'backend' }),
      declared({ name: 'NEXT_PUBLIC_SITE_URL', addressOf: 'storefront' }),
      declared({ name: 'ASSET_CDN_URL' }),
    ];
    expect(addressVariables(inputs, 'backend')).not.toContain('NEXT_PUBLIC_SITE_URL');
    expect(addressVariables(inputs, 'backend')).not.toContain('ASSET_CDN_URL');
    expect(addressVariables(inputs, 'storefront')).toEqual(['NEXT_PUBLIC_SITE_URL']);
  });

  it('answers with nothing when no input names that member, rather than inventing a name', () => {
    expect(addressVariables([declared({ name: 'PORT' })], 'backend')).toEqual([]);
    expect(addressVariables([], 'storefront')).toEqual([]);
  });

  /**
   * The same file answers a second question — *what value does it give for a
   * name* — which is how the `endora new storefront` acceptance criterion
   * configures the instance it boots without carrying a list of variables of its
   * own. One parser answers both, so the two cannot come to disagree about what
   * the file says.
   */
  it('reads every declaration it makes, not only the ones naming a URL', () => {
    expect([
      ...envExampleDeclarations(
        [
          '# a comment',
          'PORT=3000',
          'export API_URL="http://host:3001"',
          'REVALIDATE_SECRET=change-me',
          'not an assignment',
        ].join('\n'),
      ),
    ]).toEqual([
      ['PORT', '3000'],
      ['API_URL', 'http://host:3001'],
      ['REVALIDATE_SECRET', 'change-me'],
    ]);
  });

  it('reads a blank value as no declaration', () => {
    // `NEXT_PUBLIC_SITE_URL=` and no line at all are the same state for whoever
    // has to supply it, so a consumer must not be handed an empty string by a
    // command whose whole subject is that nothing is invented.
    const text = 'BACKEND_BASE_URL=http://localhost:3001\nBACKEND_BASE_URL=\nCHANNEL=\n';
    expect(envExampleDeclarations(text).has('BACKEND_BASE_URL')).toBe(false);
    expect(envExampleDeclarations(text).has('CHANNEL')).toBe(false);
  });

  it('names those variables in the next steps, and never one nothing reads', async () => {
    const root = fixtureRepo({
      storefrontFiles: {
        'package.json': MANIFEST,
        'app/page.tsx': 'export default () => null;\n',
        '.env.example':
          'PORT=3000\nNEXT_PUBLIC_API_BASE_URL=http://localhost:3001\n' +
          'NEXT_PUBLIC_SITE_URL=https://shop.example.com\n',
      },
    });
    const target = join(temp('endora-sf-backend-step-'), 'shop');
    try {
      const result = await runNewStorefront({ dir: target, cwd: root, dryRun: true });
      const steps = result.nextSteps.join('\n');
      expect(steps).toContain('NEXT_PUBLIC_API_BASE_URL');
      // The name the guidance used to carry. Nothing in the copy reads it, so
      // an operator who set it got the fallback and no error anywhere.
      expect(steps).not.toMatch(/(?<![A-Z_])PUBLIC_API_BASE_URL/);
      expect(steps).not.toContain('Nothing in the copy points at a backend');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * The sentence that would have gone confidently wrong.
   *
   * `nextSteps` says the variables it names "name the backend this storefront
   * talks to", in a file the client owns outright and nobody revisits. Under the
   * value-shape predicate, supplying `NEXT_PUBLIC_SITE_URL` in `.env.example` —
   * which is what the deployment-path repair does — would have put the shop's
   * **own** public address in that sentence.
   */
  it('does not call the shop\'s own public address a backend', async () => {
    const root = fixtureRepo({
      storefrontFiles: {
        'package.json': MANIFEST,
        'app/page.tsx': 'export default () => null;\n',
        '.env.example':
          'NEXT_PUBLIC_API_BASE_URL=http://localhost:3001\n' +
          'NEXT_PUBLIC_SITE_URL=https://shop.example.com\n',
      },
    });
    const target = join(temp('endora-sf-site-url-step-'), 'shop');
    try {
      const result = await runNewStorefront({ dir: target, cwd: root, dryRun: true });
      // Either branch of the backend step — the one that tells an author to set
      // the names, and the one that says the run already answered them — names
      // exactly `backendVariables`, so the assertion is over whichever fired.
      const backendSentence = result.nextSteps.find((step) =>
        step.includes('the backend this storefront talks to'),
      );
      expect(backendSentence).toBeDefined();
      expect(backendSentence).toContain('NEXT_PUBLIC_API_BASE_URL');
      expect(backendSentence).not.toContain('NEXT_PUBLIC_SITE_URL');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * Every variable a storefront's own process reads.
 *
 * The two derivations above answer *which of these names a member*; this one is
 * the whole population, and it exists for a caller that **spawns** a
 * storefront's toolchain — `endora new storefront`'s acceptance criterion, which
 * runs an install, a `next build` and two boots inside a copy.
 *
 * The failure it closes is not hypothetical: that criterion inherited its own
 * environment into all four, Next does not let a `.env` override a variable the
 * process already carries, and one `NODE_ENV=development` a CI job set for the
 * **backend** it booted made `next build` fail in every run the criterion has
 * ever had in CI. What a client's storefront reads is the client's storefront's
 * to say, which is what this asks.
 */
describe('a storefront declares which variables its own process reads', () => {
  it('answers with every input scoped to this member, off the directory', async () => {
    const root = fixtureRepo({ storefrontFiles: { 'package.json': MANIFEST } });
    try {
      expect(await declaredVariablesOf(join(root, 'shop'))).toEqual([
        'NEXT_PUBLIC_API_BASE_URL',
        'NEXT_PUBLIC_APP_NAME',
        'NEXT_PUBLIC_SITE_URL',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves out an input this member does not read, rather than every name in the file', async () => {
    // A declaration may carry an input another member reads — `ADMIN_BASE_URL`
    // is the tree's own example, whose *value* names the admin and whose
    // consumer is the backend. Withholding it from a storefront's own process
    // would be withholding a variable that was never the storefront's.
    const declaration = `export const STOREFRONT_ENVIRONMENT_INPUTS = [
  {
    name: 'NEXT_PUBLIC_APP_NAME',
    describes: { en: 'the shop name.', pl: 'nazwa sklepu.' },
    requirement: {
      kind: 'optional',
      without: { en: 'the shortcut carries a default name.', pl: 'skrot ma domyslna nazwe.' },
    },
    secret: false,
    generable: false,
    owner: { kind: 'application', application: 'storefront' },
    consumers: ['storefront'],
    addressOf: null,
  },
  {
    name: 'SOMEONE_ELSES_SECRET',
    describes: { en: 'read by the backend alone.', pl: 'czytane tylko przez backend.' },
    requirement: {
      kind: 'optional',
      without: { en: 'the backend uses its own default.', pl: 'backend uzywa domyslnej wartosci.' },
    },
    secret: true,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: null,
  },
];
`;
    const root = fixtureRepo({
      storefrontFiles: { 'package.json': MANIFEST, [DECLARATION_FILE]: declaration },
    });
    try {
      expect(await declaredVariablesOf(join(root, 'shop'))).toEqual(['NEXT_PUBLIC_APP_NAME']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
