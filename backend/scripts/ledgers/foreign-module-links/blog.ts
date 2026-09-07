import type { ForeignLinkEntry } from '../../check-module-docs.js';

/**
 * Relative links from `blog`'s documentation into a sibling module's pages
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
  assets_library: {
    sites: 2,
    reason:
      "FR-020 — 2 link(s) into `assets_library`'s pages: `blog/index.md` -> " +
      '`../assets-library/index.md#asset-reference-registry`, `blog/index.md` -> ' +
      '`../assets-library/index.md`. Refer to the sibling by name or link the module map; ' +
      'the reference survives the sibling being absent either way.',
  },
  catalog:
    "FR-020 — 1 link(s) into `catalog`'s pages: `blog/index.md` -> `../catalog.md`. Refer " +
    'to the sibling by name or link the module map; the reference survives the sibling ' +
    'being absent either way.',
  cms: {
    sites: 2,
    reason:
      "FR-020 — 2 link(s) into `cms`'s pages: `blog/index.md` -> `../cms/index.md`. Refer " +
      'to the sibling by name or link the module map; the reference survives the sibling ' +
      'being absent either way.',
  },
  sales_channels:
    "FR-020 — 1 link(s) into `sales_channels`'s pages: `blog/index.md` -> " +
    '`../sales_channels/index.md`. Refer to the sibling by name or link the module map; ' +
    'the reference survives the sibling being absent either way.',
  settings: {
    sites: 2,
    reason:
      "FR-020 — 2 link(s) into `settings`'s pages: `blog/index.md` -> " +
      '`../settings/index.md`. Refer to the sibling by name or link the module map; the ' +
      'reference survives the sibling being absent either way.',
  },
};
