import ts from 'typescript';

/**
 * One parse per source file across the rules of one analysis (issue #910).
 *
 * The estate's recognisers each take `(source, file)` and parse what they are
 * handed — `namedSpecifiers`, `sqlTableAccesses`, `declaredTableNames`,
 * `declaredIndexes`, `declaredMigrationClasses` — which keeps every one of them
 * enterable with plain source text, the property issue #130 asks a red proof
 * for. A check that runs several of them over one tree therefore parsed each
 * file several times: `check:module-boundary` made 14662 `ts.createSourceFile`
 * calls over 3929 files, and the parse was most of its runtime.
 *
 * ## What a scope shares, and what it deliberately does not keep
 *
 * Inside {@link withSharedParses}:
 *
 * - {@link parseSource} hands back the tree it parsed last when it is asked for
 *   the same `(file, source)` again. **One** tree, not one per file: a check
 *   whose rules each walk the whole tree would otherwise hold every tree of the
 *   repository at once, which measured +490 MB on `check:module-boundary` — past
 *   the 900 MB per-check divisor `check-read-size.test.ts` sizes its spawn pool
 *   with. A caller that visits files one at a time and runs every recogniser on
 *   a file before moving to the next gets one parse per file from this alone.
 * - {@link rememberRead} keeps what a recogniser **derived** from a tree — a
 *   specifier list, a set of literals, the tables a builder names — keyed by the
 *   read's name and the `(file, source)` it was derived from. Those answers are
 *   small, so they are kept for the whole scope, and a later rule asking the
 *   same question of the same file gets the answer without a tree.
 *
 * A value kept by {@link rememberRead} must not hold a node: a node holds its
 * tree, and the tree is exactly what this scope refuses to keep.
 *
 * Outside a scope nothing is retained and every call parses, exactly as it did
 * before, so a red proof that hands in source text, a watcher or a long-lived
 * `endora` process never pays for a cache it did not ask for.
 *
 * Sharing is sound because every recogniser parses with the same arguments —
 * `ScriptTarget.Latest`, parent pointers set, the script kind the file name
 * implies — and only reads the tree, and because a hit needs the **same text**
 * as well as the same name: a caller that hands one name two different sources
 * gets two parses and two answers.
 */

interface Remembered {
  readonly source: string;
  readonly reads: Map<string, unknown>;
}

interface Scope {
  last: { readonly file: string; readonly source: string; readonly tree: ts.SourceFile } | null;
  readonly remembered: Map<string, Remembered>;
}

let scope: Scope | null = null;

/** `source`, parsed as `file`, with parent pointers — shared inside a scope. */
export function parseSource(file: string, source: string): ts.SourceFile {
  const last = scope?.last ?? null;
  if (last !== null && last.file === file && last.source === source) return last.tree;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  if (scope !== null) scope.last = { file, source, tree };
  return tree;
}

/**
 * `derive()`'s answer for `(read, file, source)`, computed once per scope.
 *
 * `read` names the question and must be unique to it — prefix it with the
 * recogniser's own module, as `sql-tables:literals` does. Outside a scope this
 * is `derive()`.
 */
export function rememberRead<T>(read: string, file: string, source: string, derive: () => T): T {
  if (scope === null) return derive();
  let entry = scope.remembered.get(file);
  if (entry === undefined || entry.source !== source) {
    entry = { source, reads: new Map() };
    scope.remembered.set(file, entry);
  }
  if (entry.reads.has(read)) return entry.reads.get(read) as T;
  const value = derive();
  entry.reads.set(read, value);
  return value;
}

/**
 * Run `work` with {@link parseSource} and {@link rememberRead} sharing inside
 * it. Synchronous on purpose: an `await` inside the scope would let unrelated
 * work interleave with it and read answers it never asked to share, so a
 * `work` that returns a promise is refused rather than half-scoped. A nested
 * scope joins the outer one, and everything is released when the outermost
 * scope returns or throws.
 */
export function withSharedParses<T>(work: () => T): T {
  if (scope !== null) return work();
  scope = { last: null, remembered: new Map() };
  try {
    const result = work();
    if (
      result !== null &&
      typeof result === 'object' &&
      typeof (result as { then?: unknown }).then === 'function'
    ) {
      throw new TypeError('withSharedParses: `work` must be synchronous');
    }
    return result;
  } finally {
    scope = null;
  }
}
