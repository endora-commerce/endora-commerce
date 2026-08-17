import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * The second half walks the module's own `entities/` directory, which makes
 * this an oracle **independent of the generator**: comparing the two catches a
 * walk that silently stopped finding a directory, which comparing the generator
 * to its own output cannot (`overlay:check` sees drift between the renderer and
 * the committed file, and a broken renderer that is regenerated and committed
 * moves both together).
 *
 * node:fs + regex only, like `fk-graph.ts`: a test-tree artifact with no
 * runtime path.
 */

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '../../src');

/** The decorator the generator keys on, assembled so this file is not its own match. */
const ENTITY_DECORATOR = new RegExp(`@${'Entity'}\\s*\\(`);

/** Class names the generated registry imports from `src/modules/<id>/`. */
export function registeredEntityNamesFor(moduleId: string): string[] {
  const registry = readFileSync(join(srcRoot, 'db/entities-registry.generated.ts'), 'utf8');
  const pattern = /import \{ (\w+) \} from '([^']+)';/g;
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(registry)) !== null) {
    const [, name, specifier] = match;
    if (name && specifier?.includes(`modules/${moduleId}/`)) names.push(name);
  }
  return names.sort();
}

/** Class names carrying the ORM entity decorator under `src/modules/<id>/entities/`. */
export function declaredEntityNamesFor(moduleId: string): string[] {
  const dir = join(srcRoot, 'modules', moduleId, 'entities');
  if (!existsSync(dir)) return [];
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

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}
