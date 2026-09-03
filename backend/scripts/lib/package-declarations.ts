/**
 * "What do the installed extension packages own?" — the one derivation the
 * owner-map checks share (feature 080, T034).
 *
 * Three checks build an owner map out of `backend/src/modules/**` and answer a
 * question with it: `check-module-boundary` asks who owns a table,
 * `check-port-dependencies` asks who owns a container name, and
 * `check-entity-tenant-classification` asks whether every persisted entity
 * carries exactly one tenant-scope decorator. Since T031 a platform composes
 * modules that are **not** in that tree — an npm package installed into the
 * instance's `node_modules` — and D-106.2 lets such a package ship entities and
 * migrations. Every one of those three maps was therefore derived from a
 * fraction of the platform, and each of them answers a question it cannot
 * answer with silence: no owner, no entity, nothing to report.
 *
 * ## The rule this file exists to enforce: there is no "unattributed package"
 *
 * The obvious failure mode of a package-aware owner map is that it answers *no
 * owner* for something an installed package owns, and every check that consults
 * it then reports clean. That is this repository's most-repeated defect (issue
 * #113 and the seven cases `read-size.ts` lists), and it is why
 * `check-module-boundary` refuses a table→owner map in which either pass
 * resolved nothing.
 *
 * So this file has exactly two answers per installed package, and no third:
 *
 *   * **readable** — its declarations were enumerated in full, and every table,
 *     container name and persisted class it owns is in the map with the
 *     package's module id on it;
 *   * **unreadable** — something it declares could not be enumerated, which is
 *     reported by name and turns the consulting check's run into **exit 2**.
 *
 * A package that genuinely declares nothing — an admin- or storefront-only
 * module, with no `./backend` and no `./migrations` — is *readable and empty*,
 * which is an attribution rather than a silence: it owns nothing because it
 * publishes nothing to own. That distinction is made from the package's own
 * `exports` map, so it is the package's statement about itself and never this
 * file's guess.
 *
 * ## Why it reads the artefact instead of a source text
 *
 * A published package ships compiled output (D-06). `@Entity(` does not survive
 * into it — the acceptance fixture asserts exactly that on its packed tarball —
 * so a source-text probe of a package's `dist` is a probe that finds nothing and
 * reports clean, which is the defect above wearing a different hat.
 *
 * What survives is the artefact the platform itself composes. So the entity half
 * **imports the package's `./backend` subpath**, exactly as `package-runtime.ts`
 * does at boot, and reads:
 *
 *   * the `entities` export — the array of entity classes a package hands the
 *     host, and the same array T033's merged ORM configuration will consume;
 *   * each class's table name out of MikroORM's decorator metadata, falling back
 *     to the platform's own naming strategy for a class that sets none, because
 *     one ORM with one `PluralizingNamingStrategy` is what will name it;
 *   * each class's tenant-scope classification out of the **runtime registry the
 *     platform reads** (`src/tenancy/org-scoped.decorator.ts`). Read by class
 *     identity, deliberately: a classification recorded in some other copy of
 *     that registry is a classification the global filters never apply, so for
 *     Principle XI's purposes the entity is unclassified and this file says so.
 *
 * The container-name half is static, because a registration is a call inside
 * `registerModule` and calling it would mean executing a stranger's composition
 * to find out what it composes. The caller supplies the analyzer it already owns
 * (`check-port-dependencies.ts`'s), and the artefact is held to one condition: if
 * the import says `registerModule` is a function and the parsed source declares
 * no such name, the file is bundled or re-exported, its registrations are
 * unreadable, and the package is refused rather than credited with zero names.
 *
 * ## What it does not read, and who owns that
 *
 * A package's **migration DDL** is read from the files beside its resolved
 * `./migrations` entry point, as literal `create table` text — the same
 * recognizer `check-module-boundary`'s second owner-map source uses. It is
 * deliberately *not* read through the merged migration registry: that registry
 * is T033's, it does not exist yet, and reaching into `src/db/configured-
 * migrations.ts` for it would couple a static check to an async composition
 * seam. The limit that leaves is stated where it bites: a table a package
 * creates under a name its migration computes rather than writes is invisible
 * here, exactly as it is for a core module's migration.
 *
 * Cost: zero for every checkout and every CI run of this repository, which
 * installs no Endora module package. `discovered === 0` short-circuits before a
 * single file is opened.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { MetadataStorage } from '@mikro-orm/core';
import {
  nodeModulesRootsFor,
  scanNodeModulesRoots,
  type InstalledPackage,
} from '../../src/packages/installed-packages.js';
import { pluralize, toSnakeCase } from '../../src/db/pluralizing-naming-strategy.js';
import { tenantClassifications, type ScopeClass } from '../../src/tenancy/org-scoped.decorator.js';
import { declaredTableNames } from './sql-tables.js';
import type { ReadCoverage } from './read-size.js';

/**
 * The decorator each recorded scope came from.
 *
 * The registry stores the scope, the check reports the decorator, and an author
 * reading a failure needs the name they would have to type.
 */
