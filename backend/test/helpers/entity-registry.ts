import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findRepoRoot } from '../../scripts/lib/module-roots.js';
import { discoverModulePackages } from '../../scripts/lib/module-packages.js';

/**
 * Which module owns each entity the ORM loads, read from the generated registry
 * (issue #73).
 *
 * `src/db/entities-registry.generated.ts` is the one answer to "which entities
 * does this module own" since feature 071's F2 walked the tree for the ORM
 * entity decorator. It exports the classes as one flat `ALL_ENTITIES` array, so
 * the ownership a test wants is in the import specifiers rather than in the
 * values — hence the text read here.
 *
 * The second half walks the module's own directory, which makes this an oracle
 * **independent of the generator**: comparing the two catches a walk that
 * silently stopped finding a directory, which comparing the generator to its
 * own output cannot (`overlay:check` sees drift between the renderer and the
 * committed file, and a broken renderer that is regenerated and committed moves
 * both together).
 *
 * **Both halves used to spell `src/modules/<id>/`** and both stopped working on
 * the day the first module became a package (feature 080, T040b): the registry
 * names it `@endora-commerce/mod-blog/backend`, which holds no `modules/blog/`
 * segment, and its sources are not under `backend/src` at all. The failure was
 * the silent one — `existsSync(dir)` was false and the declaration half
 * returned `[]`, so the two halves agreed on nothing and `module-removal`'s
 * witness would have called every module entity-free. Only `module-entities`'
 * own vacuity guard caught it. So the module's location is **derived** here, the
 * same way every check derives it, and an id nothing can place is a throw rather
 * than an empty list.
 *
 * node:fs + regex only, like `fk-graph.ts`: a test-tree artifact with no
 * runtime path. The derivation it borrows answers *where the module is* and
 * never *which classes are entities*, so the independence above is intact.
 */

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '../../src');
const repoRoot = findRepoRoot(here);

/** The decorator the generator keys on, assembled so this file is not its own match. */
const ENTITY_DECORATOR = new RegExp(`@${'Entity'}\\s*\\(`);

/** `blog` → `@endora-commerce/mod-blog`, for a module that has become a package. */
function packageNameOf(moduleId: string): string | null {
  if (repoRoot === null) return null;
  const pkg = discoverModulePackages(repoRoot).find((entry) => entry.moduleId === moduleId);
  return pkg?.name ?? null;
}

/**
 * The module's own directory — under the application's tree, or the workspace
 * package that declares the id.
 *
 * `null` means "no such module", which every caller turns into a failure. It is
 * deliberately distinguished from "the module is there and owns no entity",
 * which is an empty list: `module-removal.test.ts` asserts exactly that for the
 * module it deletes, so collapsing the two would make that assertion pass for
 * the wrong reason.
 */
function moduleDirectoryOf(moduleId: string): string | null {
  const inApplication = join(srcRoot, 'modules', moduleId);
  if (existsSync(inApplication)) return inApplication;
  if (repoRoot === null) return null;
  const pkg = discoverModulePackages(repoRoot).find((entry) => entry.moduleId === moduleId);
  return pkg?.dir ?? null;
}

/** Class names the generated registry imports from the module that owns them. */
export function registeredEntityNamesFor(moduleId: string): string[] {
  const registry = readFileSync(join(srcRoot, 'db/entities-registry.generated.ts'), 'utf8');
  const pattern = /import \{ (\w+) \} from '([^']+)';/g;
  const packageName = packageNameOf(moduleId);
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(registry)) !== null) {
    const [, name, specifier] = match;
    if (name === undefined || specifier === undefined) continue;
    const application = specifier.includes(`modules/${moduleId}/`);
    const packaged =
      packageName !== null &&
      (specifier === packageName || specifier.startsWith(`${packageName}/`));
    if (application || packaged) names.push(name);
  }
  return names.sort();
}

/** Class names carrying the ORM entity decorator anywhere in the module's own sources. */
export function declaredEntityNamesFor(moduleId: string): string[] {
  const dir = moduleDirectoryOf(moduleId);
  if (dir === null) {
    throw new Error(
      `[entity-registry] no module '${moduleId}' under ${join(srcRoot, 'modules')} and no ` +
        `workspace package declaring that id. Returning an empty list here is how this ` +
        `helper reported every module entity-free when the first one became a package.`,
    );
  }
  const names: string[] = [];
  for (const file of walk(dir)) {
    const source = readFileSync(file, 'utf8');
    const pattern = /export (?:abstract )?class (\w+)/g;
    let previousEnd = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const name = match[1];
      // Everything since the previous class declaration — i.e. this class's own
      // decorators, however many lines each of them runs to.
      const preamble = source.slice(previousEnd, match.index);
      previousEnd = pattern.lastIndex;
      if (name && ENTITY_DECORATOR.test(preamble)) names.push(name);
    }
  }
  return names.sort();
}

/**
 * Every `.ts` source under a module's directory.
 *
 * `dist` is skipped, because a package's build output is the same classes a
 * second time and both halves of the comparison would then count eleven
 * entities as twenty-two.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'dist' || name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) out.push(full);
  }
  return out;
}
