/**
 * `endora new module`, run inside an **instance**.
 *
 * In a checkout of the platform repository the command writes a module package
 * and has that repository's manifest generator render its `package.json`. An
 * instance has no such generator, and until this file existed the command
 * stopped there, naming `backend/scripts/generate-module-manifests.ts` as
 * missing — so the one tree a client extends had no scaffold at all.
 *
 * What an instance gets is the module kind it composes with no build: an
 * **overlay module** under `apps/<deployment>/modules/<id>/`. Every case below
 * runs over an instance on disk — a workspace file, a deployment tree and a
 * `node_modules` of installed packages — because that is what the command reads
 * (issue #130), and two of them go on to load what was written: the manifest
 * through the contracts package's own validator, and the whole tree through
 * `endora generate`.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { main } from '../src/bin/endora.js';
import { generateFindingsRefusal, runGenerate } from '../src/generate/index.js';
import { runNewModule, type NewModuleOptions } from '../src/new-module/index.js';
import { ScaffoldInputError } from '../src/new-module/spec.js';

const SCOPE = '@endora-commerce';
const CONTRACTS_DIR = fileURLToPath(new URL('../../contracts', import.meta.url));
const scratch: string[] = [];

afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function installModule(root: string, id: string): void {
  const dir = join(root, 'node_modules', SCOPE, `mod-${id}`);
  write(
    join(dir, 'package.json'),
    JSON.stringify({
      name: `${SCOPE}/mod-${id}`,
      version: '1.0.0',
      endora: { type: 'module', id },
      exports: { '.': './dist/manifest.js', './backend': './dist/backend/index.js' },
    }),
  );
  write(join(dir, 'dist', 'manifest.js'), `export const manifest = { id: '${id}' };\n`);
  write(
    join(dir, 'dist', 'backend', 'index.js'),
    `export function registerModule(ctx) {\n    ctx.di.register({ ${id}Service: ctx.asValue(1) });\n}\n`,
  );
}

function installPlatform(root: string): void {
  const dir = join(root, 'node_modules', SCOPE, 'platform');
  write(
    join(dir, 'package.json'),
    JSON.stringify({
      name: `${SCOPE}/platform`,
      version: '1.0.0',
      endora: { type: 'platform' },
      exports: {
        './kernel': { types: './dist/kernel/index.d.ts', default: './dist/kernel/index.js' },
        './composition': './dist/composition/index.js',
      },
    }),
  );
  write(join(dir, 'dist', 'kernel', 'index.js'), 'export {};\n');
  write(
    join(dir, 'dist', 'kernel', 'index.d.ts'),
    "export type { ModuleContext } from './module-context.js';\n",
  );
  write(
    join(dir, 'dist', 'kernel', 'module-context.d.ts'),
    `export interface ModuleContext {
    readonly di: { register(r: Record<string, unknown>): void; decorate(n: string, w: unknown): void };
    cradle<C>(): C;
    routes(register: (app: unknown) => void): void;
    subscribe(event: string, handler: (payload: unknown) => void): void;
}
`,
  );
  write(
    join(dir, 'dist', 'composition', 'index.js'),
    `export function composeApp(options) {\n    const container = createRootContainer();\n` +
      `    registerValues(container, { commandBus: buildCommandBus() });\n    return container;\n}\n`,
  );
}

/** A scaffolded instance, as `endora new instance` and `pnpm install` leave it. */
function instance(
  options: {
    env?: string | null;
    deployments?: readonly string[];
    contracts?: boolean;
    modules?: readonly string[];
  } = {},
): string {
  const root = mkdtempSync(join(tmpdir(), 'overlay-module-'));
  scratch.push(root);
  write(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - backend\n');
  write(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'acme-shop',
      private: true,
      dependencies: {
        ...(options.contracts === false ? {} : { [`${SCOPE}/contracts`]: '1.0.0' }),
        [`${SCOPE}/platform`]: '^1.0.0',
      },
    }),
  );
  write(join(root, 'backend', 'package.json'), JSON.stringify({ name: 'acme-shop-backend' }));
  for (const deployment of options.deployments ?? ['acme']) {
    write(
      join(root, 'apps', deployment, 'divergence.ts'),
      'export const divergence = { omittedModules: [], decorationOrder: {}, reasons: {} };\n',
    );
    write(join(root, 'apps', deployment, 'modules', '.gitkeep'), '');
  }
  if (options.env !== null) write(join(root, '.env'), options.env ?? 'DEPLOYMENT=acme\n');
  installPlatform(root);
  for (const id of options.modules ?? ['settings', 'auth']) installModule(root, id);
  // The real contracts package, so what the command writes is loaded through
  // the validator a boot would load it through.
  mkdirSync(join(root, 'node_modules', SCOPE), { recursive: true });
  symlinkSync(CONTRACTS_DIR, join(root, 'node_modules', SCOPE, 'contracts'), 'dir');
  return root;
}

