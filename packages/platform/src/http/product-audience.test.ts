import { describe, expect, it } from 'vitest';
import type { FastifyReply } from 'fastify';
import { markPersonalisedPricing } from './product-audience.js';

/**
 * Feature 163 (security review, checkpoint B) — a response is personalised as
 * soon as the caller is identified, not only once the caller names an
 * Organization: `logged_in_only` products answer an authenticated caller with
 * no Organization differently from the public, so that answer must not enter a
 * shared cache either.
 */
function replyStub(): { reply: FastifyReply; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const reply = {
    header(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return reply;
    },
  } as unknown as FastifyReply;
  return { reply, headers };
}

describe('markPersonalisedPricing', () => {
  it('leaves the anonymous answer unstamped', () => {
    const { reply, headers } = replyStub();
    markPersonalisedPricing(reply, { organizationId: null, authenticated: false });
    expect(headers['cache-control']).toBeUndefined();
  });

  it('stamps an authenticated caller with no Organization', () => {
    const { reply, headers } = replyStub();
    markPersonalisedPricing(reply, { organizationId: null, authenticated: true });
    expect(headers['cache-control']).toBe('private, no-store');
  });

  it('stamps a caller acting for an Organization', () => {
    const { reply, headers } = replyStub();
    markPersonalisedPricing(reply, { organizationId: 'org-1', authenticated: true });
    expect(headers['cache-control']).toBe('private, no-store');
  });
});

/**
 * `specs/182-related-payers/` T053 (FR-111, FR-115, research R-4) — the priced audience: the
 * product audience plus, when the one pricing-subject contributor is present and names an
 * Organization, `pricingOrganizationId`. Visibility still reads `organizationId`.
 */
describe('pricedAudienceOf', async () => {
  const { pricedAudienceOf, productAudienceOf, providePricingSubjectResolver } = await import('./product-audience.js');
  const customer = { actor: { kind: 'customer', customerAccountId: 'acc-1', organizationId: 'org-x' } } as never;
  const admin = { actor: { kind: 'admin', adminUserId: 'adm-1' } } as never;
  const anonymous = { actor: undefined } as never;

  it('equals productAudienceOf when no contributor is registered', async () => {
    expect(await pricedAudienceOf(customer)).toEqual(productAudienceOf(customer));
  });

  it('adds pricingOrganizationId from a present contributor', async () => {
    const release = providePricingSubjectResolver('carts', async () => 'org-y', () => true);
    try {
      expect(await pricedAudienceOf(customer)).toEqual({ ...productAudienceOf(customer), pricingOrganizationId: 'org-y' });
    } finally {
      release();
    }
  });

  it('names no subject when the contributor answers nothing or is absent', async () => {
    let release = providePricingSubjectResolver('carts', async () => null, () => true);
    expect(await pricedAudienceOf(customer)).toEqual(productAudienceOf(customer));
    release();
    release = providePricingSubjectResolver('carts', async () => 'org-y', () => false);
    expect(await pricedAudienceOf(customer)).toEqual(productAudienceOf(customer));
    release();
  });

  it('never asks the resolver for an anonymous or admin actor', async () => {
    let asked = 0;
    const release = providePricingSubjectResolver(
      'carts',
      async () => {
        asked += 1;
        return 'org-y';
      },
      () => true,
    );
    try {
      expect(await pricedAudienceOf(anonymous)).toEqual(productAudienceOf(anonymous));
      expect(await pricedAudienceOf(admin)).toEqual(productAudienceOf(admin));
      expect(asked).toBe(0);
    } finally {
      release();
    }
  });
});
