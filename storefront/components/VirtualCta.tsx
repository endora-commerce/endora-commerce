import type { ReactNode } from 'react';

/**
 * Feature 002 US5 — emphasized "Buy and download" CTA for virtual
 * products. The actual download URL is gated behind a successful order
 * (research §US5), so this CTA only emphasizes digital delivery — it
 * does not directly link to the asset/url. The order-fulfilment flow
 * exposes the download once payment is confirmed.
 *
 * The CTA adds the virtual product to the cart (quantity 1) via the same
 * server action the simple-product buy row uses, then the action redirects
 * to /cart. Previously it was a bare `<a href="/cart">`, so it navigated to
 * the cart without ever adding the product.
 */

export function VirtualCta(props: {
  productId: string;
  virtual: { downloadAssetId: string | null; downloadUrl: string | null };
  labels: {
    buyAndDownload: string;
    digitalDelivery: string;
  };
  addToCartAction: (formData: FormData) => void | Promise<void>;
}): ReactNode {
  if (!props.virtual.downloadAssetId && !props.virtual.downloadUrl) return null;

  return (
    <div>
      <form action={props.addToCartAction}>
        <input type="hidden" name="productId" value={props.productId} />
        <input type="hidden" name="quantity" value="1" />
        <button type="submit" className="b2b-cta">
          {props.labels.buyAndDownload}
        </button>
      </form>
      <p className="mt-2 text-[12px] text-muted">{props.labels.digitalDelivery}</p>
    </div>
  );
}
