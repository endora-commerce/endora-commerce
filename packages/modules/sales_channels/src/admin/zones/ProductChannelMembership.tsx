import type { ReactNode } from 'react';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { EntityChannelMembership } from '../components/EntityChannelMembership.js';

/**
 * The body of the product editor's Channels tab (feature 091, P7a).
 *
 * `catalog`'s `ProductEditor.tsx` used to import `EntityChannelMembership` and
 * render it as the whole tab body, passing `entityType="product"`. The place is
 * `product.editor.channels` now, and the `entityType` is *this module's*
 * constant: the zone is the product editor's, so nothing else it could be.
 *
 * **No `match`, and it is a decision rather than an omission.** `match` narrows
 * the mounts of one place (Z13); this place has one host and one mount.
 * `admin/test/modules/sales_channels/product-channels-zone.test.tsx` asserts it
 * absent so a later author cannot add one quietly.
 */
export type ProductChannelMembershipProps = AdminZoneProps<'product.editor.channels'>;

export function ProductChannelMembership({
  productId,
}: ProductChannelMembershipProps): ReactNode {
  return <EntityChannelMembership entityType="product" entityId={productId} />;
}

/**
 * The zone renderer loads a contribution through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default ProductChannelMembership;
