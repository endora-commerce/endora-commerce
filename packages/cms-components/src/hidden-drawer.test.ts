import { describe, expect, it } from 'vitest';
import { defaultPageBuilderConfig } from './index.js';

/**
 * Feature 096, Phase 2 — the hidden drawer, and the one runtime-visible thing
 * this phase changes.
 *
 * The drawer was keyed `_internal` from the day it shipped and nothing asserted
 * it: not this package, not the admin, not the backend. It became `internal`
 * because a declared palette section's key is `^[a-z][a-z0-9_]*$`
 * (`blockCategoryKeyRe`), which forbids a leading underscore, and this section
 * is `cms`' `internal` declaration.
 *
 * The rename is behaviour-preserving **only if it is complete**: Puck derives a
 * drawer from the key, and `page-builder-i18n.ts` derives the title key
 * (`pageBuilder.categories.<key>`) from the same one, so half a rename leaves
 * either an untranslated title or — the expensive half — a section that is no
 * longer `visible: false`, whereupon `Column` and `Slide` become insertable
 * outside their parent and render wrong. That failure is silent in every
 * direction, which is why the assertion is written now rather than left to the
 * phase that rewrites this map.
 */
describe('the CMS palette hidden drawer', () => {
  const categories = defaultPageBuilderConfig.categories ?? {};

  it('is keyed `internal`, which is a legal declared-category key', () => {
    expect(Object.keys(categories)).toContain('internal');
    expect(Object.keys(categories)).not.toContain('_internal');
    // The grammar is written once, in `@endora-commerce/contracts`. It is
    // re-tested rather than re-stated: this package does not depend on
    // contracts, so the key is checked against the same expression and the
    // reason it holds is in the sentence above.
    expect(/^[a-z][a-z0-9_]*$/.test('internal')).toBe(true);
  });

  it('is hidden and holds exactly the two slot-only components', () => {
    expect(categories.internal?.visible).toBe(false);
    expect(categories.internal?.components).toEqual(['Column', 'Slide']);
  });

  it('is the only hidden section — every other one is offered to an author', () => {
    const hidden = Object.entries(categories)
      .filter(([, category]) => category?.visible === false)
      .map(([key]) => key);
    expect(hidden).toEqual(['internal']);
  });
});