const NOTICE: NewModuleOptions = {
  id: 'store_notice',
  name: 'Store notice',
  description: 'A short notice the shop owner writes.',
};

function filesUnder(dir: string, base = dir): readonly string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? filesUnder(join(dir, entry.name), base)
        : [join(dir, entry.name).slice(base.length + 1)],
    )
    .sort();
}

/** A source with its comments removed, for assertions about what the code does. */
function codeOf(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('in an instance, the command writes an overlay module', () => {
  it('writes it under the deployment the instance runs as, and no package manifest', async () => {
    const root = instance();
    const result = await runNewModule({ ...NOTICE, cwd: root });
    const dir = join(root, 'apps', 'acme', 'modules', 'store_notice');
    expect(result.packageDir).toBe(dir);
    expect(result.overlay).toEqual({ deployment: 'acme' });
    expect(filesUnder(dir)).toEqual(['backend.ts', 'i18n/en.json', 'i18n/pl.json', 'manifest.ts']);
    // An overlay module is not a package: nothing renders a `package.json`.
    expect(result.renderedManifests).toEqual([]);
  });

  it('works from any directory inside the instance', async () => {
    const root = instance();
    const result = await runNewModule({ ...NOTICE, cwd: join(root, 'backend') });
    expect(result.packageDir).toBe(join(root, 'apps', 'acme', 'modules', 'store_notice'));
  });

  it('the manifest it writes is one the contracts package accepts', async () => {
    const root = instance();
    const result = await runNewModule({
      ...NOTICE,
      permissions: ['store_notice:read=View the store notice'],
      cwd: root,
    });
    const loaded = (await import(
      pathToFileURL(join(result.packageDir, 'manifest.ts')).href
    )) as {
      manifest: {
        id: string;
        dependencies: readonly string[];
        activation: unknown;
        permissions: ReadonlyArray<{ code: string }>;
        settings: { settings: ReadonlyArray<{ code: string; valueType: string }> };
      };
    };
    expect(loaded.manifest.id).toBe('store_notice');
    // `settings` stores the on/off switch; `auth` owns the admin gate.
    expect(loaded.manifest.dependencies).toEqual(['auth', 'settings']);
    expect(loaded.manifest.activation).toEqual({
      settingCode: 'store_notice.enabled',
      default: true,
    });
    // The switch `activation` points at is a Setting this module declares.
    expect(loaded.manifest.settings.settings).toEqual([
      expect.objectContaining({ code: 'store_notice.enabled', valueType: 'boolean' }),
    ]);
    expect(loaded.manifest.permissions.map((permission) => permission.code)).toEqual([
      'store_notice:read',
    ]);
  });

  it('the backend registers its routes through the gated seam, and gates the admin one', async () => {
    const root = instance();
    const result = await runNewModule({
      ...NOTICE,
      permissions: ['store_notice:read=View the store notice'],
      cwd: root,
    });
    const backend = codeOf(readFileSync(join(result.packageDir, 'backend.ts'), 'utf8'));
    expect(backend).toContain('export function registerModule(ctx: ModuleContext): void');
    expect(backend).toContain('ctx.routes(');
    expect(backend).toContain(`'/api/v1/store-notice'`);
    expect(backend).toContain(`'/api/v1/admin/store-notice'`);
    expect(backend).toContain(`requireAdmin('store_notice:read')`);
    expect(backend).not.toContain('ungatedRoutes');
    // Node strips the types and compiles nothing, so nothing here may need a
    // compiler: no `enum`, no `namespace`, no parameter property.
    expect(backend).not.toMatch(/\benum\b|\bnamespace\b|constructor\s*\(\s*(private|public|readonly)/);
    // The scope is the instance's own, read off its dependency on the platform.
    expect(backend).toContain(`from '${SCOPE}/platform/kernel'`);
  });

  it('with no permission it writes no admin route and asks for no `auth`', async () => {
    const root = instance({ modules: ['settings'] });
    const result = await runNewModule({ ...NOTICE, cwd: root });
    const backend = codeOf(readFileSync(join(result.packageDir, 'backend.ts'), 'utf8'));
    expect(backend).toContain(`'/api/v1/store-notice'`);
    expect(backend).not.toContain('requireAdmin');
    expect(readFileSync(join(result.packageDir, 'manifest.ts'), 'utf8')).not.toContain(`'auth'`);
  });

  it('both bundles carry the permission label, and the same keys', async () => {
    const root = instance();
    const result = await runNewModule({
      ...NOTICE,
      permissions: ['store_notice:read=View the store notice'],
      cwd: root,
    });
    const en = JSON.parse(readFileSync(join(result.packageDir, 'i18n/en.json'), 'utf8')) as Record<string, string>;
    const pl = JSON.parse(readFileSync(join(result.packageDir, 'i18n/pl.json'), 'utf8')) as Record<string, string>;
    expect(en).toEqual({ 'adminRoles.permission.store_notice:read': 'View the store notice' });
    expect(Object.keys(pl)).toEqual(Object.keys(en));
  });

  it('what it writes is a clean divergence report: `generate` has nothing to ask', async () => {
    const root = instance();
    await runNewModule({
      ...NOTICE,
      permissions: ['store_notice:read=View the store notice'],
      cwd: root,
    });
    const generated = await runGenerate({ cwd: root });
    expect(generated.divergence[0]?.overlayModules).toEqual(['store_notice']);
    expect(generateFindingsRefusal(generated)).toBeNull();
  });

  it('a dry run writes nothing and reports the same files', async () => {
    const root = instance();
    const result = await runNewModule({ ...NOTICE, cwd: root, dryRun: true });
    expect(result.files.map((file) => file.path).sort()).toEqual([
      'backend.ts',
      'i18n/en.json',
      'i18n/pl.json',
      'manifest.ts',
    ]);
    expect(existsSync(result.packageDir)).toBe(false);
  });
});

describe('which deployment', () => {
  it('is the one directory under `apps/` when `.env` names none', async () => {
    const root = instance({ env: null });
    const result = await runNewModule({ ...NOTICE, cwd: root });
    expect(result.overlay).toEqual({ deployment: 'acme' });
    // …and the instance would not compose it, so the first step says so.
    expect(result.nextSteps[0]).toContain('DEPLOYMENT=acme');
    expect(result.nextSteps[0]).toContain('.env');
  });

  it('is `DEPLOYMENT` from the instance’s own `.env` when there are several', async () => {
    const root = instance({ env: 'DEPLOYMENT=beta\n', deployments: ['acme', 'beta'] });
    const result = await runNewModule({ ...NOTICE, cwd: root });
    expect(result.overlay).toEqual({ deployment: 'beta' });
    expect(result.nextSteps.join('\n')).not.toContain('DEPLOYMENT=');
  });

  it('refuses to choose between several when `.env` names none', async () => {
    const root = instance({ env: null, deployments: ['acme', 'beta'] });
    const error = await runNewModule({ ...NOTICE, cwd: root }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScaffoldInputError);
    expect((error as Error).message).toContain('acme, beta');
    expect((error as Error).message).toContain('DEPLOYMENT');
  });

  it('refuses a `DEPLOYMENT` that names no directory under `apps/`', async () => {
    const root = instance({ env: 'DEPLOYMENT=gone\n' });
    const error = await runNewModule({ ...NOTICE, cwd: root }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScaffoldInputError);
    expect((error as Error).message).toContain('apps/gone');
  });
});

describe('what an overlay module cannot be is refused before anything is written', () => {
  const refused: ReadonlyArray<readonly [string, Partial<NewModuleOptions>, string]> = [
    ['--entities', { entities: true }, 'no schema'],
    ['--admin', { admin: 'catalog', permissions: ['store_notice:read=View'] }, 'module package'],
    [
      '--action',
      { actions: ['open-notice=/store-notice'], permissions: ['store_notice:read=View'] },
      'admin screen',
    ],
    ['--ports', { ports: true }, 'module package'],
    ['--worker', { worker: true }, 'ctx.worker'],
    ['--subscriber', { subscriber: true }, 'ctx.subscribe'],
    ['--dir', { dir: 'somewhere' }, 'apps/acme/modules'],
    ['--tenant-scope', { tenantScope: 'global' }, 'no schema'],
  ];
  for (const [flag, extra, names] of refused) {
    it(`${flag} — exit 1, naming why`, async () => {
      const root = instance();
      const error = await runNewModule({ ...NOTICE, ...extra, cwd: root }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ScaffoldInputError);
      expect((error as Error).message).toContain(flag);
      expect((error as Error).message).toContain(names);
      expect(existsSync(join(root, 'apps', 'acme', 'modules', 'store_notice'))).toBe(false);
    });
  }

  it('a dependency this instance has not installed', async () => {
    const root = instance();
    const error = await runNewModule({ ...NOTICE, dependencies: ['blog'], cwd: root }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ScaffoldInputError);
    expect((error as Error).message).toContain('"blog"');
    // The root of an instance is a workspace root: without `-w` pnpm 9 refuses
    // (`ERR_PNPM_ADDING_TO_ROOT`), and without `-E` and a version it writes a
    // caret beside packages the scaffold pinned exactly (issue #192).
    expect((error as Error).message).toContain('`pnpm add -w -E <package>@<version>`');
    expect((error as Error).message).not.toContain('`pnpm add <package>`');
  });

  it('a permission, in an instance without `auth`', async () => {
    const root = instance({ modules: ['settings'] });
    const error = await runNewModule({
      ...NOTICE,
      permissions: ['store_notice:read=View'],
      cwd: root,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScaffoldInputError);
    expect((error as Error).message).toContain('"auth"');
  });

  it('an id an installed module package already holds', async () => {
    const root = instance();
    const error = await runNewModule({ ...NOTICE, id: 'auth', cwd: root }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ScaffoldInputError);
    expect((error as Error).message).toContain(`${SCOPE}/mod-auth`);
  });

  it('a directory that is already there', async () => {
    const root = instance();
    await runNewModule({ ...NOTICE, cwd: root });
    const error = await runNewModule({ ...NOTICE, cwd: root }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScaffoldInputError);
    expect((error as Error).message).toContain('exists and is not empty');
  });
});

describe('the next steps are the instance’s own commands', () => {
  it('installs the module, translates it and records the divergence', async () => {
    const root = instance();
    const steps = (
      await runNewModule({
        ...NOTICE,
        permissions: ['store_notice:read=View the store notice'],
        cwd: root,
      })
    ).nextSteps.join('\n');
    expect(steps).toContain('pnpm run module:install store_notice');
    expect(steps).toContain('pnpm run generate');
    expect(steps).toContain('apps/acme/modules/store_notice/i18n/pl.json');
    expect(steps).toContain('/api/v1/store-notice');
    // Nothing of the platform repository's own tooling.
    expect(steps).not.toMatch(/composer:generate|manifests:check|--filter/);
  });

  it('an instance that does not declare the contracts package is told how to', async () => {
    const root = instance({ contracts: false });
    const steps = (await runNewModule({ ...NOTICE, cwd: root })).nextSteps;
    expect(steps[0]).toContain(`pnpm add -w ${SCOPE}/contracts`);
  });

  it('the program prints them, and exits 0', async () => {
    const root = instance();
    const out: string[] = [];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    try {
      const code = await main(
        ['new', 'module', 'store_notice', '--name', 'Store notice', '--description', 'A notice.'],
        root,
      );
      expect(code).toBe(0);
    } finally {
      stdout.mockRestore();
    }
    const printed = out.join('');
    expect(printed).toContain('an overlay module in apps/acme/modules/store_notice');
    expect(printed).toContain('wrote manifest.ts');
    expect(printed).toContain('Next steps, inside this instance');
  });
});
