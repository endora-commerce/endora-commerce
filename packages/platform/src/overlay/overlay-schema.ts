/**
 * An overlay module's schema, read the way an installed package's is
 * (`specs/190-overlay-full-modules/` FR-030 – FR-033, contract
 * `overlay-schema-discovery.md` §1, #1850; D-297).
 *
 * The counterpart of `packageSchemaContributionsUnder`
 * (`../packages/package-runtime.ts`), and it produces the same fields under the
 * same names so `configuredMigrationsFrom` and `configuredEntitiesFrom` merge
 * both through one code path. Where the two differ it is because an overlay is a
 * directory an author edits rather than an artefact a build published:
 *
 * - **Entities** come off `backend.{js,ts}`' `entities` export, read with the
 *   package reader's rules (absent → none; not an array → `entities-not-array`;
 *   an entry that is not a class → `entity-not-class`). And every class under the
 *   module's `entities/` that carries MikroORM entity metadata must be in that
 *   export (`overlay-entity-unexported`): a class with no registration fails at
 *   its first query, far from the cause (research R-6).
 * - **Migrations** are the `migrations/` directory, read **file by file** — no
 *   barrel, because a barrel is a second hand-maintained list and a forgotten
 *   entry is a migration that silently never runs (R-5). Each runtime unit
 *   exports exactly one class, named as its filename derives
 *   (`naming-convention.md` §1 – §2), or it is refused (`migration-file-shape`).
 *   Entries carry `origin: 'overlay'` (R-7), which is what the foreign-schema
 *   guard, the test template digest and the diagnostics read.
 * - **The manifest** answers `version`, `dependencies` and
 *   `activation.nonDeactivatable`.
 *
 * It used to refuse all of this instead (D-106, retired for overlays by D-297):
 * the three functions that did lived here, and FR-037 deleted them in the change
 * that made the schema run.
 */
import { readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MetadataStorage } from '@mikro-orm/core';

import type { EntityClassLike, MigrationRegistryEntry } from '../packages/package-runtime.js';
import { SchemaExtensionInvalidError } from '../kernel/schema-extensions/errors.js';
import {
  EXTENSIBLE_HOSTS,
  type ExtensibleHostSet,
} from '../kernel/schema-extensions/extensible-hosts.js';
import type { ColumnExtension } from '../kernel/schema-extensions/types.js';
import {
  dependencyClosureOf,
  validateDeclarationContext,
} from '../kernel/schema-extensions/validate.js';
import { activeOverlayModulesRoot } from './deployment-roots.js';
import { OverlayBuildError } from './overlay-freshness.js';
import { assertOverlayLayout, OverlayLayoutError } from './overlay-layout.js';
import { resolveOverlayUnit } from './overlay-runtime.js';
import { listOverlayModuleDirs } from './resolve-overlay.js';

/** What one overlay module contributes to the platform's schema (`data-model.md` §1). */
export interface OverlaySchemaContribution {
  /** The module id — its directory name, which is also its manifest id. */
  readonly id: string;
  /**
   * `overlay apps/<deployment>/modules/<id>` — what a diagnostic prints where a
   * package's prints its npm name (R-7).
   */
  readonly source: string;
  readonly version: string;
  /** The module's `migrations/` directory, or `null` when it has none — for the test template digest. */
  readonly migrationsDirectory: string | null;
  /** Registry entries, tagged `origin: 'overlay'`. */
  readonly migrations: readonly MigrationRegistryEntry[];
  /** The entity classes `backend`'s `entities` export declares. */
  readonly entities: readonly EntityClassLike[];
  /** The manifest's `dependencies` — the edges its migrations are ordered by. */
  readonly dependencies: readonly string[];
  /** The manifest's `activation.nonDeactivatable`. */
  readonly nonDeactivatable: boolean;
  /** The `schemaExtensions` export, held to V9 – V11 with the overlay as the declaring module. */
  readonly schemaExtensions: readonly ColumnExtension[];
  /**
   * The manifest's `extends` (`specs/187-side-table-extensions/` FR-001, OR-5),
   * unvalidated: judged by the migration merge exactly as a package's are.
   */
  readonly entityExtensions?: readonly unknown[];
}

/** The refusals of `overlay-schema-discovery.md` §1. */
export type OverlaySchemaVerdict =
  | 'entities-not-array'
  | 'entity-not-class'
  | 'migration-file-shape'
  | 'overlay-entity-unexported';

/**
 * A refusal of an overlay module's schema — a class of its own, so an entry
 * point can tell an answer written for the operator from a defect, and print
 * the first as a sentence and the second with its stack ({@link exitOnRefusal}).
 */
