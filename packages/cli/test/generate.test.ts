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
  generateFindingsRefusal,
  generateReport,
  GenerateHostError,
  GenerateInputError,
  runGenerate,
  type GenerateStep,
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
function installModule(
  root: string,
  id: string,
  options: {
    admin: boolean;
    blocksCss?: 'published' | 'declared-only';
    /** The npm name, when it is not `mod-<id>` — `document_templates` is `mod-document-templates`. */
    name?: string;
    /** The manifest's own `dependencies`. */
    dependencies?: readonly string[];
    /** The module ids of the manifest's `acknowledgedDependencies`. */
    acknowledged?: readonly string[];
    /** The manifest's `commandMiddleware`, as `tsc` would emit it (189). */
    commandMiddleware?: ReadonlyArray<{ id: string; phase: 'admit' | 'observe'; actions: '*' | readonly string[] }>;
  } = { admin: true },
): void {
  const name = options.name ?? `${SCOPE}/mod-${id}`;
  const dir = join(root, 'node_modules', ...name.split('/'));
  write(
    join(dir, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      endora: { type: 'module', id },
      exports: {
        '.': './dist/manifest.js',
        // **Every** module package publishes `./backend` — it is a required key
        // of a closed set (`module-package-layout.md` §2.2, R7), and the entity
        // index refuses a module that does not rather than skipping it. The
        // fixture declared none until T065, which is a fixture declaring a shape
        // its own rule forbids.
        './backend': './dist/backend/index.js',
        ...(options.admin ? { './admin': './dist/admin/index.js' } : {}),
        './tailwind.css': './tailwind.css',
        ...(options.blocksCss !== undefined ? { './blocks.css': './dist/blocks.css' } : {}),
      },
    }),
  );
  if (options.blocksCss === 'published') {
    write(join(dir, 'dist', 'blocks.css'), `.${id}-badge { color: var(--color-primary, #111); }\n`);
  }
  write(join(dir, 'dist', 'backend', 'index.js'), 'export const entities = [];\n');
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
      (options.dependencies === undefined
        ? ''
        : `    dependencies: ${JSON.stringify(options.dependencies)},\n`) +
      (options.acknowledged === undefined
        ? ''
        : `    acknowledgedDependencies: ${JSON.stringify(
            options.acknowledged.map((moduleId) => ({ moduleId, port: `${moduleId}Port`, reason: 'a cycle' })),
          )},\n`) +
      (options.commandMiddleware === undefined
        ? ''
        : `    commandMiddleware: ${JSON.stringify(options.commandMiddleware)},\n`) +
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

/**
 * One UI package as pnpm's isolated layout installs it: the real directory in
 * the virtual store, and a symlink from the `node_modules` of whoever declares
 * it. `peers` are linked as **siblings** in the store, which is how a dependent
 * resolves a peer that nobody in the instance declared.
 */
