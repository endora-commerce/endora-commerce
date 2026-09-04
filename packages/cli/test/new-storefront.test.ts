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
  memberDirectories,
  outwardReferences,
  resolveReference,
  StorefrontHostError,
  StorefrontInputError,
  workspaceRanges,
} from '../src/new-storefront/reference.js';
import {
  cutForeignImports,
  cutForeignJsonPaths,
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
