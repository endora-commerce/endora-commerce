import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the application's own module tree lives. */
const BACKEND_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export interface InTreeRelationTarget {
  /** The owning module's id, as `analyzeSource` reads it out of the path. */
  readonly module: string;
  /** A specifier relative to `src/modules/<other>/entities/`. */
  readonly specifier: string;
  /** The exported class name. */
  readonly name: string;
}

/**
 * An entity class that really exists under `backend/src/modules` — **derived,
 * never named** (feature 080, T040b).
 *
 * `check-kernel-boundary`'s rule A resolves a relation target through the import
 * that declares it and **skips a specifier that does not resolve to a file on
 * disk**, so every red proof of that rule needs a target the running tree holds.
 * Both readers spelled `catalog/entities/category.entity.js` until `catalog`
 * became a package, at which point four fixtures in
 * `test/unit/kernel/boundary-check.test.ts` and one red proof in
 * `test/unit/scripts/check-inventory.test.ts` failed with "expected [] to have a
 * length of 1" — a check's own proof of redness going green, which is the shape
 * issue #113 is about.
 *
 * Writing a different module id would buy one batch: what is left in the
 * application tree is `orders`, `payments`, `_i18n` and `_lifecycle`, and every
 * one of them is scheduled to move. It lives in one place rather than two
 * because two derivations of one population are two answers waiting to disagree.
 *
 * **An empty answer throws.** A tree with no in-application entity would
 * otherwise make five red proofs pass over an analysis that found nothing to
 * analyse — the exact failure the proofs exist to refuse.
 */
export function inTreeRelationTarget(): InTreeRelationTarget {
  const modulesRoot = join(BACKEND_ROOT, 'src/modules');
  for (const moduleId of readdirSync(modulesRoot).sort()) {
    const entitiesDir = join(modulesRoot, moduleId, 'entities');
    if (!existsSync(entitiesDir)) continue;
    for (const file of readdirSync(entitiesDir).sort()) {
      if (!file.endsWith('.entity.ts')) continue;
      const declared = /export class (\w+)/.exec(readFileSync(join(entitiesDir, file), 'utf8'))?.[1];
      if (declared === undefined) continue;
      return {
        module: moduleId,
        specifier: `../../${moduleId}/entities/${file.replace(/\.ts$/, '.js')}`,
        name: declared,
      };
    }
  }
  throw new Error(
    '[in-tree-relation-target] no module under backend/src/modules declares an entity, so ' +
      "check-kernel-boundary's rule-A fixtures have no on-disk relation target and would pass " +
      'vacuously. Give them a target the running tree really holds, or move the proofs to a ' +
      'fixture tree of their own.',
  );
}
