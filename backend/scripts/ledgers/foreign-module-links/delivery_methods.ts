import type { ForeignLinkEntry } from '../../check-module-docs.js';

/**
 * Relative links from `delivery_methods`'s documentation into a sibling module's pages
 * (feature 100 / roadmap F12, FR-020).
 *
 * Keyed on the **target module**, never on a repository path: Phase 2 moved 76
 * pages into the packages that own them, and a path-keyed entry goes stale on
 * every batch — the shape AGENTS.md records for `module-removal.test.ts`, where
 * the batch that frees an entry is structurally the one that cannot see it go
 * stale.
 *
 * Two-way, and expected to **empty**. A sibling module may not be installed in
 * the reader's instance, so the link names a page that is not there and
 * `onBrokenLinks: 'throw'` is what that client's own documentation build says
 * about it. The remedy is `module-documentation-layer.md` R4.1's: refer to the
 * sibling by name, or link the module map. Where the reference is genuinely
 * load-bearing, the module declares the dependency in its manifest and the
 * generated reference page carries the link (Phase 3, FR-022).
 *
 * Every entry stands for the same reason: this batch **moved** the pages and
 * changed no prose, so rewriting a sentence is a documentation decision its
 * module's author takes, not one a packaging move takes for them.
 *
 * **One entry drained on 2026-09-19, and it drained by the remedy rather than by a
 * batch** (feature 134 T035). `inpost` left this repository, so
 * `./inpost` was about to become a broken link in *this* repository's own documentation
 * build — the W6 shape, a free page consuming a declaration whose only declarant left,
 * which reads as working right up until the halves separate. The sentence in
 * `delivery_methods.md` now names carrier modules without linking one, which is exactly
 * R4.1's remedy above, applied for the reason the header already gives.
 */
export const entries: Readonly<Record<string, ForeignLinkEntry>> = {
  shipments: {
    sites: 2,
    reason:
      "FR-020 — 2 link(s) into `shipments`'s pages: `delivery_methods.md` -> " +
      '`./shipments.md`. Refer to the sibling by name or link the module map; the reference ' +
      'survives the sibling being absent either way.',
  },
};
