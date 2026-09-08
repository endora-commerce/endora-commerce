/**
 * "Did the migration walk read the migrations this platform has?" — the second
 * independent author on `check:module-boundary`'s `read:` line (feature 097,
 * `contracts/migration-cross-module-sql.md` §5).
 *
 * The module-population floor (`manifest-index`) is satisfied by **any** file a
 * registered module contributes, and a module's backend sources are plentiful.
 * So a `migrations/` walk that stopped resolving — a moved tree, a renamed
 * directory, a root the layout no longer answers with — leaves that floor intact
 * and leaves R1 and R2 judging an empty population, which is `violations=0` over
 * a tree nobody opened (issue #215, and `check:subscribe-seam`'s worker-half
 * reasoning).
 *
 * The independent author is `backend/src/db/migrations-registry.generated.ts`.
 * It is a **second program's** answer to "how many migrations does this platform
 * have": the generator finds them by walking module directories and writes them
 * down as import specifiers and registry entries, while this check finds them by
 * path. A module tree that moved makes the two disagree **in the same run**,
 * which is exactly what `self-reported` cannot do.
 *
 * ## What is reconciled, and why it is the class and not the file
 *
 * The registry names a **class**, imported from a module package's `./migrations`
 * barrel — one specifier for 30-odd files — so the specifier cannot name the
 * file and a specifier-level reconciliation would count 59 barrels against 225
 * walked files. The class *can* be matched: `mikro_orm_migrations` stores the
 * class name, so it is the migration's identity (AGENTS.md § *Migrations*
 * item 5), it is unique across every module the platform can compose
 * (`check:naming`'s `unscoped-name`), and the file that declares it is the file
 * the walk has to have opened.
 *
 * So: **expected** is every class the registry registers for a module, and
 * **covered** is how many of those a walked migration source declares.
 *
 * Core's own migrations (`moduleId === 'core'`, `packages/platform/src/migrations/`)
 * are **excluded from the expectation**, and that is the population and not an
 * exemption: they belong to no module (`declaringOwnerOf` answers `core:db`),
 * they sit under no module walk root, and the rule this floor protects does not
 * judge them (contract §1.1). Including them would make the floor permanently
 * short by twelve.
 *
 * Both halves read **literal AST nodes** rather than source text, for the reason
 * `check-module-boundary`'s own header records: a regex over source text
 * hallucinated a dozen table names off apostrophes in English prose.
 */
import ts from 'typescript';

/** The registry's own spelling of "this migration belongs to no module". */
export const CORE_MIGRATION_OWNER = 'core';

/** One entry the generated migration registry registers. */
export interface RegisteredMigration {
  /** The owning module's id, or {@link CORE_MIGRATION_OWNER}. */
  readonly moduleId: string;
  /** The migration class's name — its identity in `mikro_orm_migrations`. */
  readonly className: string;
}

/** The registry's own helper call: `migration('<id>', ClassName)`. */
const REGISTRY_HELPER = 'migration';

/**
 * Every entry `source` registers, read as call expressions.
 *
 * A call whose first argument is not a string literal, or whose second is not a
 * plain identifier, is **skipped** rather than guessed at — and the caller's
 * refusal is what makes that safe: a registry this function reads nothing out of
 * produces an expectation of zero, which `reportReadSize` refuses as
 * `no-expectation` before it can turn a floor off.
 */
export function registeredMigrations(source: string, file: string): RegisteredMigration[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: RegisteredMigration[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === REGISTRY_HELPER &&
      node.arguments.length === 2
    ) {
      const [owner, cls] = node.arguments;
      if (owner !== undefined && cls !== undefined && ts.isStringLiteral(owner) && ts.isIdentifier(cls)) {
        found.push({ moduleId: owner.text, className: cls.text });
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return found;
}

/**
 * Every migration class `source` declares.
 *
 * Any exported class is read, without a name convention: `check:naming` owns the
 * `Migration<STAMP><Tail>` shape, and a floor that re-derived it here would go
 * short the day that rule is relaxed rather than reporting what it read.
 */
export function declaredMigrationClasses(source: string, file: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name !== undefined) found.push(node.name.text);
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return found;
}

export interface MigrationRegistryCoverage {
  /** Module-owned classes the registry registers. */
  readonly expected: number;
  /** How many of those a walked migration source declares. */
  readonly covered: number;
  /** The classes the walk did not find, for the message. */
  readonly missing: readonly string[];
}

/**
 * The reconciliation, as a pure function over the two derivations.
 *
 * A red proof therefore enters with a registry text and a set of walked class
 * names, which is where a real run enters — never with a ready-made verdict.
 */
export function migrationRegistryCoverage(
  registered: readonly RegisteredMigration[],
  declaredByTheWalk: ReadonlySet<string>,
): MigrationRegistryCoverage {
  const owned = registered.filter((entry) => entry.moduleId !== CORE_MIGRATION_OWNER);
  const missing = owned
    .filter((entry) => !declaredByTheWalk.has(entry.className))
    .map((entry) => entry.className)
    .sort();
  return { expected: owned.length, covered: owned.length - missing.length, missing };
}
