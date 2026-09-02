// Page Builder block names — feature 096, T104.
//
// A block name is `<ownerModuleId>.<LocalName>` and is the persisted identifier
// of a Puck node: it is written into a `jsonb` column and never rewritten
// (`specs/096-page-builder-block-ownership/contracts/block-definition.md` §3).
// These four functions are the **only** readers of that shape; every file that
// needs an owner, a local name or a "is this namespaced" answer imports them
// rather than splitting a string itself.
//
// That is the `text-normalization.ts` discipline, and this file has the same
// reason for it. Six authors wrote their own diacritic fold because the shared
// one existed under a name they did not find, and four of them were wrong; a
// private `name.split('.')[0]` is the same defect over a string that ends up in
// a client's database. `check:block-names` (Phase 7) is what will refuse the
// second copy.
//
// The grammar itself is authored once more centrally still — `blockNameRe` in
// `@endora-commerce/contracts` — because the Zod schema that refuses a bad
// declaration needs it and this package cannot be the thing `contracts`
// depends on.

import { blockNameRe } from '@endora-commerce/contracts/cms';

/** A block name split into the two things it states. */
export interface ParsedBlockName {
  /** The declaring module's `id` — the segment before the separator. */
  readonly owner: string;
  /** The PascalCase local name, unique within that module. */
  readonly local: string;
}

/**
 * Split a namespaced block name, or answer `null` when the string is not one.
 *
 * **Null rather than a throw**, deliberately: the readers that matter are a
 * migration and an operator report, both of which meet names they do not
 * recognise as a matter of course. FR-014 requires such a name to be left
 * byte-identical and reported, and a classification path that throws cannot do
 * either.
 */
export function parseBlockName(name: string): ParsedBlockName | null {
  if (!blockNameRe.test(name)) return null;
  const separator = name.indexOf('.');
  return { owner: name.slice(0, separator), local: name.slice(separator + 1) };
}

/**
 * The module that owns a block name, or `null` when the name states no owner.
 *
 * This is the question every runtime reader actually asks — which module can
 * render this node, is that module present, and whose palette does it belong in.
 */
export function ownerOf(name: string): string | null {
  return parseBlockName(name)?.owner ?? null;
}

/**
 * Whether a name is a well-formed namespaced block name.
 *
 * **Stricter than `indexOf('.') !== -1`**, which is how `data-model.md` §3
 * describes the migration's idempotence test, and the difference is deliberate
 * and narrow. No entry in the frozen rename map's domain contains a dot, so the
 * two predicates agree on every name the migration renames. They differ only on
 * a *malformed* dotted name — a hand-edited `acme.banner`, a fork's own
 * spelling — which the lax test would classify as "already namespaced" and hide
 * from the operator's report. Under this one it is unrecognised: reported, left
 * alone, and degrading to the placeholder, which is the FR-014 path it belongs
 * on.
 */
export function isNamespaced(name: string): boolean {
  return blockNameRe.test(name);
}

/**
 * Build a block name from its two parts.
 *
 * **Throws** where {@link parseBlockName} returns `null`, and the asymmetry is
 * the point: reading meets names from a client's database, where an unknown one
 * is expected; writing is a developer composing an identifier that will be
 * persisted forever, where an unparseable one is a row nothing can ever render.
 */
export function formatBlockName(owner: string, local: string): string {
  const name = `${owner}.${local}`;
  if (!blockNameRe.test(name)) {
    throw new Error(
      `[page-builder-core] "${name}" is not a valid block name (${String(blockNameRe)}) — ` +
        'the owner segment is a module id and the local name is PascalCase, and the name ' +
        'is persisted, so it cannot be corrected later.',
    );
  }
  return name;
}
