import { randomUUID } from 'crypto';
import {
  CRM_EVENTS,
  opportunityStatusEventName,
  type OpportunityClosedEvent,
  type OpportunityStatusActor,
  type OpportunityStatusChangedEvent,
  type OpportunityStatusEvent,
  type OpportunityStatusKind,
  type OpportunityTransitionCause,
} from '@endora-commerce/contracts';

/**
 * The events an Opportunity status change announces
 * (`specs/143-crm-sales-opportunities/contracts/events-and-ports.md` §1.1).
 *
 * For a transition `x → y`, in this order:
 *
 *   crm.opportunity.status.from_<x>_to_<y>.before   before the write — passive
 *   crm.opportunity.status.from_<x>.before          before the write — passive
 *   — the write commits; Order propagation runs —
 *   crm.opportunity.status_changed.v1               after commit
 *   crm.opportunity.status.from_<x>_to_<y>.after    after commit
 *   crm.opportunity.status.to_<y>.after             after commit
 *   crm.opportunity.closed.v1                       after commit, when `y` closes
 *
 * The names come from `opportunityStatusEventName` in the contracts package —
 * the one place the scheme is written. Statuses are configured at runtime, so
 * no name here is known at compile time.
 *
 * None of these can refuse a transition: the bus isolates a handler's failure.
 * Refusing is the guard registry's.
 */

/** The slice of the event bus this file needs — what `emit` is, and nothing else. */
export interface OpportunityEventSink {
  emit(eventName: string, payload: never): void;
}

export function opportunityStatusBeforeEventNames(from: string, to: string): string[] {
  return [
    opportunityStatusEventName('fromToBefore', { from, to }),
    opportunityStatusEventName('fromBefore', { from }),
  ];
}

export function opportunityStatusAfterEventNames(from: string, to: string): string[] {
  return [
    opportunityStatusEventName('fromToAfter', { from, to }),
    opportunityStatusEventName('toAfter', { to }),
  ];
}

export interface OpportunityStatusEventInput {
  opportunityId: string;
  organizationId: string;
  salesChannelId: string | null;
  from: string;
  to: string;
  fromKind: OpportunityStatusKind;
  toKind: OpportunityStatusKind;
  actor: OpportunityStatusActor;
  cause: OpportunityTransitionCause;
  causeOrderId?: string | undefined;
  reason: string | null;
}

/** The payload of the four templated events, and what a guard is handed. */
export function buildOpportunityStatusEvent(input: OpportunityStatusEventInput): OpportunityStatusEvent {
  return {
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    opportunityId: input.opportunityId,
    organizationId: input.organizationId,
    salesChannelId: input.salesChannelId,
    from: input.from,
    to: input.to,
    fromKind: input.fromKind,
    toKind: input.toKind,
    actor: input.actor,
    cause: input.cause,
    ...(input.causeOrderId ? { causeOrderId: input.causeOrderId } : {}),
    reason: input.reason,
  };
}

function emit(events: OpportunityEventSink, name: string, payload: unknown): void {
  events.emit(name, payload as never);
}

/** The two passive before-events, once the guards have let the transition through. */
export function emitOpportunityStatusBefore(events: OpportunityEventSink, event: OpportunityStatusEvent): void {
  for (const name of opportunityStatusBeforeEventNames(event.from, event.to)) {
    emit(events, name, event);
  }
}

/**
 * What follows a committed transition: the coarse event (which also carries the
 * Opportunity's number), the two templated after-events, and — when the new
 * status closes the Opportunity — `crm.opportunity.closed.v1`.
 */
export function emitOpportunityStatusAfter(
  events: OpportunityEventSink,
  event: OpportunityStatusEvent,
  opportunity: { number: string; value: string | null; currency: string },
): void {
  const changed: OpportunityStatusChangedEvent = { ...event, number: opportunity.number };
  emit(events, CRM_EVENTS.STATUS_CHANGED, changed);
  for (const name of opportunityStatusAfterEventNames(event.from, event.to)) {
    emit(events, name, event);
  }
  if (event.toKind !== 'open') {
    const closed: OpportunityClosedEvent = {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      opportunityId: event.opportunityId,
      organizationId: event.organizationId,
      outcome: event.toKind,
      value: opportunity.value,
      currency: opportunity.currency,
    };
    emit(events, CRM_EVENTS.CLOSED, closed);
  }
}
