import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ModuleIdCollisionError } from '../../../src/packages/module-id-claims.js';
import { resolvedManifestEntries } from '../../../src/lifecycle/registered-manifests.js';
import { buildStaticRegistry } from '../../../src/lifecycle/services/static-registry.js';

/**
 * T036 / D-157.6(a) — the five `module:*` commands answer over the same module
 * set as `/platform/modules`.
 *
 * Each of them fed `buildStaticRegistry` from bare-core `REGISTERED_MANIFESTS`
 * while the orchestrator behind the admin API was fed the instance-resolved set,
 * so `module:install <package id>` answered `unknown module` for a module the
 * admin screen installed happily. A platform with two answers to one question is
 * the condition this programme exists to remove.
 *
 * **Two levels, because neither is worth much alone.** The source assertions say
 * the five scripts contain the expression; the fixture assertions say the
 * expression does what the defect needed it to do. Running the scripts is what
 * this suite must not do — `module:install` writes to whatever database
 * `DATABASE_URL` names, and issue #69 already removed the contract cases that
 * drove real state through them — so the subject of the first half is their own
 * source, exactly as in `uninstall-cli-operator-text.test.ts`.
 *
 * **They must also not compose** (D-157.2/D-157.3). Composition runs
 * `reconcileExistingModules`, which inserts `state='installed'` for every
 * manifest with no row: a composing `module:install X` would find `X` already
 * installed and no-op. A platform command operates *on* the platform, so it
 * calls the resolver directly and builds its own orchestrator.
 */

const SCRIPTS = ['install', 'uninstall', 'enable', 'disable', 'status'] as const;

const sourceOf = (name: string): string =>
  readFileSync(
    fileURLToPath(
      new URL(`../../../src/lifecycle/scripts/${name}.ts`, import.meta.url),
    ),
    'utf8',
  );

describe('the five module: commands read the instance-resolved manifest set', () => {
  it.each(SCRIPTS)('%s builds its registry from resolvedManifestEntries()', (name) => {
    const source = sourceOf(name);

    expect(source.length).toBeGreaterThan(0);
    // The entries go in whole. T036a removed the per-field re-map that used to
    // sit between these two calls: it was one identity function copied seven
    // times, and the field it would have dropped is the lifecycle participant.
    expect(source).toMatch(/buildStaticRegistry\(await resolvedManifestEntries\(\)\)/);
  });

  it.each(SCRIPTS)('%s neither imports nor reads bare-core REGISTERED_MANIFESTS', (name) => {
    // Two answers to one question is the defect, and an import left standing is
    // how a later edit reinstates it. The **import** and the **read**, not the
    // spelling: each script's comment cites the name it used to read, and a
    // regex over the bare identifier would forbid saying so.
    const source = sourceOf(name);

    expect(source).not.toMatch(/import\s*\{[^}]*REGISTERED_MANIFESTS/);
    expect(source).not.toMatch(/REGISTERED_MANIFESTS\s*\./);
  });

  it.each(SCRIPTS)('%s does not compose the platform it operates on', (name) => {
    const source = sourceOf(name);

    expect(source).not.toMatch(/composeApp/);
    expect(source).not.toMatch(/from '\.\.\/\.\.\/\.\.\/composition\.js'/);
  });
});

/**
 * The fixture half: the expression the five scripts now contain, over an
 * instance that really has a package installed.
 *
 * `ENDORA_INSTANCE_ROOT` prepends a root, so the scan still reads the chain
 * above the running platform — which is why the fixture ids below are ones no
 * core module claims.
 */
let root: string;

interface FixtureOptions {
  readonly instance: string;
  readonly name: string;
  readonly id: string;
}

function writePackage(options: FixtureOptions): void {
  const dir = join(root, options.instance, 'node_modules', ...options.name.split('/'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({
      name: options.name,
      version: '1.0.0',
      type: 'module',
      endora: { type: 'module', id: options.id, platform: '0.x' },
      exports: {
        '.': './dist/manifest.js',
        './backend': './dist/backend.js',
        './package.json': './package.json',
      },
    })}\n`,
  );
  writeFileSync(
    join(dir, 'dist', 'manifest.js'),
    `export const manifest = ${JSON.stringify({
      id: options.id,
      name: options.name,
      version: '1.0.0',
      dependencies: [],
    })};\nexport default manifest;\n`,
  );
  writeFileSync(join(dir, 'dist', 'backend.js'), 'export function registerModule() {}\n');
}

const envFor = (instance: string): NodeJS.ProcessEnv =>
  ({ ENDORA_INSTANCE_ROOT: join(root, instance) }) as NodeJS.ProcessEnv;

/** Exactly the mapping the five scripts hand `buildStaticRegistry`. */
const registryFrom = (
  entries: Awaited<ReturnType<typeof resolvedManifestEntries>>,
): ReturnType<typeof buildStaticRegistry> =>
  buildStaticRegistry(
    entries.map((e) => ({
      manifest: e.manifest,
      filePath: e.filePath,
      ...(e.installHook ? { installHook: e.installHook } : {}),
      ...(e.uninstallHook ? { uninstallHook: e.uninstallHook } : {}),
    })),
  );

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'endora-module-cli-registry-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the registry a module: command builds, over a real installed package', () => {
  it('knows a package module id, so `module:install <id>` is no longer "unknown module"', async () => {
    writePackage({
      instance: 'one',
      name: '@vendor/mod-fixture-cli',
      id: 'fixture_cli_package',
    });

    const registry = registryFrom(await resolvedManifestEntries(envFor('one')));

    expect(registry.modules.has('fixture_cli_package')).toBe(true);
    // …and core is still there. The resolved set is a superset of bare core, so
    // widening the CLI's population takes nothing away from it.
    expect(registry.modules.has('_lifecycle')).toBe(true);
  });

  it('refuses two packages claiming one module id, naming both package.json files', async () => {
    // The refusal that was "wired where a package cannot reach it". It is not
    // `buildStaticRegistry`'s duplicate throw — `resolvedManifestEntries` keys a
    // `Map` by id, so a duplicate never reaches that far — it is the collision
    // check inside the resolver, which is strictly stronger: it still holds both
    // vendors and can name them. A `module:*` command maps this to exit 65, the
    // code its header already reserves for `duplicate-id`.
    writePackage({ instance: 'two', name: '@vendor/mod-alpha', id: 'fixture_cli_clash' });
    writePackage({ instance: 'two', name: '@vendor/mod-beta', id: 'fixture_cli_clash' });

    const failure = await resolvedManifestEntries(envFor('two')).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(ModuleIdCollisionError);
    expect((failure as Error).message).toContain('@vendor/mod-alpha');
    expect((failure as Error).message).toContain('@vendor/mod-beta');
  });
});