export class OverlaySchemaError extends Error {
  override readonly name = 'OverlaySchemaError';

  constructor(
    readonly verdict: OverlaySchemaVerdict,
    readonly moduleId: string,
    message: string,
  ) {
    super(message);
  }
}

/** What {@link overlaySchemaContributionsUnder} may be told beyond the root. */
export interface OverlaySchemaOptions {
  /** The host set V10 looks a declaration's owner up in; the full derived list by default. */
  readonly extensibleHosts?: ExtensibleHostSet;
  /**
   * The edges of every module composed beside this root's overlays — core and
   * the installed packages — so V10's dependency closure is walked over the
   * composed graph (`specs/190-overlay-full-modules/` FR-065, contract
   * `overlay-schema-discovery.md` §5): an overlay that depends on `customers`
   * reaches `organizations` through it. An overlay id here is ignored; the
   * overlay's own manifest answers for it. Absent, a dependency outside the root
   * is a direct edge only, which is the package reader's answer.
   */
  readonly composedDependencies?: ReadonlyMap<string, readonly string[]>;
  /**
   * `false` reads the declarations without holding them to V9 – V11 and
   * contributes none: for a reader that consumes only the entities and cannot
   * see the composed graph, which must not refuse what the migration merge —
   * the one consumer of the declarations — accepts. `true` by default.
   */
  readonly schemaExtensions?: boolean;
}

/** `naming-convention.md` §1, for either spelling a unit has: the source and the compiled twin. */
const MIGRATION_UNIT_RE = /^(\d{8}T\d{6})_([a-z0-9_]+)\.(?:ts|js)$/;

/** `naming-convention.md` §2 — the class name `mikro_orm_migrations` persists. */
function migrationClassNameFor(filename: string): string | null {
  const match = MIGRATION_UNIT_RE.exec(filename);
  if (!match) return null;
  const tail = match[2]!
    .split('_')
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
  return `Migration${match[1]!}${tail}`;
}

/**
 * Whether a file is a runtime unit: `.js` in a compiled tree, `.ts` under `tsx`
 * and `vitest`. A declaration file, a source map and a test are not.
 */
function isRuntimeUnit(name: string): boolean {
  if (name.endsWith('.d.ts') || name.endsWith('.map')) return false;
  if (/\.(?:test|spec)\.[jt]s$/.test(name)) return false;
  return name.endsWith('.js') || name.endsWith('.ts');
}

/**
 * The runtime units of `dir`, sorted, one per stem — the compiled spelling when
 * both are there, for `resolveOverlayUnit`'s reason: in a compiled tree, picking
 * up a stray source file would be the wrong answer.
 */
function runtimeUnitsIn(dir: string, recursive: boolean): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const byStem = new Map<string, string>();
  const nested: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive && entry.name !== 'node_modules') nested.push(...runtimeUnitsIn(path, true));
      continue;
    }
    if (!entry.isFile() || !isRuntimeUnit(entry.name)) continue;
    const stem = entry.name.slice(0, -3);
    if (!byStem.has(stem) || entry.name.endsWith('.js')) byStem.set(stem, path);
  }
  return [...byStem.values(), ...nested].sort();
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

async function importUnit(path: string): Promise<Record<string, unknown>> {
  return (await import(pathToFileURL(path).href)) as Record<string, unknown>;
}

function isConstructor(value: unknown): value is EntityClassLike {
  return typeof value === 'function';
}

/**
 * Whether MikroORM's metadata storage holds `value` as a class it was told to
 * map — the entity or embeddable decorator sets `meta.class` on the class's own
 * metadata (MikroORM 7, legacy decorators). A property decorator alone leaves
 * metadata without it, and an undecorated subclass inherits none of its own.
 */
function carriesEntityMetadata(value: unknown): value is EntityClassLike {
  if (typeof value !== 'function' || !Object.hasOwn(value, MetadataStorage.META_SYMBOL)) return false;
  const meta = (value as unknown as Record<symbol, { class?: unknown } | undefined>)[
    MetadataStorage.META_SYMBOL
  ];
  return meta?.class === value;
}

/** `overlay apps/<deployment>/modules/<id>`, from the modules root the module was found under. */
function sourceLabel(root: string, id: string): string {
  const deploymentRoot = dirname(dirname(dirname(root)));
  return `overlay ${relative(deploymentRoot, join(root, id)).split(sep).join('/')}`;
}

