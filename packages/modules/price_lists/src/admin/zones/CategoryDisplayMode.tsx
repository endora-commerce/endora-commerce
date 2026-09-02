import type { ReactNode } from 'react';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { DisplayModeOverrideRow } from '../components/DisplayModeOverrideRow.js';

/**
 * The category editor's price-display-mode override (feature 091, P7a).
 *
 * `catalog`'s `CategoriesTree.tsx` used to import `DisplayModeOverrideRow`
 * directly and hand it its own label and hint. The place is
 * `category.editor.after` now, and this is the four-line wrapper that binds the
 * zone's props to the control's: the scope is *this module's* constant, because
 * the host mounting a category editor is the only thing that could have said
 * `'category'`.
 *
 * **No `match`, and it is a decision rather than an omission.** `match` narrows
 * the mounts of one place (Z13); this place has one host and one mount, so
 * there is nothing to narrow, and `match` has no negation — anything written
 * here would be an enumeration of `catalog`'s vocabulary that goes stale
 * fail-closed. `admin/test/modules/price_lists/price-lists-zones.test.tsx`
 * asserts it absent.
 */
export type CategoryDisplayModeProps = AdminZoneProps<'category.editor.after'>;

export function CategoryDisplayMode({ categoryId }: CategoryDisplayModeProps): ReactNode {
  return <DisplayModeOverrideRow scope="category" targetId={categoryId} />;
}

/**
 * The zone renderer loads a contribution through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default CategoryDisplayMode;
