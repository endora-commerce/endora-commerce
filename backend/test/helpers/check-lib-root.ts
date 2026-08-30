import { fileURLToPath } from 'node:url';

/**
 * Where the static-check estate's shared library lives, for the three fixtures
 * that copy it into a synthetic tree.
 *
 * Those fixtures stage a copy of a `check-*.ts` script somewhere under `/tmp`
 * and copy the libraries it imports by relative path beside it, so the copy
 * resolves them the way the real script does. That makes the library's
 * **location** a fact derived about the fixtures rather than written in them,
 * and `specs/089-endora-cli-module-scaffold/`'s Phase 2 moved it: the files at
 * `backend/scripts/lib/` are now re-export shims naming
 * `@endora-commerce/cli/lib/<name>.js`, a bare specifier that resolves from this
 * checkout and from nowhere under `/tmp`. Copying a shim therefore kills the
 * fixture run at module resolution, and every exit code it asserts reads as 1 —
 * which is a red proof passing for the wrong reason, or failing for one.
 *
 * So the three fixtures take the answer from here, once. A copy per fixture is
 * three answers waiting to disagree, and the disagreement is invisible: a
 * fixture whose staged tree is broken still exits non-zero.
 */
export const CHECK_LIB_ROOT = fileURLToPath(
  new URL('../../../packages/cli/src/lib/', import.meta.url),
);