function entitiesFrom(
  id: string,
  source: string,
  backend: Record<string, unknown> | null,
  path: string | null,
): EntityClassLike[] {
  const declared = backend?.['entities'];
  if (declared === undefined) return [];
  if (!Array.isArray(declared)) {
    throw new OverlaySchemaError(
      'entities-not-array',
      id,
      `[overlay] ${String(path)} of ${source} exports 'entities' that is not an array. It is the ` +
        `list of entity classes the ORM registers for this module.`,
    );
  }
  return declared.map((entry: unknown, index) => {
    if (!isConstructor(entry)) {
      throw new OverlaySchemaError(
        'entity-not-class',
        id,
        `[overlay] entry ${String(index)} of the 'entities' export of ${source} ` +
          `(${String(path)}) is not a class.`,
      );
    }
    return entry;
  });
}

async function migrationsFrom(
  id: string,
  source: string,
  directory: string,
): Promise<MigrationRegistryEntry[]> {
  const entries: MigrationRegistryEntry[] = [];
  for (const file of runtimeUnitsIn(directory, false)) {
    const refuse = (found: string): never => {
      throw new OverlaySchemaError(
        'migration-file-shape',
        id,
        `[overlay] ${file} of ${source} ${found}. Every runtime unit in an overlay module's ` +
          `migrations/ directory is one migration: named <YYYYMMDDTHHmmss>_<module-segment>_<slug> ` +
          `(\`endora new migration\` writes one), exporting exactly one class whose name the ` +
          `filename derives. mikro_orm_migrations persists that class name, and a file read any ` +
          `other way would be a migration that silently never runs.`,
      );
    };
    const expected = migrationClassNameFor(basename(file)) ?? refuse('is not named like a migration');
    const classes = Object.entries(await importUnit(file))
      .filter(([, value]) => typeof value === 'function')
      .map(([, value]) => value as MigrationRegistryEntry['cls']);
    if (classes.length === 0) refuse(`exports no class; '${expected}' was expected`);
    if (classes.length > 1) {
      refuse(
        `exports ${String(classes.length)} classes ` +
          `(${classes.map((cls) => cls.name).sort().join(', ')}); exactly one, '${expected}', ` +
          `was expected`,
      );
    }
    const cls = classes[0]!;
    if (cls.name !== expected) refuse(`exports '${cls.name}', and its filename derives '${expected}'`);
    entries.push({ moduleId: id, cls, origin: 'overlay' });
  }
  return entries;
}

async function assertEntitiesExported(
  id: string,
  source: string,
  moduleDir: string,
  exported: readonly EntityClassLike[],
): Promise<void> {
  const declared = new Set<unknown>(exported);
  const missing: string[] = [];
  for (const file of runtimeUnitsIn(join(moduleDir, 'entities'), true)) {
    for (const [name, value] of Object.entries(await importUnit(file))) {
      if (carriesEntityMetadata(value) && !declared.has(value)) {
        missing.push(`  - ${value.name} (export '${name}' of ${file})`);
      }
    }
  }
  if (missing.length === 0) return;
  throw new OverlaySchemaError(
    'overlay-entity-unexported',
    id,
    `[overlay] ${source} declares entity classes its backend's 'entities' export does not name:\n` +
      `${missing.join('\n')}\n` +
      `The ORM registers exactly that export, so these would map no table and fail at their ` +
      `first query. Add each to 'entities' in the module's backend entry point.`,
  );
}

interface OverlayManifestShape {
  readonly version?: unknown;
  readonly dependencies?: unknown;
  readonly activation?: { readonly nonDeactivatable?: unknown };
  readonly extends?: unknown;
}

/**
 * Every overlay module's schema contribution under one modules root, in id
 * order. `null` — no deployment, or one with no overlay directory — is `[]`, so
 * bare core is unchanged (FR-035).
 */
