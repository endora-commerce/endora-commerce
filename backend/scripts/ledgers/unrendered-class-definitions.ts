/**
 * Classes a published design system defines that **no file renders** —
 * `check:class-vocabulary`'s `unrendered-definition` (feature 110, T129b; owner
 * ruling D-219).
 *
 * ## Why these are recorded and the 23 shim classes were deleted
 *
 * D-219's second consequence names both halves in one sentence: *"the 23 classes
 * T126 published are rendered by nobody and are **deleted** rather than carried,
 * the 12 `.b2b-*` classes nothing renders are **recorded** for a drain"*. The
 * difference is not size. The shim was a whole vocabulary that nothing loaded
 * rendered — its removal cost no reader anything, and it was measured as one
 * block. These are members of a **live** vocabulary whose siblings 70 files
 * render, so removing one is a judgement about whether the component that used
 * it is coming back, and that judgement belongs to whoever owns the vocabulary.
 * D-219 says that explicitly: *"whether the `.b2b-*` vocabulary is eventually
 * retired in favour of the `ui/` primitives … is orthogonal: whoever owns the
 * vocabulary owns the retirement."*
 *
 * **Two-way.** An entry naming a class the design system no longer defines is
 * `stale-ledger-entry`, and so is one a file has started rendering. It is
 * expected to drain and there is no `permanent` member: an entry saying *"this
 * definition is right to stand unrendered"* would mean the predicate has
 * outgrown its population, and the repair for that is to narrow the predicate.
 *
 * **The count is 13 and §7.3's is 12.** The difference is `b2b-table-wrap`,
 * which that section's `P1` shell command misses because it reads rule preludes
 * **line by line** and `.b2b-table-wrap` sits at the end of a multi-line
 * selector list. The same undercount is why §7.4 reports the shim's 22 classes
 * as 23 in one place and 22 in another. This file's population comes from
 * `definedClasses()`, which reads preludes between brace boundaries.
 *
 * The other 13 entries are not `b2b-*` at all and are outside D-219's headline
 * count for a reason each names: a class a third-party library renders, a class
 * the application sets on `document`, or a descendant selector whose block has
 * no live renderer.
 */
export type UnrenderedClassLedger = Readonly<Record<string, string>>;

export const UNRENDERED_CLASS_DEFINITIONS: UnrenderedClassLedger = {
  // ---------------------------------------------------------------------
  // The `b2b-*` vocabulary — D-219's "recorded for a drain". Each is a
  // component style whose renderer is gone or was never written; the drain is
  // to delete the block with the owner's agreement, in the vocabulary's own
  // merge request rather than in a stylesheet move.
  // ---------------------------------------------------------------------
  'b2b-badge--solid': 'a badge variant no screen renders; drains with the badge vocabulary',
  'b2b-btn--lg': 'a button size no screen renders; the tree uses the default and `--sm`',
  'b2b-locale-strip':
    'the language switcher this styled is not in the admin; its `button` child rule goes with it',
  'b2b-matrix': 'a price-matrix block with no renderer; `b2b-matrix-wrap` and `cell-input` are its parts',
  'b2b-matrix-wrap': 'the scroll wrapper of `b2b-matrix`, which nothing renders',
  'b2b-nav-badge': 'a sidebar counter badge no nav item renders',
  'b2b-savebar': 'a sticky save bar superseded by `b2b-sticky-form-actions`',
  'b2b-savebar__msg': 'the message slot of `b2b-savebar`, which nothing renders',
  'b2b-select': 'a select skin no screen renders; the kit `ui/select` primitive is what is used',
  'b2b-stock-pill': 'an inventory pill no screen renders',
  'b2b-switch': 'a toggle skin no screen renders; the kit primitive is what is used',
  'b2b-table-wrap':
    'a table wrapper no screen renders; `b2b-table-scroll` is the one the mobile shell uses',
  'b2b-tag-pill': 'a tag pill no screen renders',

  // ---------------------------------------------------------------------
  // Not `b2b-*`, and each stands for a reason of its own rather than as debt.
  // ---------------------------------------------------------------------
  dark:
    "the dark-mode class the application sets on `document.documentElement`, never in a class " +
    'attribute — it is a state selector and not a component class',
  'puck-root':
    "`@measured/puck`'s own root class, rendered by that library rather than by this " +
    'repository; the design system styles it because the host embeds the editor',
  'cms-pb-header-leading':
    'a page-builder header slot whose renderer is the CMS module; it drains with the block',
  'cms-pb-header-left': 'the second slot of the same header block',
  'cell-input': 'a descendant of `b2b-matrix`, which nothing renders',
  'cell--num': 'a numeric-cell modifier under `b2b-matrix`, which nothing renders',
  bar: 'a descendant of a chart block whose renderer is gone',
  dot: 'a descendant of a status block whose renderer is gone',
  lo: 'a descendant modifier of a stock indicator whose renderer is gone',
  trail: 'a descendant of a breadcrumb block whose renderer is gone',
  x: 'a descendant close affordance whose renderer is gone',
  zero: 'a descendant empty-state modifier whose renderer is gone',
  'row-h': 'a descendant row-height modifier whose renderer is gone',
};
