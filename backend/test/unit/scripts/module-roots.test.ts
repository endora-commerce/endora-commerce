import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  applicationModuleRoots,
  findManifestIndex,
  declaresRegisterModule,
  findRepoRoot,
  ModuleLayoutUnresolvableError,
  resolveModuleLayout,
  sourceRootOfIndex,
} from '../../../scripts/lib/module-roots.js';
import {
  nodeWorkspaceFs,
  workspaceGlobs,
  workspaceMemberDirectories,
  workspaceMembers,
  workspaceScopes,
} from '../../../scripts/lib/workspace-packages.js';

/**
 * "Where does this platform keep its backend modules?" — the derivation that
 * answers with a **list** (feature 080, T040a).
 *
 * Wave 1 (issue #215) made every module walk refuse a tree that had moved.
 * Refusing is not following, and the difference is what decides whether the
 * layout move can be incremental: the floor is per module, so the *first*
 * module that leaves `backend/src/modules` reds every check that has one. This
 * file is the unit half of the repair; `moved-module-tree.test.ts` is the
 * behavioural half, over two whole fixture repositories.
 *
 * Every case here enters at the **top** — a directory tree on disk, or the
 * injected filesystem the workspace reader takes — because the thing being
 * proved is *which files the derivation opens*, and a fixture handed a
 * half-computed root cannot prove that (issue #130).
 */

const roots: string[] = [];

function tree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'module-roots-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return root;
}

/** The generated index, in the shape the composer emits. */
function indexSource(entries: ReadonlyArray<{ id: string; from: string }>): string {
  return [
    ...entries.map((entry, i) => `import { manifest as manifest${i} } from '${entry.from}';`),
    'export const DISCOVERED_MANIFESTS = [',
    ...entries.map((entry, i) => `  { id: '${entry.id}', manifest: manifest${i} },`),
    '];',
    '',
  ].join('\n');
}

/** A module's manifest, inert — the derivations here read ids, never behaviour. */
const manifestSource = (id: string): string => `export const manifest = { id: '${id}' };\n`;

const WORKSPACE = 'packages:\n  - backend\n  - packages/*\n  - packages/modules/*\n';

