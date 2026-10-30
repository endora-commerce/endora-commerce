import type { PageBuilderContext } from './types/responsive.js';

// A module of its own, importing nothing but a type, so a Node program — a
// module's backend layer, or its tests — can name the rule without compiling
// the editor's `.tsx` that `define-component.ts` reaches (issue #81).

/**
 * Does a block declared for `declared` appear in the `target` palette?
 *
 * **`contexts` states what a block is *authored for*; appearance is derived**
 * (feature 096, D-10, normative in
 * `specs/096-page-builder-block-ownership/contracts/block-definition.md` §4.1.1).
 * The one admission the platform grants is `email -> newsletter`: every e-mail
 * block is offered in the newsletter palette, and **no block in the tree
 * declares `newsletter`** — that member of `PageBuilderContext` has never had a
 * block of its own.
 *
 * Extracted because the rule was written **twice in `define-component.ts`** and T305's
 * derived palette would have been the third copy — the `text-normalization.ts`
 * discipline, where a rule with two implementations is a rule with two answers
 * waiting to disagree. The two spellings were proved equivalent before the
 * extraction rather than assumed to be: over all 16 subsets of
 * `PageBuilderContext` against all 4 contexts, 64 combinations, **zero
 * divergences** — including `['newsletter']` alone, which the task note
 * predicted would diverge and does not.
 *
 * It is load-bearing on four live editor surfaces — `newsletter`'s `BlocksPage`
 * (twice), `CampaignEditor` and `AutomationBuilder`, all reaching
 * `EmailEditorPane` — so removing the admission empties the palette every
 * campaign, block and automation step is authored against.
 */
export function contextAdmits(
  declared: readonly PageBuilderContext[],
  target: PageBuilderContext,
): boolean {
  if (declared.includes(target)) return true;
  return target === 'newsletter' && declared.includes('email');
}
