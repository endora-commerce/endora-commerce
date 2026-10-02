/**
 * An overlay module contributes no schema, and a process that would run beside
 * some refuses instead (D-106; `specs/conventions/overlay-modules.md`).
 *
 * ## The defect this was written from
 *
 * The platform reads entities and migrations from installed module
 * **packages** alone. A `migrations/` or `entities/` directory under
 * `apps/<deployment>/modules/<id>/` is therefore not refused by anything that
 * reads schema — it is never looked at. `migrate` applies nothing from it, no
 * table exists, the module composes, and the first report is a query against a
 * relation that is not there. `endora generate` refuses such a tree, and only
 * a run that calls it: an instance that was booted, or whose `module:*`
 * commands were run, without `generate` in between said nothing.
 *
 * ## Where it runs
 *
 * Inside `overlayModuleIdsUnder`, the one derivation both overlay seams share:
 * the registration half a composition root composes and the manifest half
 * `resolveManifestEntries` resolves the registry from. So the API process, the
 * worker, the operator CLI and the five `module:*` commands all stop before a
 * module is composed or a database is opened, and none of them can disagree
 * with another about whether the tree is acceptable.
 *
 * A bare `migrate` is **not** covered. The migrator's configuration is built
 * from the installed packages and is handed no deployment root, so it never
 * reaches this seam; the commands that follow it — `module:install`, the boot —
 * are the ones that refuse.
 *
 * ## The predicates
 *
 * `endora generate`'s own (`packages/cli/src/generate/divergence.ts`), which
 * are the composer generator's in the monorepo: a file under a `migrations/`
 * or `entities/` directory, or a source that declares an entity class.
 * The CLI cannot import this package — it reads an instance without loading
 * it — so the two walks are written twice and must agree. One difference
 * follows from where each runs: a compiled tree spells a decorator as a
 * `__decorate` call, so the third predicate sees an entity only where the
 * overlay is read from source. The two directory predicates hold in both.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** A directory an overlay module may not have, because what it holds is schema. */
const SCHEMA_DIRECTORIES: ReadonlySet<string> = new Set(['migrations', 'entities']);

/**
 * The decorator's opening, as the text scan looks for it — assembled rather
 * than written, and never spelled in this file's prose either. The composer
 * generator finds entities by the same text scan over this package's sources,
 * so a file that merely *mentions* the decorator is read as declaring one and
 * refused for carrying no class below it.
 */
const ENTITY_DECORATOR = `@${'Entity'}(`;

/** The extensions a source carrying an entity class is written in. */
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

/**
 * Every schema file of the overlay modules `ids` under `root`, relative to
 * `root` with `/` separators, sorted.
 */
export function overlaySchemaFilesUnder(root: string, ids: readonly string[]): readonly string[] {
  const found: string[] = [];
  const walk = (dir: string, insideSchemaDirectory: boolean): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(path, insideSchemaDirectory || SCHEMA_DIRECTORIES.has(entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (
        insideSchemaDirectory ||
        (SOURCE_FILE.test(entry.name) && readFileSync(path, 'utf8').includes(ENTITY_DECORATOR))
      ) {
        found.push(relative(root, path).split(sep).join('/'));
      }
    }
  };
  for (const id of ids) walk(join(root, id), false);
  return found.sort();
}

/** Throw, naming each file and the remedy, when an overlay module ships schema. */
export function assertOverlayModulesShipNoSchema(root: string, ids: readonly string[]): void {
  const schema = overlaySchemaFilesUnder(root, ids);
  if (schema.length === 0) return;
  throw new Error(
    `[overlay] an overlay module contributes no schema, and ${String(schema.length)} file(s) ` +
      `under ${root} are schema:\n` +
      `${schema.map((file) => `  - ${join(root, file)}`).join('\n')}\n` +
      `An overlay module contributes settings, routes, registrations, decorations, ` +
      `interceptors, permissions and translations — and no \`${ENTITY_DECORATOR})\` class and no ` +
      `migration. Nothing here would run them: the platform reads entities and migrations ` +
      `from installed module packages alone, so \`migrate\` applies none of these, no table ` +
      `exists, and the module would have been composed over a relation that is not there. ` +
      `Keep small state in Settings (declare it in the module's manifest). A module that owns ` +
      `a table is a module package: move the entity and its migration into one, install it, ` +
      `and read it from this overlay module through that package's port. Nothing was ` +
      `composed and nothing was written.`,
  );
}
