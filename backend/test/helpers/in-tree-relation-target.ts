import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The fixture tree the rule-A proofs resolve their relation target inside. */
const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/relation-target/', import.meta.url));

export interface InTreeRelationTarget {
  /** The owning module's id, as `ownerOf` reads it out of the target's path. */
  readonly module: string;
  /** A specifier relative to a file under `<fixture>/src/modules/<other>/entities/`. */
  readonly specifier: string;
  /** The exported class name. */
  readonly name: string;
  /**
   * The path a proof gives `analyzeSource` as the **importing** file.
   *
   * `<relative>` is `<moduleId>/<path under that module>`, so
   * `sourceFile('search/entities/search-phrase-record.entity.ts')` reads as
   * `search` to `ownerOf` and sits one directory structure away from the target,
   * which is what makes {@link InTreeRelationTarget.specifier} resolve.
   */
  readonly sourceFile: (relative: string) => string;
}

/**
 * A relation target rule A really resolves — **out of a fixture tree, not out of
 * the application** (feature 080, T040b).
 *
 * `check-kernel-boundary`'s rule A resolves a relation target through the import
 * that declares it and **skips a specifier that does not resolve to a file on
 * disk**, so every red proof of that rule needs a target that exists and a
 * source path `ownerOf` attributes to some module. Both facts are about paths;
 * neither reader ever opens the target file, which is why the target need not be
 * — and here deliberately is not — a decorated entity.
 *
 * ## Why it left the application tree
 *
 * Two spellings preceded this one and both had the same expiry date. The proofs
 * named `catalog/entities/category.entity.js` until batch six packaged
 * `catalog`, at which point four fixtures in `test/unit/kernel/boundary-check.test.ts`
 * and one red proof in `test/unit/scripts/check-inventory.test.ts` went green —
 * issue #113's shape, a check's own evidence of redness quietly ceasing to be
 * evidence. The repair derived the id instead, by asking which module under
 * `backend/src/modules` declared an entity, and its own comment recorded the
 * cost of that choice: *"writing a different module id would buy one batch"*.
 * It bought two. `_i18n` was the last module in the application tree that owned
 * an entity, and the day T040b packaged it the derivation threw — not "the
 * proofs are weaker" but "the two files cannot be imported at all".
 *
 * A population that shrinks with the sweep is the wrong population for a proof
 * about a **resolver**. So the tree is `backend/test/fixtures/relation-target/`,
 * which no layout move touches, and the answer is a constant rather than a
 * search. It stays in one helper rather than two literals for the reason it
 * always did: two derivations of one fact are two answers waiting to disagree.
 *
 * **An absent fixture throws**, for the reason the derived version threw on an
 * empty answer: a target the resolver skips makes five red proofs pass over an
 * analysis that found nothing to analyse.
 */
export function inTreeRelationTarget(): InTreeRelationTarget {
  const module = 'catalog';
  const file = 'category.entity.ts';
  const target = join(FIXTURE_ROOT, 'src/modules', module, 'entities', file);
  if (!existsSync(target)) {
    throw new Error(
      `[in-tree-relation-target] ${target} does not exist, so check-kernel-boundary's rule-A ` +
        'fixtures have no on-disk relation target: the resolver skips a specifier that does ' +
        'not resolve, and every proof resting on it would pass vacuously.',
    );
  }
  return {
    module,
    specifier: `../../${module}/entities/${file.replace(/\.ts$/, '.js')}`,
    name: 'Category',
    sourceFile: (relative: string) => join(FIXTURE_ROOT, 'src/modules', relative),
  };
}
