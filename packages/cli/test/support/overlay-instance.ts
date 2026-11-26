/**
 * An instance on disk, as `endora new instance` and `pnpm install` leave it —
 * the tree `endora new module` and `endora new migration` read inside one
 * (issue #130): a workspace file, a deployment tree under `apps/`, a `.env`, and
 * a `node_modules` of installed packages with the real contracts package linked
 * in, so what a command writes is loaded through the validator a boot would use.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCOPE = '@endora-commerce';
const CONTRACTS_DIR = fileURLToPath(new URL('../../../contracts', import.meta.url));
const scratch: string[] = [];

/** Removes every instance {@link instance} made; call it from `afterEach`. */
export function cleanInstances(): void {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
}

export function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

export function installModule(root: string, id: string): void {
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
export function instance(
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

