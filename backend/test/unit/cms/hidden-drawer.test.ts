import { describe, expect, it } from 'vitest';
import type { BlockCategory, BlockDefinition } from '@endora-commerce/contracts';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';

/**
 * The hidden drawer — feature 096, moved here from
 * `packages/cms-components/src/hidden-drawer.test.ts` by Phase 3.
 *
 * Its subject moved with it. The drawer was a `categories` entry in
 * `@endora-commerce/cms-components`' hand-written map; it is now `cms`'
 * `internal` **declaration**, and the members are the blocks that name that
 * category rather than a list the section carries. So the assertion has to be
 * made where the manifests are, which is here.
 *
 * The property is unchanged and is still the expensive one to lose: `visible:
 * false` is what keeps `cms.Column` and `cms.Slide` out of Puck's *Other*
 * group, where they are insertable outside their parent and render wrong. That
 * failure is silent in every direction.
 */
describe('the CMS palette hidden drawer', () => {
  const cms = REGISTERED_MANIFESTS.find((entry) => entry.manifest.id === 'cms')!.manifest;
  const categories = (cms.blockCategories ?? []) as BlockCategory[];
  const blocks = (cms.blocks ?? []) as BlockDefinition[];

  it('is keyed `internal`, which is a legal declared-category key', () => {
    const keys = categories.map((category) => category.key);
    expect(keys).toContain('internal');
    expect(keys).not.toContain('_internal');
  });

  it('is hidden and holds exactly the two slot-only blocks', () => {
    const internal = categories.find((category) => category.key === 'internal')!;
    expect(internal.visible).toBe(false);
    expect(blocks.filter((b) => b.category === 'internal').map((b) => b.name)).toEqual([
      'cms.Column',
      'cms.Slide',
    ]);
  });

  it('is the only hidden CMS section — every other one is offered to an author', () => {
    expect(categories.filter((c) => c.visible === false).map((c) => c.key)).toEqual(['internal']);
  });
});

/**
 * The e-mail palette's hidden drawer, and the one **deliberate behaviour
 * change** this feature ships (`data-model.md` §2.1, defect D-c).
 *
 * `EmailColumn` was in no category at all, so Puck put it in the *Other* group,
 * where an author could insert it outside an `EmailRow` — and it renders wrong
 * there. `transactional_emails` now declares an `internal` section,
 * `visible: false`, and puts it in; the derived palette therefore stops offering
 * it. Asserted here because the change is a **manifest** fact, and asserted at
 * all because a hidden section that silently became visible is exactly the kind
 * of regression nothing else in the tree would report.
 */
describe('the e-mail palette hidden drawer', () => {
  const te = REGISTERED_MANIFESTS.find(
    (entry) => entry.manifest.id === 'transactional_emails',
  )!.manifest;
  const categories = (te.blockCategories ?? []) as BlockCategory[];
  const blocks = (te.blocks ?? []) as BlockDefinition[];

  it('holds EmailColumn, hidden, so it is no longer insertable from Other', () => {
    const internal = categories.find((category) => category.key === 'internal');
    expect(internal, '`transactional_emails` declares an `internal` section').toBeDefined();
    expect(internal!.visible).toBe(false);
    expect(internal!.contexts).toEqual(['email']);
    expect(blocks.filter((b) => b.category === 'internal').map((b) => b.name)).toEqual([
      'transactional_emails.EmailColumn',
    ]);
  });

  it('leaves every other e-mail section visible', () => {
    expect(categories.filter((c) => c.visible === false).map((c) => c.key)).toEqual(['internal']);
  });
});
