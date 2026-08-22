import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  nodeModulesRootsFor,
  scanNodeModulesRoots,
} from '../../../src/packages/installed-packages.js';

/**
 * The half of `loadPackageModuleEntries` that decides **what is installed**
 * (feature 080, T031).
 *
 * Every case below enters at the top of the analysis (issue #130): a real
 * directory tree with real symlinks, scanned by the same function the
 * composition roots call. A fixture handed to the classifier as a pre-built
 * record would skip the enumeration, and the enumeration is the half that has
 * to tell a tarball install from a workspace member.
 */

let root: string;

/** `<root>/<instance>/node_modules/<name>` with the given package.json. */
function install(instance: string, name: string, manifest: Record<string, unknown>): string {
  const dir = join(root, instance, 'node_modules', ...name.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name, ...manifest }, null, 2)}\n`);
  return dir;
}

function nodeModules(instance: string): string {
  const dir = join(root, instance, 'node_modules');
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'endora-installed-packages-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('a package is recognised by its manifest field, never by its name (D-07)', () => {
  it('finds a scoped and an unscoped package carrying `endora.type === "module"`', () => {
    install('plain', '@vendor/mod-alpha', {
      version: '1.2.3',
      endora: { type: 'module', id: 'alpha' },
    });
    install('plain', 'unscoped-endora-thing', {
      version: '0.1.0',
      endora: { type: 'module', id: 'beta' },
    });
    install('plain', 'left-pad', { version: '1.0.0' });

    const scan = scanNodeModulesRoots([nodeModules('plain')]);

    expect(scan.packages.map((p) => p.id).sort()).toEqual(['alpha', 'beta']);
    expect(scan.packages.find((p) => p.id === 'alpha')?.version).toBe('1.2.3');
    expect(scan.packages.find((p) => p.id === 'alpha')?.manifestPath).toContain(
      join('@vendor', 'mod-alpha', 'package.json'),
    );
  });

  it('skips a package whose `endora.type` is not `module`', () => {
    install('themed', '@vendor/theme-dark', {
      version: '1.0.0',
      endora: { type: 'theme', id: 'dark' },
    });

    const scan = scanNodeModulesRoots([nodeModules('themed')]);

    expect(scan.packages).toEqual([]);
    expect(scan.skipped).toContainEqual(
      expect.objectContaining({ kind: 'not-an-endora-module', name: '@vendor/theme-dark' }),
    );
  });

  it('skips an `endora` field with no id rather than composing a module with no identity', () => {
    install('anonymous', '@vendor/mod-anonymous', {
      version: '1.0.0',
      endora: { type: 'module' },
    });

    const scan = scanNodeModulesRoots([nodeModules('anonymous')]);

    expect(scan.packages).toEqual([]);
    expect(scan.skipped).toContainEqual(
      expect.objectContaining({ kind: 'unreadable', at: expect.stringContaining('mod-anonymous') }),
    );
  });
});

describe('a workspace member is not an installed package', () => {
  /**
   * The trap this exists for: pnpm links a workspace member into
   * `node_modules`, so "it was found in node_modules" is satisfied by a
   * directory that never left the repository. The predicate is where the link
   * *lands* — the same property A8 measures on the acceptance instance.
   */
  it('refuses a package linked out of the node_modules tree it was found under', () => {
    const source = join(root, 'workspace-source', 'packages', 'mod-linked');
    mkdirSync(source, { recursive: true });
    writeFileSync(
      join(source, 'package.json'),
      `${JSON.stringify(
        {
          name: '@workspace/mod-linked',
          version: '1.0.0',
          endora: { type: 'module', id: 'linked' },
        },
        null,
        2,
      )}\n`,
    );
    const scoped = join(root, 'linked', 'node_modules', '@workspace');
    mkdirSync(scoped, { recursive: true });
    symlinkSync(source, join(scoped, 'mod-linked'), 'dir');

    const scan = scanNodeModulesRoots([nodeModules('linked')]);

    expect(scan.packages).toEqual([]);
    expect(scan.skipped).toContainEqual(
      expect.objectContaining({
        kind: 'links-out-of-node-modules',
        name: '@workspace/mod-linked',
      }),
    );
  });

  it("accepts pnpm's own store hop, which stays inside node_modules", () => {
    // The discrimination fixture for the case above: a real `pnpm add` also
    // produces a symlink, into `node_modules/.pnpm/…`. Refusing every symlink
    // would refuse the only layout a real instance has.
    const store = join(
      root,
      'stored',
      'node_modules',
      '.pnpm',
      '@vendor+mod-stored@1.0.0',
      'node_modules',
      '@vendor',
      'mod-stored',
    );
    mkdirSync(store, { recursive: true });
    writeFileSync(
      join(store, 'package.json'),
      `${JSON.stringify(
        { name: '@vendor/mod-stored', version: '1.0.0', endora: { type: 'module', id: 'stored' } },
        null,
        2,
      )}\n`,
    );
    const scoped = join(root, 'stored', 'node_modules', '@vendor');
    mkdirSync(scoped, { recursive: true });
    symlinkSync(store, join(scoped, 'mod-stored'), 'dir');

    const scan = scanNodeModulesRoots([nodeModules('stored')]);

    expect(scan.packages.map((p) => p.id)).toEqual(['stored']);
  });

  it('never descends into the pnpm store itself, so one package is found once', () => {
    const scan = scanNodeModulesRoots([nodeModules('stored')]);
    expect(scan.packages).toHaveLength(1);
  });
});

describe('a node_modules that is itself a link (issue #255)', () => {
  /**
   * A workspace link is **relative**, so it re-roots with the directory it
   * physically sits in; issue #255 is what happens when a whole `node_modules`
   * is copied or aliased. Containment is therefore asked over `realpath` on
   * both sides — the root as well as the candidate — and these two cases are
   * the pair that says so.
   */
  it('accepts a real package under an aliased root, which a prefix test would refuse', () => {
    const store = join(root, 'real-store', 'node_modules', '@vendor', 'mod-aliased');
    mkdirSync(store, { recursive: true });
    writeFileSync(
      join(store, 'package.json'),
      `${JSON.stringify(
        { name: '@vendor/mod-aliased', version: '1.0.0', endora: { type: 'module', id: 'aliased' } },
        null,
        2,
      )}\n`,
    );
    mkdirSync(join(root, 'aliased'), { recursive: true });
    symlinkSync(join(root, 'real-store', 'node_modules'), join(root, 'aliased', 'node_modules'), 'dir');

    const scan = scanNodeModulesRoots([join(root, 'aliased', 'node_modules')]);

    expect(scan.packages.map((p) => p.id)).toEqual(['aliased']);
  });

  it('still refuses a workspace member reached through that aliased root', () => {
    // The discrimination: relaxing the root is not relaxing the rule. The
    // `@endora-commerce/*` shape — a relative link onto `packages/<name>` — lands outside
    // whichever `node_modules` it was reached through, in every wiring.
    const source = join(root, 'aliased-workspace-source', 'packages', 'mod-member');
    mkdirSync(source, { recursive: true });
    writeFileSync(
      join(source, 'package.json'),
      `${JSON.stringify(
        { name: '@endora-commerce/mod-member', version: '1.0.0', endora: { type: 'module', id: 'member' } },
        null,
        2,
      )}\n`,
    );
    const scoped = join(root, 'real-store', 'node_modules', '@endora-commerce');
    mkdirSync(scoped, { recursive: true });
    symlinkSync(source, join(scoped, 'mod-member'), 'dir');

    const scan = scanNodeModulesRoots([join(root, 'aliased', 'node_modules')]);

    expect(scan.packages.map((p) => p.id)).not.toContain('member');
    expect(scan.skipped).toContainEqual(
      expect.objectContaining({ kind: 'links-out-of-node-modules', name: '@endora-commerce/mod-member' }),
    );
  });
});

describe('the roots it reads', () => {
  it('is empty, and says so, when no root exists rather than reporting a clean scan', () => {
    const scan = scanNodeModulesRoots([join(root, 'nowhere', 'node_modules')]);
    expect(scan.rootsRead).toEqual([]);
    expect(scan.packages).toEqual([]);
  });

  it('reads a declared instance root before the chain above the running platform', () => {
    const instance = nodeModules('declared');
    const roots = nodeModulesRootsFor({
      ENDORA_INSTANCE_ROOT: join(root, 'declared'),
    } as NodeJS.ProcessEnv);
    expect(roots[0]).toBe(instance);
  });

  it('reads the chain above the running platform when nothing is declared', () => {
    // A deployed instance has no variable set: the platform's own
    // `node_modules` is where its extension packages are installed.
    const roots = nodeModulesRootsFor({} as NodeJS.ProcessEnv);
    expect(roots.some((r) => r.endsWith(join('backend', 'node_modules')))).toBe(true);
  });

  it('deduplicates a declared root that is already on the chain', () => {
    const roots = nodeModulesRootsFor({} as NodeJS.ProcessEnv);
    expect(new Set(roots).size).toBe(roots.length);
  });
});
