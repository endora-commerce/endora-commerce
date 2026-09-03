// The structural block-name walk — feature 096, T403.
//
// **One implementation, used by the five rename migrations and by the operator's
// pre-flight report** (`contracts/block-name-migration.md` §3). The two differ in
// what they do with a name and agree on how a name is found; two walks would be
// two answers waiting to disagree about the one thing that must not disagree —
// which nodes exist.
//
// ## It is structural, never textual
//
// Twelve of the 74 renamed names are ordinary English words that occur
// throughout shop content: `Row`, `Text`, `Image`, `Map`, `Button`, `Stats`,
// `Social`, `Column`, `Video`, `Icons`, `Tabs`, `Slide`. A `RawHtml` block's
// `html` prop, a `Text` block's `text` prop, a heading and every `alt` attribute
// in the shop are free text that may contain any of them, so a
// `replace('"Row"', '"cms.Row"')` over the serialised column corrupts content.
// The walk replaces the value of a `type` property **in a node position** and
// nothing else.
//
// ## What a node is, and what the walk descends into
//
// A JSON object is a node when it has a `type` property whose value is a string.
// `props` is **not** required — a legacy or hand-written node may lack it, and
// skipping such a node is a silent miss. (`check:block-names` requires the
// `props` sibling for the opposite reason: its subject is *source text*, where
// `{ type: 'text', label: 'Gap' }` is a Puck field descriptor and appears
// hundreds of times. The asymmetry is deliberate and is stated in
// `contracts/block-name-check.md` §2.1.)
//
// The walk descends into **every** value of every object and **every** element
// of every array. It does not key on `content` and `zones`: both envelope types
// are declared `& Record<string, unknown>` and round-tripped verbatim, and
// Puck's slot mechanism places node arrays under arbitrary prop keys — so a walk
// keyed on two known keys silently misses every slotted child, which in the CMS
// palette is `Column` inside `Row` and `Slide` inside `ContentSlider`, i.e. most
// of the tree.
//
// Everything that is not a node's `type` is copied through unchanged: prop
// values, key order within an object, array order, an envelope's `languages`
// keys and the deprecated `schema_version` key.

/**
 * Decide what happens to one `type` value found in a node position.
 *
 * Returning a string replaces the value; returning `undefined` leaves it
 * byte-identical. The report returns `undefined` for everything, which is what
 * makes it read-only by construction rather than by discipline.
 */
export type BlockNameVisitor = (type: string) => string | undefined;

export interface BlockNameWalkResult {
  /** The rewritten document. Structurally identical where nothing was renamed. */
  readonly value: unknown;
  /** How many node `type` values the visitor replaced. */
  readonly renamed: number;
  /** How many node positions were visited, replaced or not. */
  readonly visited: number;
}

/**
 * Walk a stored Puck document and offer every node `type` to `visit`.
 *
 * The returned `value` shares no mutated structure with the input: objects and
 * arrays are rebuilt in place order, so a caller may compare the two for
 * equality to decide whether an `update` is worth issuing.
 */
export function mapBlockNames(doc: unknown, visit: BlockNameVisitor): BlockNameWalkResult {
  let renamed = 0;
  let visited = 0;

  const descend = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(descend);
    }
    if (node === null || typeof node !== 'object') {
      return node;
    }
    const source = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    // Key order is preserved because `Object.entries` yields insertion order and
    // the output is built in that order. `jsonb` does not preserve key order at
    // all, but the report also runs over parsed JS objects and the migration's
    // fallback path re-serialises, so the walk keeps the property rather than
    // relying on the column type to make it moot.
    for (const [key, value] of Object.entries(source)) {
      if (key === 'type' && typeof value === 'string') {
        visited += 1;
        const replacement = visit(value);
        if (replacement !== undefined && replacement !== value) {
          renamed += 1;
          out[key] = replacement;
          continue;
        }
        out[key] = value;
        continue;
      }
      out[key] = descend(value);
    }
    return out;
  };

  return { value: descend(doc), renamed, visited };
}

/**
 * Apply a rename map to a stored document.
 *
 * **One branch** (`contracts/block-name-migration.md` §3.3). A `type` the map
 * holds is replaced; anything else is left byte-identical — an already
 * namespaced name and an unrecognised one alike, because the map's domain is
 * bare and its codomain is dotted, so the two sets are disjoint and no dot test
 * is needed to tell them apart. That is what makes idempotence a property of the
 * map rather than an outcome a branch has to remember to produce.
 */
export function renameBlockNames(
  doc: unknown,
  renames: Readonly<Record<string, string>>,
): BlockNameWalkResult {
  return mapBlockNames(doc, (type) =>
    Object.prototype.hasOwnProperty.call(renames, type) ? renames[type] : undefined,
  );
}

/**
 * Count every node `type` in a document, writing nothing.
 *
 * The report's half of the shared walk. It returns occurrences per distinct
 * name; the caller aggregates rows into the affected-row count, which is a
 * question about rows and not about nodes.
 */
export function countBlockNames(doc: unknown): Map<string, number> {
  const counts = new Map<string, number>();
  mapBlockNames(doc, (type) => {
    counts.set(type, (counts.get(type) ?? 0) + 1);
    return undefined;
  });
  return counts;
}
