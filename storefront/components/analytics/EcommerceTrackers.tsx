'use client';

import { useEffect, useRef } from 'react';
import { claimPurchaseConversionAction } from '../../lib/actions/purchase-conversion';
import { reportPurchaseOnce } from '../../lib/analytics/purchase-conversion';
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

/**
 * The GA4 `purchase` conversion for `orderId` (feature 049; issue #277).
 *
 * The `fired` ref only stops a remount of *this* component from firing twice.
 * It says nothing about the buyer reloading the page, coming back to the order
 * tomorrow, or opening it on their phone — and the page this renders on is one
 * of two that may count the same order, since a gateway returns the buyer to
 * `/orders/:id` while an offline placement lands on `/checkout/success`. So the
 * platform holds the claim and the tag fires only for the view that wins it;
 * `lib/analytics/purchase-conversion.ts` is the rule, kept out of the effect so
 * it can be exercised without a browser.
 */
export function PurchaseTracker({
  order,
  orderId,
}: {
  order: GaPurchase;
  orderId: string;
}): null {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    void reportPurchaseOnce({
      orderId,
      payload: order,
      claim: claimPurchaseConversionAction,
      fire: trackPurchase,
    });

  }, [order.transactionId]);
  return null;
}
