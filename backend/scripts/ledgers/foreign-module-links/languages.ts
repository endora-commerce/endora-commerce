import type { ForeignLinkEntry } from '../../check-module-docs.js';

/**
 * Relative links from `languages`'s documentation into a sibling module's pages
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
 */
export const entries: Readonly<Record<string, ForeignLinkEntry>> = {
  currencies:
    "FR-020 — 1 link(s) into `currencies`'s pages: `languages.md` -> `./currencies.md`. " +
    'Refer to the sibling by name or link the module map; the reference survives the ' +
    'sibling being absent either way.',
};