const DECORATOR_OF_SCOPE: Readonly<Record<ScopeClass, string>> = {
  org: 'OrgScoped',
  customer: 'CustomerScoped',
  global: 'GlobalEntity',
  transitive: 'TransitivelyScoped',
  rule: 'RuleScoped',
};

/** One persisted class an installed package ships. */
export interface PackageEntity {
  /** The module id the package claims — its owner for every map here. */
  readonly moduleId: string;
  readonly packageName: string;
  readonly className: string;
  /** The table the host's ORM will map it to. */
  readonly table: string;
  /** Decorator names recorded for it in the registry the platform reads. */
  readonly classifications: readonly string[];
  /** The resolved `./backend` artefact it was imported from. */
  readonly file: string;
}

/** A table an installed package owns, and which of the two sources named it. */
export interface PackageTable {
  readonly table: string;
  readonly moduleId: string;
  readonly packageName: string;
  readonly source: 'entity' | 'migration';
}

/** A container name an installed package's `registerModule` claims. */
export interface PackageContainerName {
  readonly name: string;
  readonly moduleId: string;
  readonly packageName: string;
  /** `true` for `ctx.di.providePort` — a gate rather than a plain registration. */
  readonly gated: boolean;
}

/** What the caller's own analyzer hands back for one artefact. */
export interface ContainerNameSite {
  readonly name: string;
  readonly gated: boolean;
}

/** A package whose declarations could not be enumerated. Never a silent zero. */
export interface UnreadablePackage {
  readonly packageName: string;
  readonly moduleId: string;
  /** The `package.json` that claimed the module id. */
  readonly at: string;
  /** What could not be read, in the words the failure message uses. */
  readonly reason: string;
}

/** Everything the installed packages declare, plus the ones that would not say. */
export interface PackageDeclarations {
  /** How many installed Endora module packages were found. */
  readonly discovered: number;
  readonly entities: readonly PackageEntity[];
  readonly tables: readonly PackageTable[];
  readonly containerNames: readonly PackageContainerName[];
  readonly unreadable: readonly UnreadablePackage[];
  /** Files this scan opened, for the `read:` line's `files=`. */
  readonly filesRead: number;
}

/** The empty answer, for a checkout that installed no module package. */
export const NO_PACKAGE_DECLARATIONS: PackageDeclarations = {
  discovered: 0,
  entities: [],
  tables: [],
  containerNames: [],
  unreadable: [],
  filesRead: 0,
};

export interface PackageDeclarationOptions {
  /** Defaults to the roots the platform itself reads. */
  readonly roots?: readonly string[];
  /**
   * The caller's registration analyzer, where it has one. Omitted means "this
   * check does not ask who registers what", not "no package registers
   * anything" — a check that does not consult the container-name half cannot
   * be made vacuous by it.
   */
  readonly containerNames?: (source: string, file: string) => readonly ContainerNameSite[];
}

/**
 * The refusal sentence, or `null` when every discovered package was readable.
 *
 * Pure and over the scan record, so a red proof enters where a real run enters
 * (issue #130): a proof that built the message instead would prove the string
 * formatting and leave the predicate — "an unreadable package stops the run" —
 * untested.
 */
export function unreadablePackageReason(scan: PackageDeclarations): string | null {
  if (scan.unreadable.length === 0) return null;
  const named = scan.unreadable
    .map((entry) => `${entry.packageName} (module '${entry.moduleId}'): ${entry.reason}`)
    .join('; ');
  return (
    `${scan.unreadable.length} of the ${scan.discovered} installed module package(s) could not ` +
    `be read, so what they own is in no owner map and every reach into it would report ` +
    `clean — ${named}; refusing to report a vacuous pass`
  );
}

