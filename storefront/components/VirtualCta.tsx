import type { ReactNode } from 'react';

/**
 * Feature 002 US5 — emphasized "Buy and download" CTA for virtual
 * products. The actual download URL is gated behind a successful order
 * (research §US5), so this CTA only emphasizes digital delivery — it
 * does not directly link to the asset/url. The order-fulfilment flow
 * exposes the download once payment is confirmed.
 */

export function VirtualCta(props: {
  virtual: { downloadAssetId: string | null; downloadUrl: string | null };
  labels: {
    buyAndDownload: string;
    digitalDelivery: string;
  };
}): ReactNode {
  if (!props.virtual.downloadAssetId && !props.virtual.downloadUrl) return null;

  return (
    <div className="b2b-virtual-cta">
      <a href="/cart" className="b2b-cta b2b-virtual-cta__buy">
        {props.labels.buyAndDownload}
      </a>
      <p className="b2b-virtual-cta__delivery">{props.labels.digitalDelivery}</p>
    </div>
  );
}
