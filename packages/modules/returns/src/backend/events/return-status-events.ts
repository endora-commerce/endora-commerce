/**
 * Templated return-case status-change events (feature 046, US3).
 *
 * On every transition X → Y the returns module emits four templated events on
 * the in-process EventBus. Because statuses are admin-configurable, the concrete
 * names are produced by this single builder so the naming scheme lives in one
 * place (mirrors `orders/events/order-status-events.ts`).
 *
 *   return.status.from_<x>_to_<y>.before   (before the write, may be vetoed)
 *   return.status.from_<x>.before          (before the write, may be vetoed)
 *   return.status.from_<x>_to_<y>.after    (after commit, fire-and-forget)
 *   return.status.to_<y>.after             (after commit, fire-and-forget)
 */

import type { EventBase, EventBus } from '@endora-commerce/platform/events';

export type ReturnStatusEventKind = 'fromToBefore' | 'fromBefore' | 'fromToAfter' | 'toAfter';

export interface ReturnStatusActor {
  kind: 'admin' | 'customer' | 'system';
  adminUserId?: string;
  customerAccountId?: string;
  source?: 'shipment' | 'settlement';
}

export interface ReturnStatusEvent extends EventBase {
  returnCaseId: string;
  orderId: string;
  organizationId: string | null;
  salesChannelId: string;
  from: string;
  to: string;
  actor: ReturnStatusActor;
  reason?: string | null;
}

/** Thrown by a before-guard to abort a transition. */
export class ReturnTransitionVetoError extends Error {}

/** Build the concrete event name for one of the four templated kinds. */
export function returnStatusEventName(
  kind: ReturnStatusEventKind,
  p: { from?: string; to?: string },
): string {
  switch (kind) {
    case 'fromToBefore':
      return `return.status.from_${p.from}_to_${p.to}.before`;
    case 'fromBefore':
      return `return.status.from_${p.from}.before`;
    case 'fromToAfter':
      return `return.status.from_${p.from}_to_${p.to}.after`;
    case 'toAfter':
      return `return.status.to_${p.to}.after`;
  }
}

export function returnStatusBeforeEventNames(from: string, to: string): string[] {
  return [
    returnStatusEventName('fromToBefore', { from, to }),
    returnStatusEventName('fromBefore', { from }),
  ];
}

export function returnStatusAfterEventNames(from: string, to: string): string[] {
  return [
    returnStatusEventName('fromToAfter', { from, to }),
    returnStatusEventName('toAfter', { to }),
  ];
}

/** Emit the two post-commit `.after` events for a transition X→Y. No-op when equal. */
export function emitReturnStatusAfter(events: EventBus, e: ReturnStatusEvent): void {
  if (e.from === e.to) return;
  for (const name of returnStatusAfterEventNames(e.from, e.to)) {
    events.emit(name, e);
  }
}
