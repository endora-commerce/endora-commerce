import { describe, expect, it } from 'vitest';
import { CRM_EVENTS, type OpportunityStatusEvent } from '@endora-commerce/contracts';
import {
  buildOpportunityStatusEvent,
  emitOpportunityStatusAfter,
  emitOpportunityStatusBefore,
  opportunityStatusAfterEventNames,
  opportunityStatusBeforeEventNames,
} from './opportunity-status-events.js';

/** A bus that only records what it was asked to emit, in order. */
function recordingBus() {
  const emitted: Array<{ name: string; payload: Record<string, unknown> }> = [];
  return {
    emitted,
    emit(name: string, payload: unknown) {
      emitted.push({ name, payload: payload as Record<string, unknown> });
    },
  };
}

const INPUT = {
  opportunityId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  salesChannelId: null,
  from: 'negotiation',
  to: 'won',
  fromKind: 'open',
  toKind: 'won',
  actor: { kind: 'admin', adminUserId: '33333333-3333-4333-8333-333333333333' },
  cause: 'manual',
  reason: null,
} as const;

describe('opportunity status events', () => {
  it('names the two before-events of a transition', () => {
    expect(opportunityStatusBeforeEventNames('new', 'qualified')).toEqual([
      'crm.opportunity.status.from_new_to_qualified.before',
      'crm.opportunity.status.from_new.before',
    ]);
  });

  it('names the two templated after-events of a transition', () => {
    expect(opportunityStatusAfterEventNames('negotiation', 'won')).toEqual([
      'crm.opportunity.status.from_negotiation_to_won.after',
      'crm.opportunity.status.to_won.after',
    ]);
  });

  it('builds a payload carrying the envelope and every field of the contract', () => {
    const event = buildOpportunityStatusEvent(INPUT);
    expect(event).toMatchObject(INPUT);
    expect(event.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(event.occurredAt))).toBe(false);
    expect('causeOrderId' in event).toBe(false);
  });

  it('carries the cause Order only when there is one', () => {
    const event = buildOpportunityStatusEvent({
      ...INPUT,
      cause: 'order_status',
      causeOrderId: '44444444-4444-4444-8444-444444444444',
    });
    expect(event.causeOrderId).toBe('44444444-4444-4444-8444-444444444444');
  });

  it('emits the before pair, in the contract order, with one payload', () => {
    const bus = recordingBus();
    const event: OpportunityStatusEvent = buildOpportunityStatusEvent(INPUT);
    emitOpportunityStatusBefore(bus, event);
    expect(bus.emitted.map((e) => e.name)).toEqual([
      'crm.opportunity.status.from_negotiation_to_won.before',
      'crm.opportunity.status.from_negotiation.before',
    ]);
    expect(bus.emitted.every((e) => e.payload === (event as unknown))).toBe(true);
  });

  it('emits the coarse event with the number, then the two templated after-events', () => {
    const bus = recordingBus();
    const event = buildOpportunityStatusEvent(INPUT);
    emitOpportunityStatusAfter(bus, event, { number: 'OPP-000007', value: '120.00', currency: 'PLN' });
    expect(bus.emitted.map((e) => e.name)).toEqual([
      CRM_EVENTS.STATUS_CHANGED,
      'crm.opportunity.status.from_negotiation_to_won.after',
      'crm.opportunity.status.to_won.after',
      CRM_EVENTS.CLOSED,
    ]);
    expect(bus.emitted[0]?.payload).toMatchObject({ ...INPUT, number: 'OPP-000007' });
    expect('number' in (bus.emitted[1]?.payload ?? {})).toBe(false);
    expect(bus.emitted[3]?.payload).toMatchObject({
      opportunityId: INPUT.opportunityId,
      organizationId: INPUT.organizationId,
      outcome: 'won',
      value: '120.00',
      currency: 'PLN',
    });
  });

  it('announces no closing when the target status is open', () => {
    const bus = recordingBus();
    const event = buildOpportunityStatusEvent({ ...INPUT, from: 'lost', to: 'new', fromKind: 'lost', toKind: 'open' });
    emitOpportunityStatusAfter(bus, event, { number: 'OPP-000007', value: null, currency: 'PLN' });
    expect(bus.emitted.map((e) => e.name)).toEqual([
      CRM_EVENTS.STATUS_CHANGED,
      'crm.opportunity.status.from_lost_to_new.after',
      'crm.opportunity.status.to_new.after',
    ]);
  });
});
