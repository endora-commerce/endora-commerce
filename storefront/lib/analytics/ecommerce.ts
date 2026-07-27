'use client';

import { getGaConfig, trackGaEvent } from './gtag';
import { emitActionEvents } from './collector';
import { trackLinkedInConversions } from './linkedin/tag';

/**
 * Commerce-event emitters (feature 049, US2/US3; feature 063 US3).
 *
 * This module is the single choke point every commerce call site funnels
 * through, so it is where one storefront action fans out to each ad platform:
 * the standard GA4 ecommerce event (only when `enhancedEcommerce` is enabled),
 * any admin-configured GA custom events, and any LinkedIn conversion mapped to
 * the same action. Each platform applies its own enabled/consent gate, so a
 * helper stays a plain call with no platform branching at the call sites.
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
}

export function trackAddToQuoteRequest(item: GaLineItem): void {
  emitActionEvents('add_to_quote_request', actionPayload(item));
  trackLinkedInConversions('add_to_quote_request');
}

export function trackAddToShoppingList(item: GaLineItem): void {
  emitActionEvents('add_to_shopping_list', actionPayload(item));
  trackLinkedInConversions('add_to_shopping_list');
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
}

/** "Place Order" click on checkout — custom events only (order payload). */
export function trackPlaceOrderClicked(payload: Record<string, string | number>): void {
  emitActionEvents('place_order_clicked', payload);
  trackLinkedInConversions('place_order_clicked');
}

/** Contact-form submit — custom events only; caller excludes file uploads. */
export function trackContactFormSubmitted(fields: Record<string, string | number>): void {
  emitActionEvents('contact_form_submitted', fields);
  trackLinkedInConversions('contact_form_submitted');
}
