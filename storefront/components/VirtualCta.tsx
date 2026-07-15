'use client';

import { useActionState, type ReactNode } from 'react';
import { ADD_TO_CART_IDLE, type AddToCartResult } from '../lib/cartAddState';
import { CartAddedPopup } from './CartAddedPopup';

/**
 * Feature 002 US5 — emphasized "Buy and download" CTA for virtual
 * products. The actual download URL is gated behind a successful order
 * (research §US5), so this CTA only emphasizes digital delivery — it
 * does not directly link to the asset/url. The order-fulfilment flow
 * exposes the download once payment is confirmed.
 *
 * The CTA adds the virtual product to the cart (quantity 1) via the same
 * server action the simple-product buy row uses. The action now returns a
 * result instead of redirecting, so a confirmation popup is shown in place of
 * an immediate jump to /cart.
 */

export function VirtualCta(props: {
  productId: string;
  virtual: { downloadAssetId: string | null; downloadUrl: string | null };
  labels: {
    buyAndDownload: string;
    digitalDelivery: string;
  };
  addToCartAction: (
    prevState: AddToCartResult,
    formData: FormData,
  ) => AddToCartResult | Promise<AddToCartResult>;
}): ReactNode {
  const [cartState, cartFormAction, cartPending] = useActionState(
    props.addToCartAction,
    ADD_TO_CART_IDLE,
  );

  if (!props.virtual.downloadAssetId && !props.virtual.downloadUrl) return null;

  return (
    <div>
      <form action={cartFormAction}>
        <input type="hidden" name="productId" value={props.productId} />
        <input type="hidden" name="quantity" value="1" />
        <button
          type="submit"
          disabled={cartPending}
          aria-busy={cartPending || undefined}
          className="b2b-cta"
        >
          {props.labels.buyAndDownload}
        </button>
      </form>
      <p className="mt-2 text-[12px] text-muted">{props.labels.digitalDelivery}</p>
      <CartAddedPopup state={cartState} />
    </div>
  );
}
