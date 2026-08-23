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
  /** The workspace module package's directory and npm name. */
  readonly workspacePackage: { readonly dir: string; readonly name: string; readonly id: string };
  /** The installed module package's directory and npm name. */
  readonly installedPackage: { readonly dir: string; readonly name: string; readonly id: string };
  cleanup: () => void;
}

const WORKSPACE_NAME = '@endora-commerce/mod-alpha';
const INSTALLED_NAME = '@vendor/mod-beta';

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

  const workspaceDir = join(root, 'packages', 'modules', 'alpha');
  writeModulePackage(workspaceDir, WORKSPACE_NAME, 'alpha', 'AlphaThing');

  // Installed, not declared: no glob reaches `node_modules`, so the workspace
  // derivation never names it and its real path stays under `node_modules`.
  const installedDir = join(root, 'node_modules', '@vendor', 'mod-beta');
  writeModulePackage(installedDir, INSTALLED_NAME, 'beta', 'BetaThing');

  return {
    root,
    backendSrc: join(root, 'backend', 'src'),
    workspacePackage: { dir: workspaceDir, name: WORKSPACE_NAME, id: 'alpha' },
    installedPackage: { dir: installedDir, name: INSTALLED_NAME, id: 'beta' },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
