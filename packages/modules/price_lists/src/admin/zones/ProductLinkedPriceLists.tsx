import type { ReactNode } from 'react';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { LinkedPriceListsPanel } from '../components/LinkedPriceListsPanel.js';

/**
 * The product editor's linked-price-lists panel (feature 091, P7a).
 *
 * `catalog`'s `ProductEditor.tsx` used to import `LinkedPriceListsPanel`
 * directly and render it as the last child of the Pricing tab. The place is
 * `product.editor.pricing.after` now, and the zone's props are the panel's, so
 * this wrapper exists only to give the renderer a default export.
 *
 * **No `match`** — one host, one mount; see `CategoryDisplayMode.tsx`.
 */
export type ProductLinkedPriceListsProps = AdminZoneProps<'product.editor.pricing.after'>;

export function ProductLinkedPriceLists({ productId }: ProductLinkedPriceListsProps): ReactNode {
  return <LinkedPriceListsPanel productId={productId} />;
}

export default ProductLinkedPriceLists;
