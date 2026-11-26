/**
 * `endora new migration <moduleId> --name <slug>` — an overlay module's next
 * migration, inside an instance (`specs/190-overlay-full-modules/` T101,
 * FR-056; `contracts/overlay-cli.md` §2).
 *
 * Since D-297 an overlay module may own tables, and the platform reads its
 * `migrations/` directory file by file at runtime: there is no barrel and no
 * registry, so the file this writes is the whole of registering it. What makes
 * it a migration the platform accepts is its **name** — the filename the
 * recognizer reads, the class name derived from it and scoped by the module —
 * and that comes off `../lib/migration-naming.ts`, the code this repository's
 * own `migration:new` uses, so the two cannot come to name one migration two
 * ways.
 *
 * It writes into an **overlay module of the selected deployment** and nowhere
 * else. An installed package's migrations are its author's, shipped in its
 * `./migrations` array; a file written beside them in `node_modules` would be
 * gone at the next install, and one written under `apps/` for a package id
 * would be an overlay claiming a package's identity — refused at boot.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import {
  BASELINE_THROUGH,
  buildMigrationScaffold,
  MIGRATION_FILE_RE,
  nextFreeStamp,
} from '../lib/migration-naming.js';
import { installedModulePackages } from '../lib/module-packages.js';
import { findRepoRoot } from '../new-module/host.js';
import { directoriesUnder, resolveDeployment, resolveOverlayHost } from '../new-module/overlay.js';
import { ScaffoldHostError, ScaffoldInputError } from '../new-module/spec.js';

export interface NewMigrationOptions {
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  readonly cwd: string;
  readonly dryRun?: boolean | undefined;
  /** The clock; a test passes one. */
  readonly now?: Date | undefined;
}

export interface NewMigrationResult {
  readonly deployment: string;
  readonly moduleId: string;
  /** Absolute. */
  readonly path: string;
  /** Relative to the instance root, `/`-separated. */
  readonly shownPath: string;
  readonly filename: string;
  readonly className: string;
  readonly contents: string;
  readonly dryRun: boolean;
  readonly nextSteps: readonly string[];
}

/** The class comment an instance's scaffold carries: nothing to register. */
const INSTANCE_DOC: readonly string[] = [
  'TODO describe the change this migration makes.',
  '',
  'Nothing registers it: the platform reads this module\'s `migrations/` file by',
  'file. The class name is derived from the file name and is what',
  '`mikro_orm_migrations` stores, so rename neither once it has been applied.',
  '',
  'This stamp orders this migration against its own module\'s migrations and',
  'nothing else. A table of another module it references must be that',
  'module\'s, declared in this module\'s manifest `dependencies`; a write to',
  'another module\'s table is refused at `migrate`.',
];

/** The overlay modules of one deployment: the directories holding a manifest. */
function overlayModulesIn(modulesRoot: string): readonly string[] {
  return directoriesUnder(modulesRoot).filter(
    (id) =>
      existsSync(join(modulesRoot, id, 'manifest.ts')) ||
      existsSync(join(modulesRoot, id, 'manifest.js')),
  );
}

/** Every stamp an overlay migration of this deployment already uses. */
function takenStampsIn(modulesRoot: string, ids: readonly string[]): ReadonlySet<string> {
  const taken = new Set<string>();
  for (const id of ids) {
    const dir = join(modulesRoot, id, 'migrations');
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      const match = MIGRATION_FILE_RE.exec(file);
      if (match) taken.add(match[1]!);
    }
  }
  return taken;
}

export async function runNewMigration(options: NewMigrationOptions): Promise<NewMigrationResult> {
  const host = resolveOverlayHost(options.cwd);
  if (host === null) {
    const root = findRepoRoot(options.cwd);
    throw new ScaffoldHostError(
      `${root ?? options.cwd} is not an instance, and \`endora new migration\` writes an ` +
        `overlay module's migration into an instance's \`apps/<deployment>/modules/<id>/\`. In ` +
        `the platform repository the scaffolder is \`pnpm --filter backend run migration:new ` +
        `-- --module <id> --name <slug>\`, which takes an overlay module id too. Nothing is ` +
        `written.`,
    );
  }
  if (options.id === undefined || options.id === '') {
    throw new ScaffoldInputError(
      '`endora new migration` takes the id of the overlay module the migration belongs to: ' +
        '`endora new migration <moduleId> --name <slug>`. Nothing is written.',
    );
  }
  if (options.name === undefined || options.name === '') {
    throw new ScaffoldInputError(
      `\`--name <slug>\` is required: it is the tail of the file name, and of the class name ` +
        `\`mikro_orm_migrations\` stores. Nothing is written.`,
    );
  }

  const { deployment } = resolveDeployment(host);
  const modulesRoot = join(host.root, 'apps', deployment, 'modules');
  const shownRoot = relative(host.root, modulesRoot).split(sep).join('/');
  const overlays = overlayModulesIn(modulesRoot);
  const id = options.id;
  if (!overlays.includes(id)) {
    const holder = installedModulePackages(host.root).find((pkg) => pkg.moduleId === id);
    const known =
      overlays.length === 0
        ? `it holds none`
        : `it holds ${overlays.map((overlay) => `\`${overlay}\``).join(', ')}`;
    throw new ScaffoldInputError(
      (holder === undefined
        ? `"${id}" is not an overlay module of this deployment: no ${shownRoot}/${id}/ holds a ` +
          `manifest (${known}).`
        : `"${id}" is the module id of ${holder.name}, which this instance installed, and an ` +
          `installed package's migrations are its author's — shipped in its \`./migrations\`, ` +
          `not written beside it. This command writes an overlay module's, under ` +
          `${shownRoot}/ (${known}).`) +
        ` \`endora new module <id>\` writes an overlay module. Nothing is written.`,
    );
  }

  let scaffold: ReturnType<typeof buildMigrationScaffold>;
  try {
    const stamp = nextFreeStamp(
      options.now ?? new Date(),
      takenStampsIn(modulesRoot, overlays),
      BASELINE_THROUGH,
    );
    scaffold = buildMigrationScaffold({ moduleId: id, slug: options.name, stamp }, INSTANCE_DOC);
  } catch (error: unknown) {
    throw new ScaffoldInputError(`${error instanceof Error ? error.message : String(error)} Nothing is written.`);
  }

  const path = join(modulesRoot, id, 'migrations', scaffold.filename);
  const shownPath = relative(host.root, path).split(sep).join('/');
  if (existsSync(path)) {
    throw new ScaffoldInputError(`${shownPath} already exists. Nothing is written.`);
  }
  const dryRun = options.dryRun === true;
  if (!dryRun) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, scaffold.contents, 'utf8');
  }

  const nextSteps = [
    `write the change into ${shownPath}'s \`up()\`, and its reversal into \`down()\` — ` +
      `\`pnpm run module:uninstall ${id} --hard\` runs it.`,
    `pnpm run build — compiles it into backend/dist, where the platform reads it.`,
    `pnpm run migrate — applies it, in the order the manifests' \`dependencies\` compute.`,
  ];

  return {
    deployment,
    moduleId: id,
    path,
    shownPath,
    filename: scaffold.filename,
    className: scaffold.className,
    contents: scaffold.contents,
    dryRun,
    nextSteps,
  };
}
