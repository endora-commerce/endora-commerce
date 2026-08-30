import { describe, expect, it } from 'vitest';
import {
  formatValidityInstant,
  rfqValidity,
  rfqValidityGate,
  validityLabelKey,
} from '../../lib/quote-requests/validity';

/**
 * The buyer's half of the per-request validity deadline (!1137 restored the
 * rule; !1141 did the operator's screen).
 *
 * The classification here has to agree with `RfqService.validityHasLapsed`
 * exactly — `expiresAt != null && expiresAt.getTime() <= nowMs` — because a
 * screen that disagrees with the API by a millisecond produces the outcome this
 * change exists to remove: a control offered and then refused, or a control
 * withheld that would have worked.
 */
const NOW = new Date('2026-08-29T12:00:00.000Z');

describe('rfqValidity', () => {
  it('answers `none` for a request the operator never dated', () => {
    expect(rfqValidity(null, NOW)).toEqual({ kind: 'none' });
    expect(rfqValidity(undefined, NOW)).toEqual({ kind: 'none' });
    expect(rfqValidity('', NOW)).toEqual({ kind: 'none' });
  });

  it('answers `active` while the deadline is still ahead', () => {
    expect(rfqValidity('2026-09-12T12:00:00.000Z', NOW)).toEqual({
      kind: 'active',
      expiresAt: '2026-09-12T12:00:00.000Z',
    });
  });

  it('answers `lapsed` once the deadline has passed', () => {
    expect(rfqValidity('2026-08-12T09:14:00.000Z', NOW)).toEqual({
      kind: 'lapsed',
      expiresAt: '2026-08-12T09:14:00.000Z',
    });
  });

  it('treats the deadline instant itself as lapsed, exactly as the server does', () => {
    // `RfqService.validityHasLapsed` is `<=`, not `<`.
    expect(rfqValidity(NOW.toISOString(), NOW).kind).toBe('lapsed');
    expect(rfqValidity(new Date(NOW.getTime() + 1).toISOString(), NOW).kind).toBe('active');
  });

  it('answers `active` for a timestamp it cannot parse', () => {
    // The screen may not tell a buyer their offer has lapsed unless it can show
    // them the date it lapsed on. The server refuses either way.
    expect(rfqValidity('not-a-date', NOW).kind).toBe('active');
  });
});

describe('validityLabelKey', () => {
  it('says nothing at all when there is no deadline', () => {
    expect(validityLabelKey({ kind: 'none' })).toBeNull();
  });

  it('uses a different sentence once the date is behind us', () => {
    // "expires <date>" reads as a promise the platform has stopped keeping.
    expect(validityLabelKey({ kind: 'active', expiresAt: 'x' })).toBe(
      'quoteRequests.validity.validUntil',
    );
    expect(validityLabelKey({ kind: 'lapsed', expiresAt: 'x' })).toBe(
      'quoteRequests.validity.endedOn',
    );
  });
});

describe('rfqValidityGate', () => {
  const lapsed = { kind: 'lapsed', expiresAt: '2026-08-12T09:14:00.000Z' } as const;
  const active = { kind: 'active', expiresAt: '2026-09-12T09:14:00.000Z' } as const;
  const none = { kind: 'none' } as const;

  it('blocks accept-revision on a lapsed offer awaiting the buyer', () => {
    const gate = rfqValidityGate({
      status: 'Pending',
      awaitingCustomerRevisionAcceptance: true,
      validity: lapsed,
    });
    expect(gate.acceptBlocked).toBe(true);
    expect(gate.convertBlocked).toBe(false);
    expect(gate.noticeKey).toBe('quoteRequests.validity.acceptBlocked');
  });

  it('blocks place-order on a lapsed approved quote', () => {
    const gate = rfqValidityGate({
      status: 'Approved',
      awaitingCustomerRevisionAcceptance: false,
      validity: lapsed,
    });
    expect(gate.convertBlocked).toBe(true);
    expect(gate.acceptBlocked).toBe(false);
    // The dead-end sentence, which names `resubmit` rather than an extension
    // the buyer cannot get: `modify` refuses any status but Pending and
    // Created from admin.
    expect(gate.noticeKey).toBe('quoteRequests.validity.convertBlocked');
  });

  it('blocks nothing while the deadline is ahead', () => {
    for (const status of ['Pending', 'Approved'] as const) {
      const gate = rfqValidityGate({
        status,
        awaitingCustomerRevisionAcceptance: status === 'Pending',
        validity: active,
      });
      expect(gate).toEqual({ acceptBlocked: false, convertBlocked: false, noticeKey: null });
    }
  });

  it('blocks nothing at all on a request that carries no deadline', () => {
    const gate = rfqValidityGate({
      status: 'Approved',
      awaitingCustomerRevisionAcceptance: false,
      validity: none,
    });
    expect(gate).toEqual({ acceptBlocked: false, convertBlocked: false, noticeKey: null });
  });

  it('says nothing on a lapsed request whose status the deadline decides nothing for', () => {
    // The two gated routes are unreachable here, so a warning would be crying
    // wolf — the same three statuses !1141 chose for the operator's banner,
    // arrived at from the controls rather than from a status list.
    for (const status of ['Canceled', 'Completed', 'Expired'] as const) {
      const gate = rfqValidityGate({
        status,
        awaitingCustomerRevisionAcceptance: false,
        validity: lapsed,
      });
      expect(gate.noticeKey).toBeNull();
      expect(gate.acceptBlocked).toBe(false);
      expect(gate.convertBlocked).toBe(false);
    }
  });
});

describe('formatValidityInstant', () => {
  it('renders the time of day, not the date alone', () => {
    // `expiresAt` is `now + days * 86_400_000`, so it rarely lands on midnight:
    // "valid until 12.09.2026" for an offer that lapses at 09:14 that morning
    // is the same defect as not rendering it.
    const rendered = formatValidityInstant('2026-09-12T09:14:00.000Z', 'en-US');
    expect(rendered).toMatch(/\d{1,2}:\d{2}/);
    expect(rendered).toContain('2026');
  });

  it('hands back the raw value rather than "Invalid Date" for input it cannot parse', () => {
    expect(formatValidityInstant('not-a-date', 'en-US')).toBe('not-a-date');
  });
});