function installUiPackage(
  root: string,
  name: string,
  linkFrom: readonly string[],
  peers: readonly string[] = [],
): string {
  const storeRoot = join(root, 'node_modules', '.pnpm', `${name.replace('/', '+')}@1.0.0`, 'node_modules');
  const dir = join(storeRoot, name);
  write(
    join(dir, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      exports: { '.': './dist/index.js', './tailwind.css': './tailwind.css' },
      peerDependencies: Object.fromEntries(peers.map((peer) => [peer, '^1.0.0'])),
    }),
  );
  write(join(dir, 'tailwind.css'), '@source "./dist";\n');
  for (const peer of peers) {
    const peerDir = join(root, 'node_modules', '.pnpm', `${peer.replace('/', '+')}@1.0.0`, 'node_modules', peer);
    mkdirSync(join(storeRoot, peer, '..'), { recursive: true });
    symlinkSync(peerDir, join(storeRoot, peer), 'dir');
  }
  for (const from of linkFrom) {
    mkdirSync(join(from, 'node_modules', name, '..'), { recursive: true });
    symlinkSync(dir, join(from, 'node_modules', name), 'dir');
  }
  return dir;
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

  /**
   * The sign-in screen rendered at the top-left of a scaffolded instance's
   * admin: `grid min-h-screen place-items-center` is the shell's, and the
   * shell's stylesheet was never imported. The admin member declares the shell
   * and the kit and pnpm links them into **its** `node_modules`, not the
   * root's, so a lookup at the root alone found nothing and skipped them in
   * silence.
   */
  it('imports the shell\'s and the kit\'s sources when only the admin member declares them', async () => {
    const root = instance(['blog']);
    const admin = join(root, 'admin');
    write(
      join(admin, 'package.json'),
      JSON.stringify({
        name: 'acme-admin',
        dependencies: { [`${SCOPE}/admin-kit`]: '^1.0.0', [`${SCOPE}/admin-shell`]: '^1.0.0' },
      }),
    );
    installUiPackage(root, `${SCOPE}/admin-kit`, [admin]);
    installUiPackage(root, `${SCOPE}/admin-shell`, [admin], [`${SCOPE}/admin-kit`]);
    const result = await runGenerate({ cwd: root });
    const stylesheet = readFileSync(result.artefacts[1]!.path, 'utf8');
    expect(stylesheet).toContain(`@import "${SCOPE}/admin-shell/tailwind.css";`);
    expect(stylesheet).toContain(`@import "${SCOPE}/admin-kit/tailwind.css";`);
  });

  /**
   * A UI package another UI package needs, which the instance declares nowhere
   * — `page-builder-core` is a required peer of `page-builder-admin`, so pnpm
   * installs it into the store and links it into no manifest's `node_modules`.
   * Its classes render inside the page builder all the same. A bare specifier
   * does not resolve from the admin project, so the import names the installed
   * file by a path relative to the artefact, which is regenerated on every
   * build anyway.
   */
  it('imports a UI package reached only as another UI package\'s peer, by path', async () => {
    const root = instance(['blog']);
    installUiPackage(root, `${SCOPE}/page-builder-core`, []);
    installUiPackage(root, `${SCOPE}/page-builder-admin`, [root], [`${SCOPE}/page-builder-core`]);
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    manifest.dependencies[`${SCOPE}/page-builder-admin`] = '^1.0.0';
    write(join(root, 'package.json'), JSON.stringify(manifest));
    const result = await runGenerate({ cwd: root });
    const stylesheet = readFileSync(result.artefacts[1]!.path, 'utf8');
    expect(stylesheet).toContain(`@import "${SCOPE}/page-builder-admin/tailwind.css";`);
    expect(stylesheet).toContain(
      `@import "../../node_modules/.pnpm/${SCOPE}+page-builder-core@1.0.0/node_modules/${SCOPE}/page-builder-core/tailwind.css";`,
    );
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
    // The admin project's two, plus the entity index, which belongs to no member
    // and is therefore rendered whatever this instance's members are (T065).
    expect(result.artefacts).toHaveLength(3);
  });

  /**
   * The refusal is *"a run that wrote nothing and said it succeeded"*, and T065
   * narrowed the state that satisfies it rather than weakening it.
   *
   * An instance with a module installed now has one artefact whatever its
   * members are — the entity index, whose population is the install and whose
   * consumer is not a member. So the state this refuses is a workspace with no
   * member, no deployment **and no module**, which is a directory this command
   * genuinely has nothing to say about.
   */
  it('refuses an instance with no member, no deployment and no module — exit 1', async () => {
    const root = instance([], { admin: false, docs: false });
    rmSync(join(root, 'admin'), { recursive: true, force: true });
    rmSync(join(root, 'docs'), { recursive: true, force: true });
    // Installed, and not a module: an instance always has the platform, and a
    // `node_modules` that is not there at all is the *other* refusal — exit 2,
    // because a run that could not read its input has said nothing.
    write(
      join(root, 'node_modules', SCOPE, 'platform', 'package.json'),
      JSON.stringify({ name: `${SCOPE}/platform`, version: '1.0.0', endora: { type: 'platform' } }),
    );
    let raised: unknown;
    try {
      await runGenerate({ cwd: root });
    } catch (error: unknown) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(GenerateInputError);
    expect((raised as Error).message).toContain('"@/*"');
    expect((raised as Error).message).toContain('Docusaurus');
    expect((raised as Error).message).toContain('entity index');
  });

  it('renders the entity index for a headless instance, and does not refuse', async () => {
    const root = instance(['blog'], { admin: false, docs: false });
    rmSync(join(root, 'admin'), { recursive: true, force: true });
    rmSync(join(root, 'docs'), { recursive: true, force: true });
    const result = await runGenerate({ cwd: root });
    expect(result.artefacts.map((artefact) => artefact.path)).toEqual([
      join(root, 'backend', 'test', 'entities.generated.ts'),
    ]);
    const index = readFileSync(join(root, 'backend', 'test', 'entities.generated.ts'), 'utf8');
    // The bare specifier the package's own `exports` map declares, keyed by the
    // module id — never a path into `dist`, which no consumer could resolve.
    expect(index).toContain(`from '${SCOPE}/mod-blog/backend'`);
    expect(index).toContain('  blog: entities0,');
  });

  it('a module that publishes no admin layer is in neither artefact and is not a refusal', async () => {
    const root = instance(['blog']);
    installModule(root, 'headless', { admin: false });
    const result = await runGenerate({ cwd: root });
    expect(result.modules).toBe(2);
    expect(readFileSync(result.artefacts[0]!.path, 'utf8')).not.toContain('mod-headless');
  });
  /**
   * A module's finished block stylesheet (`specs/141-module-block-renderers/`
   * T11; contract §5.1, §6). The admin canvas draws a module's block with the
   * module's own renderer, so it needs the stylesheet the storefront loads —
   * and it reaches the bundle the way every other package stylesheet does.
   */
  it('imports the `./blocks.css` of a module package that declares it, once', async () => {
    const root = instance(['blog']);
    installModule(root, 'blog', { admin: true, blocksCss: 'published' });
    const result = await runGenerate({ cwd: root });
    const stylesheet = readFileSync(join(root, 'admin', 'src', 'tailwind.generated.css'), 'utf8');
    expect(stylesheet.split(`@import "${SCOPE}/mod-blog/blocks.css";`)).toHaveLength(2);
    // After the Tailwind sources, so a module's finished rules are not
    // re-ordered ahead of the layers they are written against.
    expect(stylesheet.indexOf('/blocks.css')).toBeGreaterThan(
      stylesheet.indexOf(`@import "${SCOPE}/mod-blog/tailwind.css";`),
    );
    expect(result.modules).toBe(1);
  });

  it('imports no block stylesheet for a module that declares none', async () => {
    const root = instance(['blog', 'cms']);
    installModule(root, 'cms', { admin: true, blocksCss: 'published' });
    await runGenerate({ cwd: root });
    const stylesheet = readFileSync(join(root, 'admin', 'src', 'tailwind.generated.css'), 'utf8');
    expect(stylesheet).toContain(`@import "${SCOPE}/mod-cms/blocks.css";`);
    expect(stylesheet).not.toContain(`${SCOPE}/mod-blog/blocks.css`);
  });

  it('writes no block-stylesheet section at all when no module declares one', async () => {
    const root = instance(['blog']);
    await runGenerate({ cwd: root });
    const stylesheet = readFileSync(join(root, 'admin', 'src', 'tailwind.generated.css'), 'utf8');
    expect(stylesheet).not.toContain('blocks.css');
  });

  it('refuses a declared `./blocks.css` whose file is not in the package', async () => {
    const root = instance(['blog']);
    installModule(root, 'blog', { admin: true, blocksCss: 'declared-only' });
    await expect(runGenerate({ cwd: root })).rejects.toThrow(/blocks\.css/);
  });

  it('does not import a `./blocks.css` declared by a package that is not a module', async () => {
    const root = instance(['blog']);
    const kit = installUiPackage(root, `${SCOPE}/admin-kit`, [join(root, 'admin')]);
    const manifest = JSON.parse(readFileSync(join(kit, 'package.json'), 'utf8')) as {
      exports: Record<string, string>;
    };
    manifest.exports['./blocks.css'] = './blocks.css';
    writeFileSync(join(kit, 'package.json'), JSON.stringify(manifest));
    write(join(kit, 'blocks.css'), '.x { color: red; }\n');
    writeFileSync(
      join(root, 'admin', 'package.json'),
      JSON.stringify({ name: 'acme-admin', dependencies: { [`${SCOPE}/admin-kit`]: '^1.0.0' } }),
    );
    await runGenerate({ cwd: root });
    const stylesheet = readFileSync(join(root, 'admin', 'src', 'tailwind.generated.css'), 'utf8');
    expect(stylesheet).not.toContain('blocks.css');
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


/**
 * A module a release makes required, declared by the run that renders the
 * artefacts.
 *
 * 0.107.0's `invoices` lists `document_templates` in its manifest
 * `dependencies`, and `document_templates` is a package that release
 * publishes for the first time. `endora upgrade` runs the **previous**
 * release's CLI and moves only the packages an instance already declares, so
 * an instance upgraded from 0.106.0 installs `invoices` without the module it
 * needs and the platform refuses to boot (`ReducedDeploymentError`). The
 * upgrade's `setup` runs `endora generate` from the release just installed,
 * which is the first program of the new release that runs at all — so that is
 * where the module gets declared.
 */
describe('endora generate declares the release modules the installed ones need', () => {
  const PLATFORM = `${SCOPE}/platform`;
  const TEMPLATES = `${SCOPE}/mod-document-templates`;

  /** The CLI's own index, as a release carrying `document_templates` writes it. */
  function releaseIndex(
    entries: ReadonlyArray<{ name: string; version: string; moduleId?: string }> = [
      { name: `${SCOPE}/mod-invoices`, version: '0.107.0', moduleId: 'invoices' },
      { name: TEMPLATES, version: '0.107.0', moduleId: 'document_templates' },
      { name: PLATFORM, version: '0.107.0' },
    ],
  ): string {
    const dir = mkdtempSync(join(tmpdir(), 'index-'));
    scratch.push(dir);
    const file = join(dir, 'release-index.json');
    writeFileSync(file, JSON.stringify({ packages: entries }), 'utf8');
    return file;
  }

  /** An instance on 0.107.0 whose `invoices` needs a module it does not declare. */
  function upgraded(platformSpec: string, needs: { dependencies?: string[]; acknowledged?: string[] } = { dependencies: ['document_templates'] }): string {
    const root = instance(['invoices']);
    installModule(root, 'invoices', { admin: true, ...needs });
    // Written the way `endora new instance` writes it: two-space JSON, sorted.
    write(
      join(root, 'package.json'),
      `${JSON.stringify(
        {
          name: 'acme',
          private: true,
          scripts: { setup: 'pnpm run generate' },
          dependencies: { [`${SCOPE}/mod-invoices`]: platformSpec, [PLATFORM]: platformSpec },
        },
        null,
        2,
      )}\n`,
    );
    return root;
  }

  /**
   * A `pnpm install` standing in for the real one: every package of the
   * catalogue the root manifest declares lands in `node_modules`.
   */
  function fakeInstall(
    root: string,
    catalogue: Readonly<Record<string, { id: string; dependencies?: string[] }>>,
    steps: GenerateStep[],
    code = 0,
  ): (step: GenerateStep) => Promise<number> {
    return async (step) => {
      steps.push(step);
      if (code !== 0) return code;
      const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>;
      };
      for (const [name, pkg] of Object.entries(catalogue)) {
        if (manifest.dependencies[name] === undefined) continue;
        installModule(root, pkg.id, {
          admin: true,
          name,
          ...(pkg.dependencies === undefined ? {} : { dependencies: pkg.dependencies }),
        });
      }
      return 0;
    };
  }

  it('declares it at the platform\'s exact pin, in place, installs it, and renders it', async () => {
    const root = upgraded('0.107.0');
    const steps: GenerateStep[] = [];
    const result = await runGenerate({
      cwd: root,
      releaseIndexFile: releaseIndex(),
      run: fakeInstall(root, { [TEMPLATES]: { id: 'document_templates' } }, steps),
    });

    // The manifest text, edited and not re-serialised: the entry lands in its
    // alphabetical place at the file's own indentation, and nothing else moves.
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(
      `{\n` +
        `  "name": "acme",\n` +
        `  "private": true,\n` +
        `  "scripts": {\n` +
        `    "setup": "pnpm run generate"\n` +
        `  },\n` +
        `  "dependencies": {\n` +
        `    "${TEMPLATES}": "0.107.0",\n` +
        `    "${SCOPE}/mod-invoices": "0.107.0",\n` +
        `    "${PLATFORM}": "0.107.0"\n` +
        `  }\n` +
        `}\n`,
    );
    expect(steps.map((step) => [step.command, step.bin, step.argv, step.cwd])).toEqual([
      ['pnpm install', 'pnpm', ['install'], root],
    ]);
    expect(result.declared).toEqual([
      {
        packageName: TEMPLATES,
        spec: '0.107.0',
        moduleId: 'document_templates',
        neededBy: [{ moduleId: 'invoices', field: 'dependencies' }],
        written: true,
      },
    ]);
    // The second scan saw what the install put there, so the artefacts name it.
    expect(result.modules).toBe(2);
    expect(readFileSync(join(root, 'admin', 'src', 'modules.generated.ts'), 'utf8')).toContain(
      `from '${TEMPLATES}/admin'`,
    );
    expect(generateReport(result)).toContain(
      `declared ${TEMPLATES} 0.107.0 in package.json — invoices needs document_templates ` +
        `(dependencies); installed it`,
    );
  });

  it('keeps the platform\'s caret, in a manifest written on one line', async () => {
    const root = upgraded('^0.107.0');
    write(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'acme',
        dependencies: { [`${SCOPE}/mod-invoices`]: '^0.107.0', [PLATFORM]: '^0.107.0' },
      }),
    );
    const steps: GenerateStep[] = [];
    const result = await runGenerate({
      cwd: root,
      releaseIndexFile: releaseIndex(),
      run: fakeInstall(root, { [TEMPLATES]: { id: 'document_templates' } }, steps),
    });
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(
      JSON.stringify({
        name: 'acme',
        dependencies: {
          [TEMPLATES]: '^0.107.0',
          [`${SCOPE}/mod-invoices`]: '^0.107.0',
          [PLATFORM]: '^0.107.0',
        },
      }),
    );
    expect(result.declared.map((entry) => entry.spec)).toEqual(['^0.107.0']);
    expect(steps).toHaveLength(1);
  });

  it('takes the release\'s own version, exact, when the platform is not declared at a version', async () => {
    const root = upgraded('0.107.0');
    const manifest = readFileSync(join(root, 'package.json'), 'utf8').replace(
      `"${PLATFORM}": "0.107.0"`,
      `"${PLATFORM}": "file:../platform.tgz"`,
    );
    write(join(root, 'package.json'), manifest);
    const result = await runGenerate({
      cwd: root,
      releaseIndexFile: releaseIndex(),
      run: fakeInstall(root, { [TEMPLATES]: { id: 'document_templates' } }, []),
    });
    expect(result.declared.map((entry) => entry.spec)).toEqual(['0.107.0']);
  });

  it('counts an `acknowledgedDependencies` edge exactly as a `dependencies` one', async () => {
    const root = upgraded('0.107.0', { acknowledged: ['document_templates'] });
    const result = await runGenerate({
      cwd: root,
      releaseIndexFile: releaseIndex(),
      run: fakeInstall(root, { [TEMPLATES]: { id: 'document_templates' } }, []),
    });
    expect(result.declared[0]?.neededBy).toEqual([
      { moduleId: 'invoices', field: 'acknowledgedDependencies' },
    ]);
    expect(generateReport(result).join('\n')).toContain(
      'invoices needs document_templates (acknowledgedDependencies)',
    );
  });

  it('closes over what the module it added needs in turn, one install per round', async () => {
    const root = upgraded('0.107.0');
    const fonts = `${SCOPE}/mod-pdf-fonts`;
    const steps: GenerateStep[] = [];
    const result = await runGenerate({
      cwd: root,
      releaseIndexFile: releaseIndex([
        { name: TEMPLATES, version: '0.107.0', moduleId: 'document_templates' },
        { name: fonts, version: '0.107.0', moduleId: 'pdf_fonts' },
        { name: PLATFORM, version: '0.107.0' },
      ]),
      run: fakeInstall(
        root,
        {
          [TEMPLATES]: { id: 'document_templates', dependencies: ['pdf_fonts'] },
          [fonts]: { id: 'pdf_fonts' },
        },
        steps,
      ),
    });
    expect(result.declared.map((entry) => [entry.packageName, entry.neededBy])).toEqual([
      [TEMPLATES, [{ moduleId: 'invoices', field: 'dependencies' }]],
      [fonts, [{ moduleId: 'document_templates', field: 'dependencies' }]],
    ]);
    expect(steps).toHaveLength(2);
    expect(result.modules).toBe(3);
  });

  it('declares nothing for a module every deployment omits', async () => {
    const root = upgraded('0.107.0');
    installPlatform(root);
    write(
      join(root, 'apps', 'acme', 'divergence.ts'),
      `export const divergence = {\n` +
        `  omittedModules: [{ moduleId: 'document_templates', reason: 'Invoices are issued in the ERP.' }],\n` +
        `  decorationOrder: {},\n` +
        `  reasons: {},\n` +
        `} as const;\n`,
    );
    mkdirSync(join(root, 'apps', 'acme', 'modules'), { recursive: true });
    // A registration the report can attribute, so it renders rather than refusing
    // an owner map that resolved nothing.
    write(
      join(root, 'node_modules', SCOPE, 'mod-invoices', 'dist', 'backend', 'index.js'),
      `export const entities = [];\n` +
        `export function registerModule(ctx) {\n` +
        `    ctx.di.register({ invoiceService: ctx.asClass(Service).singleton() });\n` +
        `}\n`,
    );
    const before = readFileSync(join(root, 'package.json'), 'utf8');
    const result = await runGenerate({
      cwd: root,
      releaseIndexFile: releaseIndex(),
      run: () => Promise.reject(new Error('nothing is missing, so nothing is installed')),
    });
    expect(result.declared).toEqual([]);
    expect(result.unlisted).toEqual([]);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(before);
  });

  it('leaves a module no release package carries alone, names it, and installs nothing', async () => {
    const root = upgraded('0.107.0', { dependencies: ['document_templates', '_lifecycle'] });
    installPlatform(root);
    const before = readFileSync(join(root, 'package.json'), 'utf8');
    const result = await runGenerate({
      cwd: root,
      releaseIndexFile: releaseIndex([{ name: PLATFORM, version: '0.107.0' }]),
      run: () => Promise.reject(new Error('there is no package to install')),
    });
    expect(result.declared).toEqual([]);
    // `_lifecycle` is the platform's own, so it is not missing at all.
    expect(result.unlisted).toEqual([
      { moduleId: 'document_templates', neededBy: [{ moduleId: 'invoices', field: 'dependencies' }] },
    ]);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(before);
    expect(generateReport(result).join('\n')).toMatch(/document_templates.*invoices/);
  });

  it('a dry run reports what it would declare, writes nothing and runs nothing', async () => {
    const root = upgraded('0.107.0');
    const before = readFileSync(join(root, 'package.json'), 'utf8');
    const result = await runGenerate({
      cwd: root,
      dryRun: true,
      releaseIndexFile: releaseIndex(),
      run: () => Promise.reject(new Error('a dry run runs nothing')),
    });
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(before);
    expect(result.declared.map((entry) => [entry.packageName, entry.spec])).toEqual([
      [TEMPLATES, '0.107.0'],
    ]);
    expect(generateReport(result)).toContain(
      `would declare ${TEMPLATES} 0.107.0 in package.json — invoices needs document_templates ` +
        `(dependencies); and run \`pnpm install\``,
    );
  });

  it('a failed install is exit 2, and the manifest already declares the module', async () => {
    const root = upgraded('0.107.0');
    let raised: unknown;
    try {
      await runGenerate({
        cwd: root,
        releaseIndexFile: releaseIndex(),
        run: fakeInstall(root, {}, [], 1),
      });
    } catch (error: unknown) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(GenerateHostError);
    expect((raised as Error).message).toContain('pnpm install');
    expect((raised as Error).message).toContain('pnpm run setup');
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain(`"${TEMPLATES}": "0.107.0"`);
  });

  it('runs nothing when no installed module needs anything missing — the common case', async () => {
    const root = instance(['blog', 'invoices']);
    installModule(root, 'invoices', { admin: true, dependencies: ['blog'], acknowledged: ['blog'] });
    const before = readFileSync(join(root, 'package.json'), 'utf8');
    const result = await runGenerate({
      cwd: root,
      releaseIndexFile: releaseIndex(),
      run: () => Promise.reject(new Error('nothing is missing, so nothing is installed')),
    });
    expect(result.declared).toEqual([]);
    expect(result.unlisted).toEqual([]);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(before);
  });
});