/**
 * The independent corroboration for the `read:` line, or `null` when there is
 * nothing to corroborate.
 *
 * `null` rather than `0/0` on purpose: `readSizeRefusal` refuses an expectation
 * of zero, and a checkout with no package installed has none to make — the
 * derivation is absent, not switched off.
 */
export function packageCoverage(scan: PackageDeclarations): ReadCoverage | null {
  if (scan.discovered === 0) return null;
  return {
    source: 'installed-packages',
    expected: scan.discovered,
    covered: scan.discovered - scan.unreadable.length,
  };
}

/**
 * The CLI half: refuse and exit 2 rather than consult a map that cannot
 * attribute what an installed package owns.
 */
export function refuseUnreadablePackages(prefix: string, scan: PackageDeclarations): void {
  const reason = unreadablePackageReason(scan);
  if (reason === null) return;
  // eslint-disable-next-line no-console -- CLI check: stderr is the interface.
  console.error(`${prefix} ${reason}`);
  process.exit(2);
}

/**
 * One of the package's `exports` subpaths, resolved the way anything in the
 * instance would resolve it.
 *
 * `null` means the package publishes no such subpath, which is an ordinary
 * answer and is what makes "declares nothing" an attribution rather than a
 * guess.
 */
function resolveSubpath(installed: InstalledPackage, subpath: string): string | null {
  const require = createRequire(join(dirname(installed.foundUnder), 'noop.js'));
  try {
    return require.resolve(`${installed.name}/${subpath}`);
  } catch {
    return null;
  }
}

/** Every source file beside a resolved entry point, one directory deep. */
function filesBeside(entry: string): string[] {
  const directory = dirname(entry);
  if (!existsSync(directory)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(js|mjs|cjs|ts)$/.test(name) && !name.endsWith('.d.ts')) {
        out.push(full);
      }
    }
  };
  walk(directory);
  return out;
}

/** The table MikroORM's decorator metadata names, or the strategy's default. */
function tableOf(entity: unknown, className: string): string | null {
  let declared: unknown;
  try {
    declared = (
      MetadataStorage.getMetadataFromDecorator(entity as never) as { tableName?: unknown }
    ).tableName;
  } catch {
    // Narrow by construction: the only thing inside is a metadata lookup, and a
    // class that carries none is the case the caller turns into `unreadable`.
    return null;
  }
  if (typeof declared === 'string' && declared.length > 0) return declared;
  if (className.length === 0) return null;
  // The same derivation `declaredTableNames` applies to a core entity that sets
  // no `tableName`: one ORM, one naming strategy, so a package's class is named
  // by the host's strategy and not by its own.
  return pluralize(toSnakeCase(className));
}

/**
 * Whether the artefact's own source **declares** `registerModule`.
 *
 * Read as AST nodes rather than as text, so a comment naming the function is
 * out of the population by construction — the same reason `check-module-
 * boundary`'s SQL predicate reads literal nodes. The fixture that proves this
 * refusal names `registerModule` in its header comment, and a text probe passed
 * it.
 */
function declaresRegisterModule(source: string, file: string): boolean {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let declared = false;
  const visit = (node: ts.Node): void => {
    if (declared) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'registerModule') declared = true;
    else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'registerModule'
    ) {
      declared = true;
    } else if (ts.isExportSpecifier(node) && node.name.text === 'registerModule') declared = true;
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return declared;
}

/** Decorator names recorded for a class in the registry the platform reads. */
function classificationsOf(entity: unknown): string[] {
  return tenantClassifications()
    .filter((meta) => (meta.target as unknown) === entity)
    .map((meta) => DECORATOR_OF_SCOPE[meta.scope]);
}

interface PackageReadState {
  readonly entities: PackageEntity[];
  readonly tables: PackageTable[];
  readonly containerNames: PackageContainerName[];
  filesRead: number;
}

/**
 * Read one installed package, or say what stopped the read.
 *
 * Every `return` on the failure side names the package and what could not be
 * enumerated; there is deliberately no path that returns a partial answer.
 */
