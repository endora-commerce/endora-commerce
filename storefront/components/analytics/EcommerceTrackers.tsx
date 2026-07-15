'use client';

import { useEffect, useRef } from 'react';
import {
  trackViewItem,
  trackBeginCheckout,
  trackPurchase,
  type GaLineItem,
  type GaPurchase,
} from '../../lib/analytics/ecommerce';

/**
 * Fire-once-on-mount GA4 Enhanced Ecommerce trackers (feature 049, US2).
 * Rendered by server pages that hold the relevant data; each is a no-op unless
 * Enhanced Ecommerce is enabled for the channel. A ref guards against a double
 * fire under React strict-mode remounts.
 */

export function ViewItemTracker({ item }: { item: GaLineItem }): null {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackViewItem(item);
    // Fire once for this product view.

  }, [item.sku]);
  return null;
}

export function BeginCheckoutTracker({
  items,
  currency,
}: {
  items: GaLineItem[];
  currency: string;
}): null {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackBeginCheckout(items, currency);

  }, []);
  return null;
}

export function PurchaseTracker({ order }: { order: GaPurchase }): null {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackPurchase(order);
    // Guard against re-fire on remount for the same transaction.

  }, [order.transactionId]);
  return null;
}
