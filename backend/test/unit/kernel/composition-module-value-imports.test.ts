import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { namedSpecifiers, type SpecifierKind } from '../../../scripts/lib/specifiers.js';

/**
 * The production composition root names no module package as a **value**
 * import (`specs/117-instance-bring-up/` FR-030, Phase 0).
 *
 * `specs/110-instance-repository/` T118 moves this file's contribution wiring,
 * ORM boot, request-scope hook, error-envelope options and tenant-context
 * resolution into `@endora-commerce/platform`, where **a platform file may not
 * import a module** (D-52, D-53) — `check:kernel-boundary` and
 * `check:platform-surface` are what say so once the file has moved. Neither can
 * say it while the file is still under `backend/src`: a composition root is
 * explicitly *not* a platform root, so both are silent here by design and the
 * precondition would be discovered mid-split.
 *
 * **A value import does not retire by moving a type**, which is the whole
 * reason this ratchet exists rather than a bullet inside T118. T118's own text
 * names this root's module-package **type** imports and only those; the
 * measurement is 23 imports over 21 packages, of which 19 packages are reached
 * type-only and **two were reached by value** — `promoteAdminActor` from
 * `mod-auth` and `buildErrorTranslationTargets` + `describeErrorCodeCollisions`
 * from `mod-i18n`. Each needed a seam of its own before a line could move.
 *
 * A **type** import is deliberately not a finding here. It is erased at build
 * time, it is T118's stated first commit, and it is FR-031's work — naming both
 * halves in one assertion is how the two come to be confused for one.
 *
 * `mixed-type-specifier` — `import { type A, B }` — counts as a value import,
 * because `B` is one. That is `namedSpecifiers`' own classification and not a
 * second reading of it: the `mod-i18n` import this ratchet was written against
 * was exactly that shape, and a classifier reading the first token would have
 * called it type-only and passed.
 *
 * The subject is the **production** root alone. `backend/test/helpers/test-server.ts`
 * is the harness, it is not moving into the platform, and its value imports of
 * a module are what let a test build a fixture; `harness-parity.test.ts` is
 * where the two roots' divergences are recorded.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const COMPOSITION = join(REPO_ROOT, 'backend', 'src', 'composition.ts');

/** The scope every module package is published under, spelled once. */
const MODULE_PACKAGE_PREFIX = '@endora-commerce/mod-';

/**
 * The specifier kinds that survive to runtime, so a reach in one of them is a
 * reach the platform would really hold. `import-type-node` and
 * `type-only-import` are erased; the other six are not.
 */
const VALUE_KINDS: ReadonlySet<SpecifierKind> = new Set<SpecifierKind>([
  'value-import',
  'mixed-type-specifier',
  're-export',
  'side-effect-import',
  'dynamic-import',
  'require-call',
]);

describe('the production composition root and the module packages', () => {
  const source = readFileSync(COMPOSITION, 'utf8');
  const key = relative(REPO_ROOT, COMPOSITION);
  const specifiers = namedSpecifiers(source, key).filter((specifier) =>
    specifier.text.startsWith(MODULE_PACKAGE_PREFIX),
  );

  it('reads the file it is about', () => {
    // The population is defined by the presence of the thing being checked, so
    // an empty read passes vacuously. `composition.ts` reaches module packages
    // for types by the score and will go on doing so until T118; zero reaches
    // of any kind means the file moved, was renamed, or stopped parsing.
    expect(specifiers.length, `${key} names no ${MODULE_PACKAGE_PREFIX}* specifier at all`)
      .toBeGreaterThan(0);
  });

  it('names no module package as a value import', () => {
    const byValue = specifiers.filter((specifier) => VALUE_KINDS.has(specifier.kind));
    expect(
      byValue.map((specifier) => `${key}:${specifier.line} ${specifier.kind} ` +
        `${specifier.text} (${specifier.bindings.join(', ')})`),
    ).toEqual([]);
  });
});
