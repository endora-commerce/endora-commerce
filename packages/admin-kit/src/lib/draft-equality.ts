/**
 * Whether an editor's draft still equals what was last saved (issue #1446, DS-13) —
 * the `dirty` an unsaved-changes guard is armed with.
 *
 * Structural, with JSON's semantics, because a draft is what the screen would
 * send: object key **order** is ignored (a form rebuilt from a response is not
 * a change), a property whose value is `undefined` is the same as an absent one,
 * and arrays compare in order. Reference identity is never the test — a canvas
 * re-emits an equal tree as a new object on every reseed, and that is not an
 * edit the operator made.
 */
export function isDraftEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return a === b;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => isDraftEqual(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!isDraftEqual(left[key], right[key])) return false;
  }
  return true;
}