/**
 * The host an instance installed: `endora.type: "platform"`, the
 * `ModuleContext` declaration the divergence report classifies seams against,
 * and the one module it carries itself.
 */
function installPlatform(root: string): void {
  const dir = join(root, 'node_modules', SCOPE, 'platform');
  write(
    join(dir, 'package.json'),
    JSON.stringify({
      name: `${SCOPE}/platform`,
      version: '0.107.0',
      endora: { type: 'platform' },
      exports: {
        './kernel': { types: './dist/kernel/index.d.ts', default: './dist/kernel/index.js' },
        './composition': './dist/composition/index.js',
        './lifecycle': './dist/lifecycle/index.js',
      },
    }),
  );
  // A name the composition root supplies, so the divergence report has an
  // owner to resolve and renders rather than refusing a vacuous pass.
  write(
    join(dir, 'dist', 'composition', 'index.js'),
    `export function composeApp(options) {\n` +
      `    const container = createRootContainer();\n` +
      `    registerValues(container, {\n` +
      `        commandBus: buildCommandBus(),\n` +
      `    });\n` +
      `    return container;\n` +
      `}\n`,
  );
  write(join(dir, 'dist', 'kernel', 'index.js'), 'export {};\n');
  write(join(dir, 'dist', 'kernel', 'index.d.ts'), "export type { ModuleContext } from './module-context.js';\n");
  write(
    join(dir, 'dist', 'kernel', 'module-context.d.ts'),
    `export interface ModuleContext {\n` +
      `    readonly module: { readonly id: string };\n` +
      `    routes(register: (app: unknown) => void): void;\n` +
      `}\n`,
  );
  write(join(dir, 'dist', 'lifecycle', 'index.js'), "export const manifest = { id: '_lifecycle' };\n");
}