/** A checkout with `blog` in the application tree and `shop` in a package. */
function splitCheckout(): string {
  return tree({
    'pnpm-workspace.yaml': WORKSPACE,
    'package.json': '{ "name": "root", "type": "module", "private": true }\n',
    'backend/package.json': '{ "name": "backend", "type": "module", "private": true }\n',
    'backend/src/modules/_lifecycle/manifest-index.generated.ts': indexSource([
      { id: 'blog', from: '../blog/manifest.js' },
      { id: 'shop', from: '../../../../packages/modules/shop/src/manifest.js' },
    ]),
    'backend/src/modules/_lifecycle/manifest.ts': manifestSource('_lifecycle'),
    'backend/src/modules/blog/manifest.ts': manifestSource('blog'),
    'backend/src/modules/blog/backend.ts': 'export const a = 1;\n',
    'backend/src/kernel/index.ts': 'export const k = 1;\n',
    'packages/modules/shop/package.json':
      '{ "name": "@endora-commerce/mod-shop", "type": "module", "endora": { "type": "module", "id": "shop" } }\n',
    'packages/modules/shop/src/manifest.ts': manifestSource('shop'),
    'packages/modules/shop/src/backend.ts': 'export const b = 1;\n',
  });
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('the workspace declaration is the authority for what a package is', () => {
  it('reads the block-sequence globs, comments and quotes included', () => {
    const root = tree({
      'pnpm-workspace.yaml':
        'packages:\n  - backend # the application\n  - "packages/*"\n  - packages/modules/*\nonlyBuiltDependencies:\n  - esbuild\n',
    });
    expect(workspaceGlobs(root, nodeWorkspaceFs())).toEqual([
      'backend',
      'packages/*',
      'packages/modules/*',
    ]);
  });

  it('produces a member the globs nest, which one `readdir` of `packages/` cannot', () => {
    // The #255 guard's population was `readdir('packages')`, one level deep.
    // A module package is two, and a package nothing sees is a package with no
    // foreign-link protection at all.
    const members = workspaceMemberDirectories(splitCheckout(), nodeWorkspaceFs());
    expect(members.map((dir) => dir.split('/').slice(-3).join('/'))).toEqual(
      expect.arrayContaining(['packages/modules/shop']),
    );
  });

  it('answers nothing for a flow-style list, which every caller refuses', () => {
    // Stated in the header rather than discovered later: the reader is a
    // block-sequence reader, and "no glob" is a refusal everywhere it is read.
    const root = tree({ 'pnpm-workspace.yaml': 'packages: [backend, packages/*]\n' });
    expect(workspaceGlobs(root, nodeWorkspaceFs())).toEqual([]);
    expect(workspaceMemberDirectories(root, nodeWorkspaceFs())).toEqual([]);
  });

  it('derives the scopes rather than naming one, and skips the unscoped members', () => {
    const members = workspaceMembers(splitCheckout(), nodeWorkspaceFs());
    expect(workspaceScopes(members)).toEqual(['@endora-commerce/']);
  });
});

describe('the manifest index is located, not spelled', () => {
  it('finds it under `_lifecycle`, where it is today', () => {
    const root = splitCheckout();
    expect(findManifestIndex(root, nodeWorkspaceFs())).toBe(
      join(root, 'backend/src/modules/_lifecycle/manifest-index.generated.ts'),
    );
  });

  it('finds it at the host source root, where the 2026-08-22 ruling puts it', () => {
    // The index is bare core by D-104 and it enumerates *other* packages, so it
    // becomes host-owned after the move. A derivation that joined
    // `modules/_lifecycle/` onto a source root would answer "gone" here.
    const root = tree({
      'pnpm-workspace.yaml': WORKSPACE,
      'backend/package.json': '{ "name": "backend" }\n',
      'backend/src/manifest-index.generated.ts': indexSource([
        { id: 'shop', from: '@endora-commerce/mod-shop' },
      ]),
    });
    expect(findManifestIndex(root, nodeWorkspaceFs())).toBe(
      join(root, 'backend/src/manifest-index.generated.ts'),
    );
  });

  it('refuses a checkout that holds none, rather than answering with no modules', () => {
    const root = tree({
      'pnpm-workspace.yaml': WORKSPACE,
      'backend/package.json': '{ "name": "backend" }\n',
    });
    expect(() => findManifestIndex(root, nodeWorkspaceFs())).toThrow(
      ModuleLayoutUnresolvableError,
    );
  });

  it('refuses a checkout that holds two, rather than narrowing to whichever sorts first', () => {
    const root = splitCheckout();
    mkdirSync(join(root, 'backend/src/legacy-modules/_lifecycle'), { recursive: true });
    writeFileSync(
      join(root, 'backend/src/legacy-modules/_lifecycle/manifest-index.generated.ts'),
      indexSource([{ id: 'blog', from: '../blog/manifest.js' }]),
      'utf8',
    );
    expect(() => findManifestIndex(root, nodeWorkspaceFs())).toThrow(/more than one/);
  });

  it('takes the source root from where the index sits, under either layout', () => {
    expect(sourceRootOfIndex('/repo/backend/src/modules/_lifecycle/x.ts', '/repo/backend')).toBe(
      '/repo/backend/src',
    );
    expect(sourceRootOfIndex('/repo/backend/src/x.ts', '/repo/backend')).toBe('/repo/backend/src');
  });
});

describe('the roots themselves', () => {
  it('answers with both, and attributes a package by its declared id', async () => {
    const root = splitCheckout();
    const layout = await resolveModuleLayout(join(root, 'backend'));

    expect(layout.srcRoot).toBe(join(root, 'backend/src'));
    expect([...layout.registeredIds].sort()).toEqual(['blog', 'shop']);
    expect(layout.moduleWalkRoots).toEqual([
      join(root, 'backend/src/modules'),
      join(root, 'backend/src/apps'),
      join(root, 'packages/modules/shop'),
    ]);
    expect(layout.moduleIdOfPath(join(root, 'backend/src/modules/blog/backend.ts'))).toBe('blog');
    expect(layout.moduleIdOfPath(join(root, 'packages/modules/shop/src/backend.ts'))).toBe('shop');
    expect(layout.moduleIdOfPath(join(root, 'backend/src/kernel/index.ts'))).toBeNull();
  });

  it('keeps the application spelling and answers repo-relative for a package', async () => {
    // The two key shapes the estate already writes into its ledgers, unchanged
    // for the tree that has not moved — which is what makes this change a
    // no-op on today's repository.
    const root = splitCheckout();
    const layout = await resolveModuleLayout(join(root, 'backend'));

    expect(layout.keyOf(join(root, 'backend/src/modules/blog/backend.ts'))).toBe(
      'modules/blog/backend.ts',
    );
    expect(layout.displayOf(join(root, 'backend/src/modules/blog/backend.ts'))).toBe(
      'src/modules/blog/backend.ts',
    );
    expect(layout.keyOf(join(root, 'packages/modules/shop/src/backend.ts'))).toBe(
      'packages/modules/shop/src/backend.ts',
    );
    expect(layout.absolutePathOf('modules/blog/backend.ts')).toBe(
      join(root, 'backend/src/modules/blog/backend.ts'),
    );
    expect(layout.absolutePathOf('packages/modules/shop/src/backend.ts')).toBe(
      join(root, 'packages/modules/shop/src/backend.ts'),
    );
  });

  it('maps each module package npm name to the id it declares, and names nothing else', async () => {
    // `check-module-boundary` resolves a bare specifier through this map, so an
    // application module is only visible reaching a packaged one while the name
    // is in it. The direction is name → declared id (D-142): the ledger key an
    // edge had as a relative import has to be the key it keeps as a package
    // specifier, and the npm name is npm's namespace rather than identity.
    const root = splitCheckout();
    const layout = await resolveModuleLayout(join(root, 'backend'));

    expect([...layout.modulePackageNames]).toEqual([['@endora-commerce/mod-shop', 'shop']]);
    // `blog` is a module in the application tree, so it has no npm name — an
    // entry for it would make a third-party import of a same-named package read
    // as a reach into it.
    expect(layout.modulePackageNames.has('blog')).toBe(false);
  });

  it('drops a package name whose module the workspace no longer declares', async () => {
    const root = splitCheckout();
    rmSync(join(root, 'packages/modules/shop/package.json'));
    const layout = await resolveModuleLayout(join(root, 'backend'));

    // The map and the roots are one derivation, so they cannot disagree — which
    // is what makes the check's `module-packages:<covered>/<expected>` token a
    // reconciliation rather than a number printed twice.
    expect(layout.modulePackageNames.size).toBe(0);
    expect(
      layout.moduleRoots.filter((entry) => entry.origin === 'workspace-package'),
    ).toHaveLength(0);
  });

  it('does not read a package the workspace does not declare — the half-moved state', async () => {
    // One file's difference from the case above: the relocated module has no
    // `package.json`, so no glob produces it and no root covers it. Every check
    // must be able to *see* that, which is what the population floor does with
    // this answer.
    const root = splitCheckout();
    rmSync(join(root, 'packages/modules/shop/package.json'));
    const layout = await resolveModuleLayout(join(root, 'backend'));

    expect(layout.moduleWalkRoots).not.toContain(join(root, 'packages/modules/shop'));
    expect(layout.moduleDirectories.has('shop')).toBe(false);
  });

  it('names a module directory only where a manifest sits under a registered id', () => {
    // Both halves of the predicate. `test/unit/orders` shares a module's name
    // and is not a module; an overlay module has a manifest and is not in the
    // bare-core index (D-104), so neither is a root.
    const root = tree({
      'src/modules/blog/manifest.ts': manifestSource('blog'),
      'src/apps/example/modules/example_overlay/manifest.ts': manifestSource('example_overlay'),
      'src/orders/service.ts': 'export const a = 1;\n',
    });
    expect(applicationModuleRoots(join(root, 'src'), new Set(['blog', 'orders']))).toEqual([
      join(root, 'src/modules'),
    ]);
  });

  it('refuses a directory that is in no workspace at all', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'not-a-checkout-'));
    roots.push(outside);
    expect(findRepoRoot(outside)).toBeNull();
    await expect(resolveModuleLayout(outside)).rejects.toThrow(ModuleLayoutUnresolvableError);
  });
});

