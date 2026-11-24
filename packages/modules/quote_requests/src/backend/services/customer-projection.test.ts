import { describe, expect, it } from 'vitest';
import { customerEventsOf } from './customer-projection.js';

/** Feature 153 (owner answer Q4) — a quote PDF's delivery is the administrators' record, never the customer's. */
describe('customerEventsOf', () => {
  it('leaves the pdf-sent events out of a customer reply and keeps every other one', () => {
    const events = [{ eventType: 'submitted' }, { eventType: 'pdf-sent' }, { eventType: 'approved' }] as const;
    expect(customerEventsOf(events).map((e) => e.eventType)).toEqual(['submitted', 'approved']);
  });
});

/** Feature 162 (owner answer Q5) — a carry skip names keys of possibly internal fields: administrators only. */
describe('customerEventsOf — custom-field carry skips', () => {
  it('leaves the custom-field-carry-skipped events out of a customer reply', () => {
    const events = [{ eventType: 'submitted' }, { eventType: 'custom-field-carry-skipped' }] as const;
    expect(customerEventsOf(events).map((e) => e.eventType)).toEqual(['submitted']);
  });
});

/**
 * `specs/192-quote-request-draft-share/` (FR-012, R-14) — the customer's history
 * of an operator quote starts at the share: the creation, the automatic note and
 * every edit made while it was unshared stay the operators'.
 */
describe('customerEventsOf — the history starts at the share', () => {
  const SHARED_AT = new Date('2026-11-20T10:00:00Z');

  it('keeps exactly the events from the `shared` event on for a shared operator quote', () => {
    const events = [
      { id: 'a', eventType: 'created' },
      { id: 'b', eventType: 'note-added' },
      { id: 'c', eventType: 'modified' },
      { id: 'd', eventType: 'shared' },
      { id: 'e', eventType: 'modified' },
      { id: 'f', eventType: 'customer-accepted-revision' },
    ] as const;
    expect(customerEventsOf(events, SHARED_AT).map((e) => e.id)).toEqual(['d', 'e', 'f']);
  });

  it('still leaves the admin-only events out after the share', () => {
    const events = [
      { eventType: 'created' },
      { eventType: 'shared' },
      { eventType: 'pdf-sent' },
      { eventType: 'custom-field-carry-skipped' },
      { eventType: 'approved' },
    ] as const;
    expect(customerEventsOf(events, SHARED_AT).map((e) => e.eventType)).toEqual(['shared', 'approved']);
  });

  it('keeps every customer-visible event of a quote that was never unshared', () => {
    const events = [{ eventType: 'created' }, { eventType: 'note-added' }, { eventType: 'modified' }] as const;
    expect(customerEventsOf(events, null).map((e) => e.eventType)).toEqual(['created', 'note-added', 'modified']);
    expect(customerEventsOf(events).map((e) => e.eventType)).toEqual(['created', 'note-added', 'modified']);
  });

  it('shows nothing from before a share it cannot find (fails closed)', () => {
    const events = [{ eventType: 'created' }, { eventType: 'modified' }] as const;
    expect(customerEventsOf(events, SHARED_AT)).toEqual([]);
  });
});
