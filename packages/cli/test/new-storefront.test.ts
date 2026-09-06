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

import { main } from '../src/bin/endora.js';
import { runNewStorefront } from '../src/new-storefront/index.js';
import {
  backendAddressVariables,
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
  for (const [path, content] of Object.entries(options.storefrontFiles)) {
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
      expect([...reference.files].sort()).toEqual(['app/page.tsx', 'package.json']);
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
      const result = await runNewStorefront({ dir: target, cwd: root });
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
      const bare = await runNewStorefront({ dir: plain, cwd: root });
      expect(existsSync(join(plain, '.npmrc'))).toBe(false);
      expect(bare.plan.registry).toBeNull();

      const withRegistry = await runNewStorefront({
        dir: scoped,
        cwd: root,
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
      await runNewStorefront({ dir: target, cwd: root });
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
      const result = await runNewStorefront({ dir: target, cwd: REPO_ROOT });
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
describe('the backend address variables are derived from the copy\'s own .env.example', () => {
  it('takes every key whose declared value is an absolute http(s) URL, in declaration order', () => {
    expect(
      backendAddressVariables(
        [
          '# Storefront development environment.',
          '',
          '# PORT — auto-loaded by Next.',
          'PORT=3000',
          '',
          '# Server-side fetcher (lib/api/*) reads BACKEND_BASE_URL.',
          'BACKEND_BASE_URL=http://localhost:3001',
          'NEXT_PUBLIC_API_BASE_URL=https://api.example.com',
          'NEXT_PUBLIC_SALES_CHANNEL_CODE=pl_default',
          'REVALIDATE_SECRET=change-me-shared-with-backend',
          '',
        ].join('\n'),
      ),
    ).toEqual(['BACKEND_BASE_URL', 'NEXT_PUBLIC_API_BASE_URL']);
  });

  it('reads `export KEY=` and a quoted value, and ignores a commented-out declaration', () => {
    expect(
      backendAddressVariables(
        ['# BACKEND_BASE_URL=http://commented.example', 'export API_URL="http://host:3001"'].join(
          '\n',
        ),
      ),
    ).toEqual(['API_URL']);
  });

  it('answers with nothing when no declaration names a URL, rather than inventing a name', () => {
    expect(backendAddressVariables('PORT=3000\nLOCALE=en-US\n')).toEqual([]);
    expect(backendAddressVariables('')).toEqual([]);
  });

  it('names those variables in the next steps, and never one nothing reads', async () => {
    const root = fixtureRepo({
      storefrontFiles: {
        'package.json': MANIFEST,
        'app/page.tsx': 'export default () => null;\n',
        '.env.example': 'PORT=3000\nBACKEND_BASE_URL=http://localhost:3001\n',
      },
    });
    const target = join(temp('endora-sf-backend-step-'), 'shop');
    try {
      const result = await runNewStorefront({ dir: target, cwd: root, dryRun: true });
      const steps = result.nextSteps.join('\n');
      expect(steps).toContain('BACKEND_BASE_URL');
      // The name the guidance used to carry. Nothing in the copy reads it, so
      // an operator who set it got the fallback and no error anywhere.
      expect(steps).not.toMatch(/(?<![A-Z_])PUBLIC_API_BASE_URL/);
      expect(steps).not.toContain('Nothing in the copy points at a backend');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
