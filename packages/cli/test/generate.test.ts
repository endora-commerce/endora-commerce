/**
 * `endora generate` — the artefacts an instance is built from and commits none
 * of (`specs/110-instance-repository/` T138 and T137; `contracts/instance-tree.md`
 * §2.6, `contracts/instance-repository.md` R3.2/R3.5): the admin project's two,
 * and the documentation site's navigation, module map and reference pages.
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
  write(
    join(dir, 'dist', 'manifest.js'),
    // What a **published** manifest looks like: `tsc` output, so a plain object
    // over several lines, naming `defineModuleManifest` nowhere, with its
    // documentation layer declared at the package root beside `i18n/`. The
    // shape matters — `docsDeclarationIn` reads a `docs:` line indented no more
    // than four spaces, which is what `tsc` emits for a manifest's own field,
    // and a single-line fixture would have proved nothing about a real tarball.
    `export const manifest = {\n` +
      `    id: '${id}',\n` +
      `    name: '${id}',\n` +
      `    version: '1.0.0',\n` +
      `    docs: { dir: 'docs' },\n` +
      `};\n`,
  );
  write(
    join(dir, 'docs', `${id.split('_').join('-')}.md`),
    `---\ntitle: ${id}\ndescription: What ${id} does.\n---\n\n# ${id}\n`,
  );
  if (options.admin) write(join(dir, 'dist', 'admin', 'index.js'), 'export const contributions = {};\n');
  write(join(dir, 'tailwind.css'), '@source "./dist/admin";\n');
}

/** A scaffolded instance: two members, an admin project, and an install. */
function instance(
  modules: readonly string[],
  options: { admin?: boolean; docs?: boolean } = {},
): string {
  const root = mkdtempSync(join(tmpdir(), 'gen-'));
  scratch.push(root);
  write(
    join(root, 'pnpm-workspace.yaml'),
    `packages:\n  - backend\n${options.admin === false ? '' : '  - admin\n'}` +
      `${options.docs === false ? '' : '  - docs\n'}`,
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
  if (options.docs !== false) {
    write(join(root, 'docs', 'package.json'), JSON.stringify({ name: 'acme-docs' }));
    write(
      join(root, 'docs', 'docusaurus.config.ts'),
      "export default { title: 'Acme', presets: [['classic', { docs: { path: 'docs' } }]] };\n",
    );
    write(join(root, 'docs', 'docs', 'intro.md'), '---\ntitle: Start here\n---\n');
  }
  for (const id of modules) installModule(root, id);
  return root;
}

describe('endora generate (instance-tree.md §2.6)', () => {
  it('renders both artefacts into the admin project the `"@/*"` alias names', async () => {
    const root = instance(['blog', 'catalog']);
    const result = await runGenerate({ cwd: root });
    expect(result.artefacts.slice(0, 2).map((artefact) => artefact.path)).toEqual([
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

  it('names `endora generate` as what regenerates them, not this repository\'s script', async () => {
    const root = instance(['blog']);
    for (const artefact of (await runGenerate({ cwd: root })).artefacts) {
      expect(artefact.content).toContain('endora generate');
      expect(artefact.content).not.toContain('composer:generate');
    }
  });

  it('runs from a member as well as from the root — R8.2\'s `pnpm -C admin`', async () => {
    const root = instance(['blog']);
    expect(findInstanceRoot(join(root, 'admin', 'src'))).toBe(root);
    expect((await runGenerate({ cwd: join(root, 'admin') })).root).toBe(root);
  });

  it('a dry run reports what it would write, and writes nothing', async () => {
    const root = instance(['blog']);
    const result = await runGenerate({ cwd: root, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(generateReport(result)[0]).toMatch(/^would write admin\/src\/modules\.generated\.ts/);
    expect(() => readFileSync(result.artefacts[0]!.path, 'utf8')).toThrow();
  });

  /**
   * R8.2 — a module the platform will not compose must not be registered, and
   * the exclusion has to be said out loud: *"a module that is simply not there
   * is indistinguishable from a module nobody installed"*.
   */
  it('excludes a linked package and says so, with its real path', async () => {
    const root = instance(['blog']);
    const elsewhere = mkdtempSync(join(tmpdir(), 'linked-'));
    scratch.push(elsewhere);
    installModule(elsewhere, 'linked');
    symlinkSync(
      join(elsewhere, 'node_modules', SCOPE, 'mod-linked'),
      join(root, 'node_modules', SCOPE, 'mod-linked'),
      'dir',
    );
    const result = await runGenerate({ cwd: root });
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
  it('refuses a directory that is no instance — exit 2', async () => {
    const loose = mkdtempSync(join(tmpdir(), 'loose-'));
    scratch.push(loose);
    await expect(runGenerate({ cwd: loose })).rejects.toThrow(GenerateHostError);
  });

  it('refuses an instance with no install — exit 2, never an empty registry', async () => {
    const root = instance([]);
    rmSync(join(root, 'node_modules'), { recursive: true, force: true });
    await expect(runGenerate({ cwd: root })).rejects.toThrow(GenerateHostError);
  });

  /**
   * A member that is not there is an **omission**, not a refusal — and it is
   * named, which is the half that matters.
   *
   * `endora new instance` writes the admin member only when the shell and the
   * design system resolve (§2.4) and the documentation member only when a
   * Docusaurus range does, so a headless instance is a tree this command must
   * still serve. `instance-repository.md` R8.2's reasoning one surface over: a
   * client who does not know they have no operator interface spends their first
   * hour looking for one.
   */
  it('omits the admin half when there is no admin project, and names it', async () => {
    const root = instance(['blog'], { admin: false });
    rmSync(join(root, 'admin'), { recursive: true, force: true });
    const result = await runGenerate({ cwd: root });
    expect(result.omitted.join('\n')).toContain('"@/*"');
    expect(result.artefacts.map((artefact) => artefact.path)).not.toContain(
      join(root, 'admin', 'src', 'modules.generated.ts'),
    );
    // And the documentation half still ran.
    expect(generateReport(result).join('\n')).toContain('omitted the admin project');
    expect(result.artefacts.map((artefact) => artefact.path)).toContain(
      join(root, 'docs', 'sidebars.modules.generated.js'),
    );
  });

  it('omits the documentation half when there is no site, and names it', async () => {
    const root = instance(['blog'], { docs: false });
    rmSync(join(root, 'docs'), { recursive: true, force: true });
    const result = await runGenerate({ cwd: root });
    expect(result.omitted.join('\n')).toContain('Docusaurus');
    expect(result.collected).toBeNull();
    expect(result.artefacts).toHaveLength(2);
  });

  it('refuses an instance with neither member — exit 1, naming both', async () => {
    const root = instance(['blog'], { admin: false, docs: false });
    rmSync(join(root, 'admin'), { recursive: true, force: true });
    rmSync(join(root, 'docs'), { recursive: true, force: true });
    let raised: unknown;
    try {
      await runGenerate({ cwd: root });
    } catch (error: unknown) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(GenerateInputError);
    expect((raised as Error).message).toContain('"@/*"');
    expect((raised as Error).message).toContain('Docusaurus');
  });

  it('a module that publishes no admin layer is in neither artefact and is not a refusal', async () => {
    const root = instance(['blog']);
    installModule(root, 'headless', { admin: false });
    const result = await runGenerate({ cwd: root });
    expect(result.modules).toBe(2);
    expect(readFileSync(result.artefacts[0]!.path, 'utf8')).not.toContain('mod-headless');
  });
  /**
   * The documentation half (T137; `instance-tree.md` §2.6's third artefact).
   *
   * The population is the same one the admin half walks — the packages this
   * instance installed — and the derivation is the one `composer:generate`
   * runs over this repository. What is new here is that every page comes out of
   * a **package**: a client's site holds no module prose of its own, so a
   * navigation rendered over an empty walk is a site describing nothing they
   * bought, which is the state R3.2 exists to prevent.
   */
  it('names the installed modules\' pages in the navigation, and copies them in', async () => {
    const root = instance(['blog', 'quote_requests']);
    const result = await runGenerate({ cwd: root });
    const sidebar = readFileSync(join(root, 'docs', 'sidebars.modules.generated.js'), 'utf8');
    expect(sidebar).toContain("id: 'modules/blog'");
    // A snake_case id is documented at a hyphenated slug — `slugForModule`,
    // shared with the check that judges this repository's own pages.
    expect(sidebar).toContain("id: 'modules/quote-requests'");
    expect(sidebar).toContain("id: 'modules/module-map.generated'");

    // The page itself is copied into the site's content root, preserving its
    // address, because Docusaurus resolves `docs.path` against the site
    // directory and cannot read a package's own tree.
    expect(result.collected?.copied).toEqual(['docs/modules/blog.md', 'docs/modules/quote-requests.md']);
    expect(readFileSync(join(root, 'docs', 'docs', 'modules', 'blog.md'), 'utf8')).toContain(
      '# blog',
    );

    // And the reference page every module gets from its own manifest.
    expect(result.artefacts.map((artefact) => artefact.path)).toContain(
      join(root, 'docs', 'docs', 'module-reference', 'blog.md'),
    );
  });

  it('a dry run copies no page and writes no navigation', async () => {
    const root = instance(['blog']);
    const result = await runGenerate({ cwd: root, dryRun: true });
    expect(result.collected).toBeNull();
    expect(() =>
      readFileSync(join(root, 'docs', 'sidebars.modules.generated.js'), 'utf8'),
    ).toThrow();
    expect(() => readFileSync(join(root, 'docs', 'docs', 'modules', 'blog.md'), 'utf8')).toThrow();
  });

  it('removes a page the previous run copied and this one does not', async () => {
    const root = instance(['blog']);
    await runGenerate({ cwd: root });
    const orphan = join(root, 'docs', 'docs', 'modules', 'blog.md');
    expect(readFileSync(orphan, 'utf8')).toContain('# blog');
    rmSync(join(root, 'node_modules', SCOPE, 'mod-blog'), { recursive: true, force: true });
    const second = await runGenerate({ cwd: root });
    expect(second.collected?.removed).toEqual(['docs/modules/blog.md']);
    expect(() => readFileSync(orphan, 'utf8')).toThrow();
  });
});
