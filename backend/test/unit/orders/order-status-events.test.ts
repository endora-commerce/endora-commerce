import { describe, expect, it } from 'vitest';
import {
  orderStatusAfterEventNames,
  orderStatusBeforeEventNames,
  orderStatusEventName,
} from '../../../../packages/modules/orders/src/backend/events/order-status-events.js';

describe('orderStatusEventName', () => {
  it('builds the from→to before name', () => {
    expect(orderStatusEventName('fromToBefore', { from: 'new', to: 'pending' })).toBe(
      'order.status.from_new_to_pending.before',
    );
  });

  it('builds the from-any before name', () => {
    expect(orderStatusEventName('fromBefore', { from: 'paid' })).toBe('order.status.from_paid.before');
  });

  it('builds the from→to after name', () => {
    expect(orderStatusEventName('fromToAfter', { from: 'paid', to: 'completed' })).toBe(
      'order.status.from_paid_to_completed.after',
    );
  });

  it('builds the to-any after name', () => {
    expect(orderStatusEventName('toAfter', { to: 'shipment_sent' })).toBe('order.status.to_shipment_sent.after');
  });

  it('handles multi-word status codes verbatim', () => {
    expect(orderStatusEventName('fromToAfter', { from: 'shipment_ready', to: 'shipment_sent' })).toBe(
      'order.status.from_shipment_ready_to_shipment_sent.after',
    );
  });
});

describe('order status event name groups', () => {
  it('returns the two before names for a transition', () => {
    expect(orderStatusBeforeEventNames('new', 'pending')).toEqual([
      'order.status.from_new_to_pending.before',
      'order.status.from_new.before',
    ]);
  });

  it('returns the two after names for a transition', () => {
    expect(orderStatusAfterEventNames('new', 'pending')).toEqual([
      'order.status.from_new_to_pending.after',
      'order.status.to_pending.after',
    ]);
  });
});