describe('endora generate refuses an installed package declaring admit middleware (189 T044, FR-004)', () => {
  function indexFile(entries: ReadonlyArray<{ name: string; version: string; moduleId?: string }>): string {
    const dir = mkdtempSync(join(tmpdir(), 'index-'));
    scratch.push(dir);
    const file = join(dir, 'release-index.json');
    writeFileSync(file, JSON.stringify({ packages: entries }), 'utf8');
    return file;
  }

  it('reports a non-first-party package declaring admit, before boot, naming the package and the ruling', async () => {
    const root = instance(['invoices']);
    installModule(root, 'acme_paid', {
      admin: false,
      commandMiddleware: [
        { id: 'legal-hold', phase: 'admit', actions: '*' },
        { id: 'timing', phase: 'observe', actions: '*' },
      ],
    });
    const result = await runGenerate({
      cwd: root,
      dryRun: true,
      releaseIndexFile: indexFile([{ name: `${SCOPE}/mod-invoices`, version: '0.113.0', moduleId: 'invoices' }]),
    });
    expect(result.packageAdmit).toEqual([
      { moduleId: 'acme_paid', packageName: `${SCOPE}/mod-acme_paid`, middleware: ['legal-hold'] },
    ]);
    const refusal = generateFindingsRefusal(result);
    expect(refusal).toMatch(/acme_paid/);
    expect(refusal).toMatch(/legal-hold/);
    expect(refusal).toMatch(/D-296\.3/);
  });

  it('accepts admit from a first-party package of this release, and observe from any package', async () => {
    const root = instance(['invoices']);
    installModule(root, 'invoices', {
      admin: true,
      commandMiddleware: [{ id: 'legal-hold', phase: 'admit', actions: ['invoice.'] }],
    });
    installModule(root, 'acme_metrics', {
      admin: false,
      commandMiddleware: [{ id: 'timing', phase: 'observe', actions: '*' }],
    });
    const result = await runGenerate({
      cwd: root,
      dryRun: true,
      releaseIndexFile: indexFile([{ name: `${SCOPE}/mod-invoices`, version: '0.113.0', moduleId: 'invoices' }]),
    });
    expect(result.packageAdmit).toEqual([]);
  });
});