async function readOne(
  installed: InstalledPackage,
  state: PackageReadState,
  options: PackageDeclarationOptions,
): Promise<UnreadablePackage | null> {
  const refuse = (reason: string): UnreadablePackage => ({
    packageName: installed.name,
    moduleId: installed.id,
    at: installed.manifestPath,
    reason,
  });

  const backend = resolveSubpath(installed, 'backend');
  const migrations = resolveSubpath(installed, 'migrations');

  if (backend === null) {
    if (migrations !== null) {
      return refuse(
        'it publishes a "./migrations" subpath and no "./backend" one, so it ships schema ' +
          'whose entity classes nothing can enumerate',
      );
    }
    // Readable and empty: an admin- or storefront-only module owns no table, no
    // container name and no persisted class, by its own `exports` map.
    return null;
  }

  let loaded: Record<string, unknown>;
  try {
    loaded = (await import(pathToFileURL(backend).href)) as Record<string, unknown>;
  } catch (error) {
    return refuse(
      `its "./backend" export at ${backend} could not be imported (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }
  state.filesRead += 1;

  const declaredEntities = loaded['entities'];
  if (declaredEntities === undefined) {
    if (migrations !== null) {
      return refuse(
        'it ships migrations but its "./backend" export declares no `entities`, so no table ' +
          'those migrations create can be attributed and no persisted class of its can be ' +
          'classified',
      );
    }
  } else if (!Array.isArray(declaredEntities)) {
    return refuse('its "./backend" export declares an `entities` that is not an array');
  } else {
    for (const entity of declaredEntities as readonly unknown[]) {
      if (typeof entity !== 'function') {
        return refuse('its `entities` export holds a member that is not a class');
      }
      const className = (entity as { name?: unknown }).name;
      const name = typeof className === 'string' ? className : '';
      const table = tableOf(entity, name);
      if (table === null) {
        return refuse(
          `its \`entities\` export holds ${
            name === '' ? 'an anonymous class' : `'${name}'`
          }, which carries no MikroORM metadata — the host would map it to no table`,
        );
      }
      state.entities.push({
        moduleId: installed.id,
        packageName: installed.name,
        className: name === '' ? '<anonymous>' : name,
        table,
        classifications: classificationsOf(entity),
        file: backend,
      });
      state.tables.push({
        table,
        moduleId: installed.id,
        packageName: installed.name,
        source: 'entity',
      });
    }
  }

  if (options.containerNames !== undefined) {
    const source = readFileSync(backend, 'utf8');
    if (typeof loaded['registerModule'] === 'function' && !declaresRegisterModule(source, backend)) {
      return refuse(
        `its "./backend" export at ${backend} composes a \`registerModule\` its own source ` +
          'does not name — a bundled or re-exported artefact, whose container registrations ' +
          'cannot be read',
      );
    }
    for (const site of options.containerNames(source, backend)) {
      state.containerNames.push({
        name: site.name,
        gated: site.gated,
        moduleId: installed.id,
        packageName: installed.name,
      });
    }
  }

  if (migrations !== null) {
    const files = filesBeside(migrations);
    if (files.length === 0) {
      return refuse(
        `its "./migrations" subpath resolves to ${migrations}, beside which the walk found ` +
          'no source at all — the `create table` half of its schema is unreadable',
      );
    }
    for (const file of files) {
      state.filesRead += 1;
      for (const declaration of declaredTableNames(
        readFileSync(file, 'utf8'),
        file,
        (className) => pluralize(toSnakeCase(className)),
      )) {
        if (declaration.source !== 'migration') continue;
        state.tables.push({
          table: declaration.table,
          moduleId: installed.id,
          packageName: installed.name,
          source: 'migration',
        });
      }
    }
  }

  return null;
}

/**
 * Everything the installed module packages declare.
 *
 * Short-circuits to {@link NO_PACKAGE_DECLARATIONS} when nothing is installed,
 * so a checkout — and every CI run of this repository — pays nothing and every
 * consulting check reports byte-for-byte what it reported before T034.
 */
export async function loadPackageDeclarations(
  options: PackageDeclarationOptions = {},
): Promise<PackageDeclarations> {
  const roots = options.roots ?? nodeModulesRootsFor();
  const found = scanNodeModulesRoots(roots);
  if (found.packages.length === 0) return NO_PACKAGE_DECLARATIONS;

  const state: PackageReadState = {
    entities: [],
    tables: [],
    containerNames: [],
    filesRead: 0,
  };
  const unreadable: UnreadablePackage[] = [];
  for (const installed of found.packages) {
    const refused = await readOne(installed, state, options);
    if (refused !== null) unreadable.push(refused);
  }

  return {
    discovered: found.packages.length,
    entities: state.entities,
    tables: state.tables,
    containerNames: state.containerNames,
    unreadable,
    filesRead: state.filesRead,
  };
}
