/**
 * `endora generate` — the two artefacts an instance's admin project is built
 * from (`specs/110-instance-repository/` T138; `contracts/instance-tree.md`
 * §2.6, `contracts/instance-repository.md` R3.2/R3.5).
 *
 * ## Why it needs tests of its own
 *
 * The renderer is the one `composer:generate` runs here, and that half is
 * already covered by `backend/test/unit/scripts/generate-admin-registry.test.ts`
 * and by `overlay:check`'s byte comparison. What is new is the **instance**
 * half: where the artefacts land, what the population is when every module is
 * an installed package rather than a workspace member, and what the command
 * refuses. None of that has a subject in this repository's own tree.
 *
 * ## The fixture is an install, not a plan
 *
 * Issue #130. Every case below runs over a directory on disk holding a
 * `pnpm-workspace.yaml`, an admin project and a `node_modules` — the shape a
 * client's instance actually has, and the shape the acceptance criterion pays
 * five minutes to produce. A fixture entering below the walk would prove
 * nothing about the walk, which is the whole of what changes between the two
 * trees.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  findInstanceRoot,
  generateReport,
  GenerateHostError,
  GenerateInputError,
  runGenerate,
} from '../src/generate/index.js';

const SCOPE = '@endora-commerce';
const scratch: string[] = [];

afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

/** One installed module package, as a published tarball leaves it: `dist` only. */
function installModule(root: string, id: string, options: { admin: boolean } = { admin: true }): void {
  const dir = join(root, 'node_modules', SCOPE, `mod-${id}`);
  write(
    join(dir, 'package.json'),
    JSON.stringify({
      name: `${SCOPE}/mod-${id}`,
      version: '1.0.0',
      endora: { type: 'module', id },
      exports: {
        '.': './dist/manifest.js',
        ...(options.admin ? { './admin': './dist/admin/index.js' } : {}),
        './tailwind.css': './tailwind.css',
      },
    }),
  );
  write(join(dir, 'dist', 'manifest.js'), 'export const manifest = {};\n');
  if (options.admin) write(join(dir, 'dist', 'admin', 'index.js'), 'export const contributions = {};\n');
  write(join(dir, 'tailwind.css'), '@source "./dist/admin";\n');
}

/** A scaffolded instance: two members, an admin project, and an install. */
function instance(modules: readonly string[], options: { admin?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'gen-'));
  scratch.push(root);
  write(
    join(root, 'pnpm-workspace.yaml'),
    `packages:\n  - backend\n${options.admin === false ? '' : '  - admin\n'}`,
  );
  write(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'acme',
      private: true,
      dependencies: Object.fromEntries(modules.map((id) => [`${SCOPE}/mod-${id}`, '^1.0.0'])),
    }),
  );
  write(join(root, 'backend', 'package.json'), JSON.stringify({ name: 'acme-backend' }));
  if (options.admin !== false) {
    write(join(root, 'admin', 'package.json'), JSON.stringify({ name: 'acme-admin' }));
    write(
      join(root, 'admin', 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }),
    );
    write(join(root, 'admin', 'src', 'main.tsx'), '// the entry point\n');
  }
  for (const id of modules) installModule(root, id);
  return root;
}

describe('endora generate (instance-tree.md §2.6)', () => {
  it('renders both artefacts into the admin project the `"@/*"` alias names', () => {
    const root = instance(['blog', 'catalog']);
    const result = runGenerate({ cwd: root });
    expect(result.artefacts.map((artefact) => artefact.path)).toEqual([
      join(root, 'admin', 'src', 'modules.generated.ts'),
      join(root, 'admin', 'src', 'tailwind.generated.css'),
    ]);
    const registry = readFileSync(result.artefacts[0]!.path, 'utf8');
    // The bare specifier the package's own `exports` map declares — never a
    // path into `dist`, which is what a client's bundler could not resolve.
    expect(registry).toContain(`from '${SCOPE}/mod-blog/admin'`);
    expect(registry).toContain("moduleId: 'catalog'");
    const stylesheet = readFileSync(result.artefacts[1]!.path, 'utf8');
    expect(stylesheet).toContain(`@import "${SCOPE}/mod-blog/tailwind.css";`);
  });

  it('names `endora generate` as what regenerates them, not this repository\'s script', () => {
    const root = instance(['blog']);
    for (const artefact of runGenerate({ cwd: root }).artefacts) {
      expect(artefact.content).toContain('endora generate');
      expect(artefact.content).not.toContain('composer:generate');
    }
  });

  it('runs from a member as well as from the root — R8.2\'s `pnpm -C admin`', () => {
    const root = instance(['blog']);
    expect(findInstanceRoot(join(root, 'admin', 'src'))).toBe(root);
    expect(runGenerate({ cwd: join(root, 'admin') }).root).toBe(root);
  });

  it('a dry run reports what it would write, and writes nothing', () => {
    const root = instance(['blog']);
    const result = runGenerate({ cwd: root, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(generateReport(result)[0]).toMatch(/^would write admin\/src\/modules\.generated\.ts/);
    expect(() => readFileSync(result.artefacts[0]!.path, 'utf8')).toThrow();
  });

  /**
   * R8.2 — a module the platform will not compose must not be registered, and
   * the exclusion has to be said out loud: *"a module that is simply not there
   * is indistinguishable from a module nobody installed"*.
   */
  it('excludes a linked package and says so, with its real path', () => {
    const root = instance(['blog']);
    const elsewhere = mkdtempSync(join(tmpdir(), 'linked-'));
    scratch.push(elsewhere);
    installModule(elsewhere, 'linked');
    symlinkSync(
      join(elsewhere, 'node_modules', SCOPE, 'mod-linked'),
      join(root, 'node_modules', SCOPE, 'mod-linked'),
      'dir',
    );
    const result = runGenerate({ cwd: root });
    expect(result.excluded.map((entry) => entry.kind)).toContain('links-out-of-node-modules');
    const report = generateReport(result).join('\n');
    expect(report).toContain('links-out-of-node-modules');
    expect(report).toContain('overlay module');
    expect(readFileSync(result.artefacts[0]!.path, 'utf8')).not.toContain('mod-linked');
  });

  /**
   * The two refusals, and the class of each is the contract's: **1** an
   * operator can act on it, **2** the run could not read its input. A run that
   * reported an empty registry for either would have written a bundle with no
   * screens in it and exited 0.
   */
  it('refuses a directory that is no instance — exit 2', () => {
    const loose = mkdtempSync(join(tmpdir(), 'loose-'));
    scratch.push(loose);
    expect(() => runGenerate({ cwd: loose })).toThrow(GenerateHostError);
  });

  it('refuses an instance with no install — exit 2, never an empty registry', () => {
    const root = instance([]);
    rmSync(join(root, 'node_modules'), { recursive: true, force: true });
    expect(() => runGenerate({ cwd: root })).toThrow(GenerateHostError);
  });

  it('refuses an instance with no admin project — exit 1, naming the alias', () => {
    const root = instance(['blog'], { admin: false });
    rmSync(join(root, 'admin'), { recursive: true, force: true });
    let raised: unknown;
    try {
      runGenerate({ cwd: root });
    } catch (error: unknown) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(GenerateInputError);
    expect((raised as Error).message).toContain('"@/*"');
  });

  it('a module that publishes no admin layer is in neither artefact and is not a refusal', () => {
    const root = instance(['blog']);
    installModule(root, 'headless', { admin: false });
    const result = runGenerate({ cwd: root });
    expect(result.modules).toBe(2);
    expect(readFileSync(result.artefacts[0]!.path, 'utf8')).not.toContain('mod-headless');
  });
});