/**
 * The composition entry point is found by its **marker**, and the reason is a
 * fail-open this repository shipped (feature 080, T040b).
 *
 * `check-port-dependencies` matched `file.endsWith('/backend.ts')`, which is
 * where a module in the application's tree keeps `registerModule` and is not
 * where a module package keeps it — both packages here publish it from
 * `src/backend/index.ts`, because that is what their `exports` map's
 * `./backend` subpath points at. The consequence was not a missing check but a
 * wrong answer: a packaged module's `di.providePort` calls were invisible, so
 * every consumer of one of its ports read as *resolving an ungated
 * registration* and was asked to declare an absent-owner policy for a gate that
 * was already there. `blog` owns no port another module resolves and hid it;
 * `quote_requests` owns two, resolved by six modules.
 */
describe('declaresRegisterModule', () => {
  it('recognises the export in either layout, since it reads no path at all', () => {
    // The three spellings the tree actually holds, verbatim in shape.
    expect(
      declaresRegisterModule('export function registerModule(ctx: ModuleContext): void {}'),
    ).toBe(true);
    expect(declaresRegisterModule('export async function registerModule(ctx) {}')).toBe(true);
    expect(declaresRegisterModule('export const registerModule = (ctx) => {};')).toBe(true);
  });

  it('is not satisfied by a mention, an import or a call', () => {
    // Each of these is a file that talks about the entry point without being
    // one. Taking any of them would make a module compose from a file nobody
    // meant, which is the failure the composer's "exactly one" rule refuses.
    expect(declaresRegisterModule("import { registerModule } from './backend.js';")).toBe(false);
    expect(declaresRegisterModule('registerModule(ctx);')).toBe(false);
    expect(declaresRegisterModule('export function registerModules(ctx) {}')).toBe(false);
  });

  it('does not follow a re-export, which is the composer’s error to raise', () => {
    // Stated rather than discovered later: a barrel forwarding the export is
    // not recognised here. The composer refuses a package with zero such files
    // with a message naming the marker, which is a better place to learn it.
    expect(declaresRegisterModule("export { registerModule } from './module.js';")).toBe(false);
  });
});
