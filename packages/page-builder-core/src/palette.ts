// The derived palette — feature 096, T305/T310.
//
// **One layer answers "which sections does the palette for context X have, and
// what is in them"** (`contracts/block-definition.md` §4.1.1). The three
// hand-written `categories` maps that answered it before — one in
// `cms-components`, one in `email-components`, one in `invoices`' Puck config —
// are gone: a section is now declared by the module whose blocks occupy it, and
// contributing a block into a section costs no edit to a file the contributor
// does not own (FR-009). What arrives here is the *served* declarations, merged
// across the effectively present modules by the registry
// (`page-builder-registry.ts`), and what leaves is a Puck `categories` map.
//
// ## Admission, and why it is applied here and nowhere else
//
// `contexts` states what a block is **authored for**; which palette it
// **appears in** is derived. The one admission the platform grants is
// `email -> newsletter` — the newsletter palette *is* the e-mail palette, and no
// block in this repository declares `newsletter`. The relation has one
// implementation, `contextAdmits`, and this file imports it rather than spelling
// `contexts.includes(context)`, which is correct for `cms`, `email` and
// `invoice` and silently empties the fourth.
//
// **It applies to sections as well as to blocks, at the same fold.** That is not
// a symmetry for its own sake: a palette that admits the blocks and not the
// sections renders 28 entries in Puck's *Other* drawer — not empty, merely
// unsectioned, which is the state defect D-c exists to close.
//
// ## What is derived from the blocks rather than from the declarations
//
// A declared section with no visible member in this context is **not rendered**.
// That is reading 3's kept half (`contracts/block-definition.md` §1.1): the set
// of sections actually rendered follows the blocks, so a module declaring a
// section it then contributes nothing to adds no empty drawer.

import type { Config } from '@measured/puck';
import { contextAdmits } from './define-component.js';
import type { PageBuilderContext } from './types/responsive.js';

/** A section as the descriptor serves it — already merged across present modules. */
export interface ServedPaletteSection {
  readonly key: string;
  readonly titleKey: string;
  readonly contexts: readonly PageBuilderContext[];
  readonly weight?: number | undefined;
  readonly visible?: boolean | undefined;
  /** The module whose declaration won the merge. Derived, never declared. */
  readonly ownerModule?: string | undefined;
}

/** A block as the descriptor serves it — the fields this derivation reads. */
export interface ServedPaletteBlock {
  readonly name: string;
  readonly ownerModule: string;
  readonly category?: string | undefined;
  readonly contexts?: readonly PageBuilderContext[] | undefined;
  readonly weight?: number | undefined;
}

export interface BuildPaletteOptions {
  /**
   * Resolve a section's title. `titleKey` is **module-relative**, so the caller
   * supplies the scope binding — `useTranslationContext().t(ownerModule, key)`
   * in the admin. Returning the key unchanged is a legitimate answer and is what
   * an unresolved key renders as.
   */
  readonly title: (section: ServedPaletteSection) => string;
  /**
   * Names the renderer map actually holds. A declared block with no renderer in
   * this bundle is left out of the palette rather than offered and then
   * exploding on insert; it still resolves to the missing-component placeholder
   * when it is already in a document (FR-019).
   */
  readonly renderable: ReadonlySet<string>;
}

/**
 * Build the Puck `categories` map for one context.
 *
 * Order is a function of the declarations alone — lowest `weight` first with an
 * absent `weight` sorting after every declared one, ties by key (sections) or by
 * name (blocks), both ascending — so the palette is stable under a
 * re-composition or a reordering of `MODULES`, which is D-45 applied to a
 * discovery surface.
 */
export function buildPaletteCategories(
  blocks: readonly ServedPaletteBlock[],
  sections: readonly ServedPaletteSection[],
  context: PageBuilderContext,
  options: BuildPaletteOptions,
): NonNullable<Config['categories']> {
  const admittedBlocks = blocks
    .filter(
      (block) =>
        contextAdmits(block.contexts ?? ['cms'], context) && options.renderable.has(block.name),
    )
    .sort(compareByWeightThen((block) => block.name));

  const membersByCategory = new Map<string, string[]>();
  for (const block of admittedBlocks) {
    if (!block.category) continue;
    const bucket = membersByCategory.get(block.category);
    if (bucket) bucket.push(block.name);
    else membersByCategory.set(block.category, [block.name]);
  }

  const categories: NonNullable<Config['categories']> = {};
  for (const section of [...sections]
    .filter((section) => contextAdmits(section.contexts, context))
    .sort(compareByWeightThen((section) => section.key))) {
    const members = membersByCategory.get(section.key);
    if (!members || members.length === 0) continue;
    categories[section.key] = {
      title: options.title(section),
      components: members,
      ...(section.visible !== undefined ? { visible: section.visible } : {}),
    };
  }
  return categories;
}

function compareByWeightThen<T extends { readonly weight?: number | undefined }>(
  tiebreak: (value: T) => string,
): (a: T, b: T) => number {
  return (a, b) => {
    const aw = a.weight ?? Number.POSITIVE_INFINITY;
    const bw = b.weight ?? Number.POSITIVE_INFINITY;
    if (aw !== bw) return aw - bw;
    const at = tiebreak(a);
    const bt = tiebreak(b);
    return at < bt ? -1 : at > bt ? 1 : 0;
  };
}
