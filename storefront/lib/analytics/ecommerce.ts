'use client';

import { getGaConfig, trackGaEvent } from './gtag';
import { emitActionEvents } from './collector';

/**
 * GA4 Enhanced Ecommerce + custom-event emitters (feature 049, US2/US3). Each
 * helper fires the standard GA4 ecommerce event (only when `enhancedEcommerce`
 * is enabled for the channel) AND any admin-configured custom events bound to
 * the same storefront action. Callers pass already-resolved values — never file
 * uploads.
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
}

export function trackAddToQuoteRequest(item: GaLineItem): void {
  emitActionEvents('add_to_quote_request', actionPayload(item));
}

export function trackAddToShoppingList(item: GaLineItem): void {
  emitActionEvents('add_to_shopping_list', actionPayload(item));
}

export function trackBeginCheckout(items: GaLineItem[], currency = 'USD'): void {
  if (enhanced()) {
    trackGaEvent('begin_checkout', {
      currency,
      value: items.reduce((sum, i) => sum + i.price * i.quantity, 0),
      items: JSON.stringify(items.map(ga4Item)),
    });
  }
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
}

/** "Place Order" click on checkout — custom events only (order payload). */
export function trackPlaceOrderClicked(payload: Record<string, string | number>): void {
  emitActionEvents('place_order_clicked', payload);
}

/** Contact-form submit — custom events only; caller excludes file uploads. */
export function trackContactFormSubmitted(fields: Record<string, string | number>): void {
  emitActionEvents('contact_form_submitted', fields);
}
