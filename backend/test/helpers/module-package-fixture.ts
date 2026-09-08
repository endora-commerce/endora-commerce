import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * A checkout that holds a module in **each** place one can be (feature 080,
 * T041a).
 *
 * The three-way discrimination the composer and `overlay:check` have to make
 * cannot be staged on this repository, because this repository has no module
 * package yet and — by design — will never have an installed one in its own
 * tree. So the fixture is a real directory layout, entered at the top of the
 * analysis:
 *
 *   * the **application's** own module tree, `backend/src/modules/<id>/`;
 *   * a **workspace** module package, declared by `pnpm-workspace.yaml` and by
 *     its own `endora` block — the one D-149 commits to a committed artefact,
 *     with a bare specifier;
 *   * an **installed** module package under `node_modules/`, which is
 *     discovered at runtime (D-119/D-155) and must reach no artefact at all.
 *
 * The last two are deliberately the same shape — a scoped name, an `endora`
 * block, an `exports` map, entities and a migration — so that a check which
 * discriminated them by anything other than where they land would pass one and
 * fail the other for the wrong reason. What separates them is one line of
 * `pnpm-workspace.yaml` and their real path, which is exactly the discriminator
 * `check-overlay-determinism.ts` documents.
 */
export interface ModulePackageFixture {
  /** The checkout root. */
  readonly root: string;
  /** `<root>/backend/src` — where a rendered `db/` artefact would sit. */
  readonly backendSrc: string;
  /** The workspace module package's directory and npm name. Ships source. */
  readonly workspacePackage: { readonly dir: string; readonly name: string; readonly id: string };
  /** The installed module package's directory and npm name. */
  readonly installedPackage: { readonly dir: string; readonly name: string; readonly id: string };
  /**
   * A second **workspace** module package, which ships `dist` — the regime
   * D-164 rules and every real module package is in (feature 080, T040b).
   *
   * It is a third package rather than a change to the first because both
   * regimes have to keep working: the generator's specifier derivation matches
   * a walked source against the `exports` targets, and under D-164 those two
   * disagree by construction — the walk reads `src/**.ts`, the map names
   * `dist/**.js`. A fixture with only one of them proves whichever half is
   * written that day.
   */
  readonly builtPackage: { readonly dir: string; readonly name: string; readonly id: string };
  cleanup: () => void;
}

const WORKSPACE_NAME = '@endora-commerce/mod-alpha';
const INSTALLED_NAME = '@vendor/mod-beta';
const BUILT_NAME = '@endora-commerce/mod-gamma';

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

/** The exports map `module-package-layout.md` §2 specifies, minus the layers a fixture has no use for. */
function packageManifest(name: string, id: string): string {
  return `${JSON.stringify(
    {
      name,
      version: '0.0.0',
      private: true,
      type: 'module',
      endora: { type: 'module', id, platform: '0.x' },
      exports: {
        '.': './src/manifest.ts',
        './backend': './src/backend/index.ts',
        './migrations': './src/migrations/index.ts',
        './package.json': './package.json',
      },
    },
    null,
    2,
  )}\n`;
}

/**
 * The manifest of a package that **builds**: every `exports` target names the
 * emitted file, with a `types` condition beside it, exactly as the real ones do.
 */
function builtPackageManifest(name: string, id: string): string {
  return `${JSON.stringify(
    {
      name,
      version: '0.0.0',
      private: true,
      type: 'module',
      endora: { type: 'module', id, platform: '0.x' },
      exports: {
        '.': { types: './dist/manifest.d.ts', default: './dist/manifest.js' },
        './backend': { types: './dist/backend/index.d.ts', default: './dist/backend/index.js' },
        './migrations': {
          types: './dist/migrations/index.d.ts',
          default: './dist/migrations/index.js',
        },
        './package.json': './package.json',
      },
    },
    null,
    2,
  )}\n`;
}

/**
 * The two-config split every package here uses, and the one this derivation
 * has to follow: `rootDir` is in the build file and `outDir` in the file it
 * extends, so a reader of either alone finds half the answer.
 */
function writeBuildConfigs(dir: string): void {
  write(
    join(dir, 'tsconfig.json'),
    `${JSON.stringify({ compilerOptions: { outDir: './dist', noEmit: true } }, null, 2)}\n`,
  );
  write(
    join(dir, 'tsconfig.build.json'),
    '{\n  // A comment, which JSON.parse cannot take.\n' +
      '  "extends": "./tsconfig.json",\n' +
      '  "compilerOptions": { "rootDir": "./src", "noEmit": false }\n}\n',
  );
}

