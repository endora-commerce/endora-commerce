import { describe, expect, it } from 'vitest';
import { evaluateLinkUsability, type LinkUsabilityInput } from './link-usability.js';

/**
 * FR-012 (and FR-002) — when a payer link may be used for a new order. Table-driven: one
 * row per condition, each flipping exactly one input of a usable baseline.
 */
const A1 = '00000000-0000-4000-8000-0000000000a1';
const A2 = '00000000-0000-4000-8000-0000000000a2';

const usable: LinkUsabilityInput = {
  modulePresent: true,
  channelEnabled: true,
  now: new Date('2026-11-18T12:00:00.000Z'),
  link: { state: 'active', validFrom: null, validTo: null, addressScope: 'all', billingAddressId: null },
  payer: { status: 'active', isPersonal: false, deleted: false },
  payerBillingAddressIds: [A1, A2],
};

function withLink(patch: Partial<LinkUsabilityInput['link']>): LinkUsabilityInput {
  return { ...usable, link: { ...usable.link, ...patch } };
}

describe('evaluateLinkUsability (FR-012)', () => {
  it('a usable link answers the allowed billing addresses', () => {
    expect(evaluateLinkUsability(usable)).toEqual({ usable: true, billingAddressIds: [A1, A2] });
  });

  it.each<[string, LinkUsabilityInput, string]>([
    ['the module is not present', { ...usable, modulePresent: false }, 'module_absent'],
    ['the capability is off on the channel', { ...usable, channelEnabled: false }, 'capability_disabled'],
    ['the link is inactive', withLink({ state: 'inactive' }), 'link_inactive'],
    ['the link is revoked', withLink({ state: 'revoked' }), 'link_revoked'],
    ['before the window', withLink({ validFrom: new Date('2026-11-18T12:00:00.001Z') }), 'outside_window'],
    ['after the window', withLink({ validTo: new Date('2026-11-18T11:59:59.999Z') }), 'outside_window'],
    ['the payer is gone', { ...usable, payer: null }, 'payer_missing'],
    ['the payer is archived', { ...usable, payer: { ...usable.payer!, deleted: true } }, 'payer_missing'],
    ['the payer is blocked', { ...usable, payer: { ...usable.payer!, status: 'blocked' } }, 'payer_not_active'],
    [
      'the payer is pending verification',
      { ...usable, payer: { ...usable.payer!, status: 'pending_verification' } },
      'payer_not_active',
    ],
    ['the payer was rejected', { ...usable, payer: { ...usable.payer!, status: 'rejected' } }, 'payer_not_active'],
    ['the payer is personal', { ...usable, payer: { ...usable.payer!, isPersonal: true } }, 'payer_personal'],
    ['the payer has no billing address', { ...usable, payerBillingAddressIds: [] }, 'no_billing_address'],
    [
      'the one allowed address was deleted',
      { ...withLink({ addressScope: 'one', billingAddressId: '00000000-0000-4000-8000-0000000000a9' }) },
      'no_billing_address',
    ],
  ])('is not usable when %s', (_name, input, reason) => {
    expect(evaluateLinkUsability(input)).toEqual({ usable: false, reason });
  });

  it('the window is two inclusive instants (RP-15), and open ends are unbounded', () => {
    const now = usable.now;
    expect(evaluateLinkUsability(withLink({ validFrom: now, validTo: now })).usable).toBe(true);
    expect(evaluateLinkUsability(withLink({ validFrom: new Date('2026-01-01T00:00:00.000Z') })).usable).toBe(true);
    expect(evaluateLinkUsability(withLink({ validTo: new Date('2026-12-31T23:59:59.999Z') })).usable).toBe(true);
  });

  it('a one-address scope allows exactly that live address', () => {
    expect(evaluateLinkUsability(withLink({ addressScope: 'one', billingAddressId: A2 }))).toEqual({
      usable: true,
      billingAddressIds: [A2],
    });
  });

  it('the first failing condition in FR-012 order is the reason', () => {
    expect(evaluateLinkUsability({ ...usable, channelEnabled: false, payer: null })).toEqual({
      usable: false,
      reason: 'capability_disabled',
    });
  });
});

describe('evaluateLinkUsability — an absent bound', () => {
  it('reads an undefined bound as open, as a hydrated empty column may arrive', () => {
    const input = { ...usable, link: { ...usable.link, validFrom: undefined, validTo: undefined } } as unknown as LinkUsabilityInput;
    expect(evaluateLinkUsability(input).usable).toBe(true);
  });
});
