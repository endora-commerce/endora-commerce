'use client';

import { getGaConfig, trackGaEvent } from './gtag';
import { emitActionEvents } from './collector';
import { trackLinkedInConversions } from './linkedin/tag';
import { trackMetaEvent } from './meta/pixel';

/**
 * Commerce-event emitters (feature 049, US2/US3; feature 063 US3).
 *
 * This module is the single choke point every commerce call site funnels
 * through, so it is where one storefront action fans out to each ad platform:
 * the standard GA4 ecommerce event (only when `enhancedEcommerce` is enabled),
 * any admin-configured GA custom events, any LinkedIn conversion mapped to the
 * same action, and Meta's standard event plus any custom Meta events. Each
 * platform applies its own enabled/consent gate, so a helper stays a plain call
 * with no platform branching at the call sites.
 *
 * Callers pass already-resolved values — never file uploads.
 */

export interface GaLineItem {
  sku: string;
  name: string;
  price: number;
  quantity: number;
  currency?: string;
}

function enhanced(): boolean {
  return !!getGaConfig()?.enhancedEcommerce;
}

function ga4Item(item: GaLineItem): Record<string, string | number> {
  return { item_id: item.sku, item_name: item.name, price: item.price, quantity: item.quantity };
}

function actionPayload(item: GaLineItem): Record<string, string | number> {
  return { sku: item.sku, name: item.name, price: item.price, quantity: item.quantity };
}

export function trackViewItem(item: GaLineItem): void {
  if (enhanced()) {
    trackGaEvent('view_item', {
      currency: item.currency ?? 'USD',
      value: item.price,
      items: JSON.stringify([ga4Item(item)]),
    });
  }
  trackLinkedInConversions('product_viewed');
  trackMetaEvent('product_viewed', {
    content_ids: [item.sku],
    content_type: 'product',
    value: item.price,
    currency: item.currency ?? 'USD',
  });
}

export function trackAddToCart(item: GaLineItem): void {
  if (enhanced()) {
    trackGaEvent('add_to_cart', {
      currency: item.currency ?? 'USD',
      value: item.price * item.quantity,
      items: JSON.stringify([ga4Item(item)]),
    });
  }
  emitActionEvents('add_to_cart', actionPayload(item));
  trackLinkedInConversions('add_to_cart');
  trackMetaEvent('add_to_cart', {
    content_ids: [item.sku],
    content_type: 'product',
    value: item.price * item.quantity,
    currency: item.currency ?? 'USD',
  });
}

export function trackAddToQuoteRequest(item: GaLineItem): void {
  emitActionEvents('add_to_quote_request', actionPayload(item));
  trackLinkedInConversions('add_to_quote_request');
  trackMetaEvent('add_to_quote_request', {
    content_ids: [item.sku],
    content_type: 'product',
    value: item.price * item.quantity,
    currency: item.currency ?? 'USD',
  });
}

export function trackAddToShoppingList(item: GaLineItem): void {
  emitActionEvents('add_to_shopping_list', actionPayload(item));
  trackLinkedInConversions('add_to_shopping_list');
  trackMetaEvent('add_to_shopping_list', { content_ids: [item.sku], content_type: 'product' });
}

export function trackBeginCheckout(items: GaLineItem[], currency = 'USD'): void {
  if (enhanced()) {
    trackGaEvent('begin_checkout', {
      currency,
      value: items.reduce((sum, i) => sum + i.price * i.quantity, 0),
      items: JSON.stringify(items.map(ga4Item)),
    });
  }
  trackLinkedInConversions('begin_checkout');
  trackMetaEvent('begin_checkout', {
    content_ids: items.map((i) => i.sku),
    content_type: 'product',
    num_items: items.reduce((sum, i) => sum + i.quantity, 0),
    value: items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    currency,
  });
}

export interface GaPurchase {
  transactionId: string;
  value: number;
  currency: string;
  items: GaLineItem[];
}

export function trackPurchase(order: GaPurchase): void {
  if (enhanced()) {
    trackGaEvent('purchase', {
      transaction_id: order.transactionId,
      value: order.value,
      currency: order.currency,
      items: JSON.stringify(order.items.map(ga4Item)),
    });
  }
  trackLinkedInConversions('purchase');
  trackMetaEvent('purchase', {
    content_ids: order.items.map((i) => i.sku),
    content_type: 'product',
    value: order.value,
    currency: order.currency,
  });
}

/** "Place Order" click on checkout — custom events only (order payload). */
export function trackPlaceOrderClicked(payload: Record<string, string | number>): void {
  emitActionEvents('place_order_clicked', payload);
  trackLinkedInConversions('place_order_clicked');
  trackMetaEvent('place_order_clicked');
}

/** Contact-form submit — custom events only; caller excludes file uploads. */
export function trackContactFormSubmitted(fields: Record<string, string | number>): void {
  emitActionEvents('contact_form_submitted', fields);
  trackLinkedInConversions('contact_form_submitted');
  trackMetaEvent('contact_form_submitted');
}
