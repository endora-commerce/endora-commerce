import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ModuleIdCollisionError } from '../../../src/packages/module-id-claims.js';
import {
  loadPackageModuleEntries,
  packageModuleEntriesUnder,
  packageModuleManifestsUnder,
} from '../../../src/packages/package-runtime.js';

/**
 * `loadPackageModuleEntries` (feature 080, T031) — the second caller of the
 * discovery seam `loadOverlayModuleEntries` uses, over a real installed
 * package rather than a deployment directory.
 *
 * The fixtures are written to disk as an instance would hold them: a
 * `node_modules` tree, a `package.json` carrying `endora`, an `exports` map,
 * and compiled `.js` entry points. Nothing here is handed a pre-built
 * `ModuleEntry` — the enumeration, the `exports` resolution and the dynamic
 * import are the parts that have to work (issue #130).
 */

let root: string;

interface FixtureOptions {
  readonly instance: string;
  readonly name: string;
  readonly id: string;
  readonly version?: string;
  readonly manifestId?: string;
  /** Omit the `./backend` export entirely — a module with no server half. */
  readonly withoutBackend?: boolean;
  /** Ship a `./backend` that exports no `registerModule`. */
  readonly backendWithoutRegisterModule?: boolean;
}

function writeFixture(options: FixtureOptions): string {
  const dir = join(root, options.instance, 'node_modules', ...options.name.split('/'));
  mkdirSync(join(dir, 'dist'), { recursive: true });

  const exportsMap: Record<string, string> = {
    '.': './dist/manifest.js',
    './package.json': './package.json',
  };
  if (!options.withoutBackend) exportsMap['./backend'] = './dist/backend.js';

  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: options.name,
        version: options.version ?? '1.0.0',
        type: 'module',
        endora: { type: 'module', id: options.id, platform: '0.x' },
        exports: exportsMap,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(dir, 'dist', 'manifest.js'),
    `export const manifest = ${JSON.stringify({
      id: options.manifestId ?? options.id,
      name: options.name,
      version: options.version ?? '1.0.0',
      dependencies: [],
    })};\nexport default manifest;\n`,
  );
  if (!options.withoutBackend) {
    writeFileSync(
      join(dir, 'dist', 'backend.js'),
      options.backendWithoutRegisterModule
        ? 'export const somethingElse = 1;\n'
        : 'export function registerModule(ctx) { globalThis.__composedPackages ??= []; globalThis.__composedPackages.push(ctx); }\n',
    );
  }
  return dir;
}

function nodeModules(instance: string): string {
  const dir = join(root, instance, 'node_modules');
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'endora-package-runtime-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('an installed package composes as an ordinary module entry', () => {
  it('carries the id from `endora.id`, the manifest version and the package’s registerModule', async () => {
    writeFixture({ instance: 'one', name: '@vendor/mod-crm', id: 'crm', version: '2.3.4' });

    const entries = await packageModuleEntriesUnder([nodeModules('one')]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe('crm');
    expect(entries[0]?.version).toBe('2.3.4');
    expect(typeof entries[0]?.registerModule).toBe('function');
  });

  it('does NOT carry the overlay exemption', async () => {
    // `ModuleEntry.overlay` exempts a module from the rule that it may decorate
    // only what it registered (issue #203). An overlay module earns it from the
    // root it was found under: the deployment authored it. A package is a
    // stranger, so the conservative answer is that it does not get the
    // exemption and `ctx.di.decorate` over another module's registration is
    // refused. Nothing in this repository rules otherwise yet.
    writeFixture({ instance: 'two', name: '@vendor/mod-wms', id: 'wms' });

    const entries = await packageModuleEntriesUnder([nodeModules('two')]);

    expect(entries[0]?.overlay).toBeUndefined();
  });

  it('reports the resolved package.json as the manifest entry’s filePath', async () => {
    // `dirname(filePath)` is how the i18n reconciler and the orchestrator find
    // a module's assets. For a core module the anchor is `manifest.ts`; for a
    // package it is the `package.json` that claimed the id — a file that
    // actually exists in the published artefact, unlike the compiled root
    // export's directory.
    writeFixture({ instance: 'three', name: '@vendor/mod-pos', id: 'pos' });

    const manifests = await packageModuleManifestsUnder([nodeModules('three')]);

    expect(manifests).toHaveLength(1);
    expect(manifests[0]?.filePath).toBe(
      join(root, 'three', 'node_modules', '@vendor', 'mod-pos', 'package.json'),
    );
  });

  it('finds nothing, and throws nothing, for an instance with no packages', async () => {
    expect(await packageModuleEntriesUnder([nodeModules('empty')])).toEqual([]);
    expect(await loadPackageModuleEntries({} as NodeJS.ProcessEnv)).toEqual([]);
  });
});

describe('what it refuses', () => {
  it('refuses a manifest whose id disagrees with `endora.id`', async () => {
    writeFixture({
      instance: 'disagree',
      name: '@vendor/mod-two-faced',
      id: 'declared_id',
      manifestId: 'other_id',
    });

    await expect(packageModuleEntriesUnder([nodeModules('disagree')])).rejects.toThrow(
      /declared_id[\s\S]*other_id|other_id[\s\S]*declared_id/,
    );
  });

  it('refuses two packages claiming one id, naming both package.json paths', async () => {
    writeFixture({ instance: 'collide', name: '@a/mod-blog', id: 'blog' });
    writeFixture({ instance: 'collide', name: '@b/mod-blog', id: 'blog' });

    const thrown = await packageModuleEntriesUnder([nodeModules('collide')]).catch(
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(ModuleIdCollisionError);
    expect((thrown as Error).message).toContain(join('@a', 'mod-blog', 'package.json'));
    expect((thrown as Error).message).toContain(join('@b', 'mod-blog', 'package.json'));
  });

  it('refuses a `./backend` export that exports no registerModule', async () => {
    writeFixture({
      instance: 'no-register',
      name: '@vendor/mod-silent',
      id: 'silent',
      backendWithoutRegisterModule: true,
    });

    await expect(packageModuleEntriesUnder([nodeModules('no-register')])).rejects.toThrow(
      /registerModule/,
    );
  });
});

describe('a package with no server half', () => {
  it('contributes a manifest but no composer entry', async () => {
    // An admin- or storefront-only module. Skipping the entry is the same
    // answer `loadOverlayModuleEntries` gives a directory with no `backend.ts`;
    // dropping the manifest as well would take its permissions and its
    // activation control with it.
    writeFixture({
      instance: 'front-only',
      name: '@vendor/mod-frontend',
      id: 'frontend_only',
      withoutBackend: true,
    });

    expect(await packageModuleEntriesUnder([nodeModules('front-only')])).toEqual([]);
    expect(
      (await packageModuleManifestsUnder([nodeModules('front-only')])).map((m) => m.id),
    ).toEqual(['frontend_only']);
  });
});