/** One module package's sources — a manifest, a backend entry, an entity, a migration. */
function writeModulePackage(dir: string, name: string, id: string, className: string): void {
  write(join(dir, 'package.json'), packageManifest(name, id));
  write(
    join(dir, 'src', 'manifest.ts'),
    `export const manifest = defineModuleManifest({ id: '${id}' });\n`,
  );
  write(
    join(dir, 'src', 'backend', 'index.ts'),
    `export function registerModule(): void {}\nexport * from './entities/${id}-thing.entity.js';\n`,
  );
  write(
    join(dir, 'src', 'backend', 'entities', `${id}-thing.entity.ts`),
    `@Entity()\nexport class ${className} {}\n`,
  );
  write(join(dir, 'src', 'migrations', 'index.ts'), `export {};\n`);
  // The class name is derived from the filename by the same rule
  // `contracts/naming-convention.md` §2 states, because the generator checks it
  // and a fixture that failed that check would prove the check rather than the
  // package path.
  const pascalId = id.charAt(0).toUpperCase() + id.slice(1);
  write(
    join(dir, 'src', 'migrations', `20260810T101500_${id}_initial.ts`),
    `export class Migration20260810T101500${pascalId}Initial {}\n`,
  );
}

/** Builds the fixture. The caller owns {@link ModulePackageFixture.cleanup}. */
export function createModulePackageFixture(): ModulePackageFixture {
  const root = mkdtempSync(join(tmpdir(), 'module-package-fixture-'));
  write(
    join(root, 'pnpm-workspace.yaml'),
    'packages:\n  - backend\n  - packages/*\n  - packages/modules/*\n',
  );
  write(join(root, 'package.json'), `${JSON.stringify({ name: 'fixture', private: true })}\n`);
  write(
    join(root, 'backend', 'package.json'),
    `${JSON.stringify({ name: 'backend', private: true, type: 'module' })}\n`,
  );
  mkdirSync(join(root, 'backend', 'src', 'db', 'migrations'), { recursive: true });

  // The host package. It is not a module and is discovered by nothing here —
  // `discoverModulePackages` filters on `endora.type === 'module'` — but a
  // rendered migration registry names it: since
  // `specs/110-instance-repository/` T116 the artefact's type import is
  // `@endora-commerce/platform/db` and a `core` migration's is
  // `@endora-commerce/platform/migrations`. Without a member declaring it, the
  // containment pass reports the host as `foreign`, which is a fact about a
  // fixture missing a workspace member and not about the rule under test.
  write(
    join(root, 'packages', 'platform', 'package.json'),
    `${JSON.stringify(
      {
        name: '@endora-commerce/platform',
        version: '0.0.0',
        type: 'module',
        endora: { type: 'platform' },
        exports: {
          './db': { types: './dist/db/index.d.ts', default: './dist/db/index.js' },
          './migrations': {
            types: './dist/migrations/index.d.ts',
            default: './dist/migrations/index.js',
          },
          './package.json': './package.json',
        },
      },
      null,
      2,
    )}\n`,
  );

  const workspaceDir = join(root, 'packages', 'modules', 'alpha');
  writeModulePackage(workspaceDir, WORKSPACE_NAME, 'alpha', 'AlphaThing');

  // Installed, not declared: no glob reaches `node_modules`, so the workspace
  // derivation never names it and its real path stays under `node_modules`.
  const installedDir = join(root, 'node_modules', '@vendor', 'mod-beta');
  writeModulePackage(installedDir, INSTALLED_NAME, 'beta', 'BetaThing');

  // The `dist`-shipping workspace package. Its sources are written exactly like
  // the source-shipping one's — what differs is its `exports` map and its build
  // configuration, which is the whole of what the derivation reads.
  const builtDir = join(root, 'packages', 'modules', 'gamma');
  writeModulePackage(builtDir, BUILT_NAME, 'gamma', 'GammaThing');
  write(join(builtDir, 'package.json'), builtPackageManifest(BUILT_NAME, 'gamma'));
  writeBuildConfigs(builtDir);

  return {
    root,
    backendSrc: join(root, 'backend', 'src'),
    workspacePackage: { dir: workspaceDir, name: WORKSPACE_NAME, id: 'alpha' },
    installedPackage: { dir: installedDir, name: INSTALLED_NAME, id: 'beta' },
    builtPackage: { dir: builtDir, name: BUILT_NAME, id: 'gamma' },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