export async function overlaySchemaContributionsUnder(
  root: string | null,
  ids: readonly string[],
  options: OverlaySchemaOptions = {},
): Promise<OverlaySchemaContribution[]> {
  if (root === null) return [];
  const out: OverlaySchemaContribution[] = [];
  const declaredBy: (readonly unknown[])[] = [];
  for (const id of [...ids].sort()) {
    const moduleDir = join(root, id);
    const source = sourceLabel(root, id);
    const manifestPath = resolveOverlayUnit(moduleDir, 'manifest');
    const manifest =
      manifestPath === null
        ? undefined
        : ((await importUnit(manifestPath))['manifest'] as OverlayManifestShape | undefined);
    const backendPath = resolveOverlayUnit(moduleDir, 'backend');
    const backend = backendPath === null ? null : await importUnit(backendPath);
    const entities = entitiesFrom(id, source, backend, backendPath);
    const migrationsDirectory = join(moduleDir, 'migrations');
    const hasMigrations = isDirectory(migrationsDirectory);
    const migrations = hasMigrations ? await migrationsFrom(id, source, migrationsDirectory) : [];
    await assertEntitiesExported(id, source, moduleDir, entities);
    const declarations: unknown = backend?.['schemaExtensions'] ?? [];
    if (!Array.isArray(declarations)) {
      throw new SchemaExtensionInvalidError(
        'not-a-declaration',
        id,
        null,
        `${String(backendPath)} of ${source} exports 'schemaExtensions' that is not an array of ` +
          `defineColumnExtension declarations.`,
      );
    }
    if (manifest === undefined) {
      // No manifest is the manifests seam's refusal (`overlayModuleManifestsUnder`), which
      // names both spellings; with no schema here there is nothing for this reader to add.
      if (entities.length === 0 && migrations.length === 0 && declarations.length === 0) continue;
      throw new Error(
        `[overlay] ${source} ships schema and no manifest, so it has no version and no ` +
          `dependencies to order its migrations by. Add ${join(moduleDir, 'manifest.ts')}.`,
      );
    }
    declaredBy.push(declarations);
    out.push({
      id,
      source,
      version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
      migrationsDirectory: hasMigrations ? migrationsDirectory : null,
      migrations,
      entities,
      dependencies: Array.isArray(manifest.dependencies) ? (manifest.dependencies as string[]) : [],
      nonDeactivatable: manifest.activation?.nonDeactivatable === true,
      schemaExtensions: [],
      entityExtensions: Array.isArray(manifest.extends) ? (manifest.extends as unknown[]) : [],
    });
  }

  // V9 – V11 with the overlay as the declaring module, once every manifest is known
  // (contract §5): the closure is walked over the composed graph — the overlays of
  // this root over whatever edges the caller knows for the modules beside them.
  if (options.schemaExtensions === false) return out;
  const graph = new Map<string, readonly string[]>(options.composedDependencies ?? []);
  for (const contribution of out) graph.set(contribution.id, contribution.dependencies);
  const hosts = options.extensibleHosts ?? EXTENSIBLE_HOSTS;
  return out.map((contribution, index) => {
    const declarations = declaredBy[index]!;
    if (declarations.length === 0) return contribution;
    return {
      ...contribution,
      schemaExtensions: validateDeclarationContext(declarations, {
        hosts,
        packageModuleId: contribution.id,
        dependencyClosure: dependencyClosureOf(contribution.id, graph),
        source: contribution.source,
      }),
    };
  });
}

/**
 * {@link overlaySchemaContributionsUnder} over the active deployment under
 * `deploymentRoot` — the directory holding `apps/`, which only the application
 * can supply. No root, `DEPLOYMENT` unset, or a deployment with no overlay
 * directory is `[]`.
 *
 * The layout is judged first (FR-002 – FR-003), as `overlayModuleIdsUnder` judges
 * it for composition, so a nested module or a package in disguise is refused
 * before anything under it is imported.
 */
export async function discoverOverlaySchema(
  deploymentRoot: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  options: OverlaySchemaOptions = {},
): Promise<OverlaySchemaContribution[]> {
  if (deploymentRoot === undefined) return [];
  const root = activeOverlayModulesRoot(deploymentRoot, env);
  if (root === null) return [];
  const ids = listOverlayModuleDirs(root);
  assertOverlayLayout(root, ids);
  return overlaySchemaContributionsUnder(root, ids, options);
}

/**
 * `.catch(exitOnRefusal)` on an entry point's composition: a refusal is printed
 * as its message and the process exits 1; anything else is thrown again,
 * untouched, so a defect still arrives with its stack.
 *
 * The API and the worker of a scaffolded instance compose with a top-level
 * `await`, and a throw there is an uncaught exception: Node prints the throwing
 * line of this package's compiled source, then the message, then fifteen frames
 * of the platform's internals. The sentence the operator needs was in the
 * middle of that. A `.catch()` method on the entry promise is where an entry
 * point turns a throw into an exit code (`cli/dispatch.ts`' own reasoning).
 */
export function exitOnRefusal(
  error: unknown,
  err: (text: string) => void = (text) => void process.stderr.write(text),
): never {
  // The overlay refusal family: the schema refusals (FR-030 – FR-032), the layout
  // (FR-002 – FR-003) and the build's freshness (FR-015) — each a sentence the
  // operator acts on, never a stack.
  if (
    !(error instanceof OverlaySchemaError) &&
    !(error instanceof OverlayLayoutError) &&
    !(error instanceof OverlayBuildError)
  ) {
    throw error;
  }
  err(`${error.message}\n`);
  process.exit(1);
}
