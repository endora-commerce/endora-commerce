/**
 * Templated order status-change events (feature 038, US1 / FR-007).
 *
 * On every transition X → Y the orders module emits four templated events on
 * the in-process EventBus, in addition to the retained coarse
 * `order.status_changed.v1`. Because statuses are admin-configurable at runtime,
 * the concrete event names are not known at compile time — they are produced by
 * this single builder so the naming scheme lives in exactly one place.
 *
 *   order.status.from_<x>_to_<y>.before   (before the write, may be vetoed)
 *   order.status.from_<x>.before          (before the write, may be vetoed)
 *   order.status.from_<x>_to_<y>.after    (after commit, fire-and-forget)
 *   order.status.to_<y>.after             (after commit, fire-and-forget)
 *
 * `<x>` / `<y>` are the snake_case status codes.
 */

import type { EventBase } from '../../../events/bus.js';

export type OrderStatusEventKind = 'fromToBefore' | 'fromBefore' | 'fromToAfter' | 'toAfter';

export interface OrderStatusActor {
  kind: 'admin' | 'customer' | 'system';
  adminUserId?: string;
  customerAccountId?: string;
  source?: 'payment' | 'shipment' | 'reorder' | 'checkout';
}

export interface OrderStatusEvent extends EventBase {
  orderId: string;
  organizationId: string;
  salesChannelId: string;
  from: string;
  to: string;
  actor: OrderStatusActor;
  reason?: string | null;
}

/** Build the concrete event name for one of the four templated kinds. */
export function orderStatusEventName(
  kind: OrderStatusEventKind,
  p: { from?: string; to?: string },
): string {
  switch (kind) {
    case 'fromToBefore':
      return `order.status.from_${p.from}_to_${p.to}.before`;
    case 'fromBefore':
      return `order.status.from_${p.from}.before`;
    case 'fromToAfter':
      return `order.status.from_${p.from}_to_${p.to}.after`;
    case 'toAfter':
      return `order.status.to_${p.to}.after`;
  }
}

/** The two "before" event names for a transition (dispatched before the write). */
export function orderStatusBeforeEventNames(from: string, to: string): string[] {
  return [
    orderStatusEventName('fromToBefore', { from, to }),
    orderStatusEventName('fromBefore', { from }),
  ];
}

/** The two "after" event names for a transition (dispatched post-commit). */
export function orderStatusAfterEventNames(from: string, to: string): string[] {
  return [
    orderStatusEventName('fromToAfter', { from, to }),
    orderStatusEventName('toAfter', { to }),
  ];
}

/**
 * Thrown by a registered before-guard to veto a transition (FR-008). The
 * transition service propagates this to abort the transaction; the coarse
 * EventBus isolates ordinary handler errors and cannot express a veto, which is
 * why before-guards run through a dedicated dispatch (see OrderTransitionService).
 */
export class OrderTransitionVetoError extends Error {
  constructor(
    message: string,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(message);
    this.name = 'OrderTransitionVetoError';
  }
}
