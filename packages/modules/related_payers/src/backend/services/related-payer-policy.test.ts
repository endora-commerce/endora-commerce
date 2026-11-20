import { describe, expect, it } from 'vitest';
import type { AddressRecord, OrganizationRecord } from '@endora-commerce/contracts';
import { RelatedPayerLinkCache } from './link-cache.js';
import { RelatedPayerPolicyService, type CachedLink } from './related-payer-policy.js';

/**
 * `specs/182-related-payers/` T025 — `relatedPayerPolicyPort` over in-memory stand-ins
 * (FR-012, FR-060, FR-063). What is under test is the decision, not the reads: the
 * channel setting, the person's organization permission, the link's usability and the
 * payer's allowed live billing addresses.
 */
const X = '00000000-0000-4000-8000-0000000000b1';
const Y = '00000000-0000-4000-8000-0000000000b2';
const PERSON = '00000000-0000-4000-8000-0000000000c1';
const CHANNEL = '00000000-0000-4000-8000-0000000000d1';
const A1 = '00000000-0000-4000-8000-0000000000a1';
const A2 = '00000000-0000-4000-8000-0000000000a2';
const SUBJECT = { buyerOrganizationId: X, customerAccountId: PERSON, salesChannelId: CHANNEL };

type Link = CachedLink & { organizationId: string };

function link(over: Partial<Link> = {}): Link {
  return {
    id: '00000000-0000-4000-8000-0000000000e1',
    organizationId: X,
    payerOrganizationId: Y,
    state: 'active',
    addressScope: 'all',
    billingAddressId: null,
    validFrom: null,
    validTo: null,
    commercialTerms: 'buyer',
    ...over,
  };
}

function harness(options: {
  links?: Link[];
  channelEnabled?: boolean;
  canOrderWithPayer?: boolean;
  payer?: Partial<OrganizationRecord> | null;
  billing?: Array<Partial<AddressRecord>>;
} = {}) {
  const links = options.links ?? [link()];
  const reads = { links: 0, permissions: [] as string[] };
  const addressRecords = (options.billing ?? [
    { id: A1, kind: 'billing', deletedAt: null },
    { id: A2, kind: 'billing', deletedAt: null },
  ]) as AddressRecord[];
  const em = {
    find: async (_e: unknown, where: Record<string, unknown>) => {
      reads.links += 1;
      return links.filter((l) => Object.entries(where).every(([k, v]) => (l as unknown as Record<string, unknown>)[k] === v));
    },
    findOne: async (_e: unknown, where: Record<string, unknown>) =>
      links.find((l) => Object.entries(where).every(([k, v]) => (l as unknown as Record<string, unknown>)[k] === v)) ?? null,
  };
  const service = new RelatedPayerPolicyService({
    emFactory: () => em as never,
    now: () => new Date('2026-11-18T12:00:00.000Z'),
    cache: new RelatedPayerLinkCache<CachedLink>(),
    channelEnabled: async () => options.channelEnabled ?? true,
    permissions: {
      can: async (_subject, code) => {
        reads.permissions.push(code);
        return options.canOrderWithPayer ?? true;
      },
    },
    organizations: {
      findById: async (id: string) =>
        options.payer === null
          ? null
          : ({ id, name: 'Payer SA', taxId: 'PL1234567890', status: 'active', isPersonal: false, deletedAt: null, customerGroupId: 'g1', ...options.payer } as OrganizationRecord),
    },
    addresses: {
      listForOrganization: async (orgId: string, kind?: string) =>
        orgId === Y ? addressRecords.filter((a) => (kind ? a.kind === kind : true) && !a.deletedAt) : [],
      findByIds: async (orgId: string, ids: readonly string[]) =>
        orgId === Y ? addressRecords.filter((a) => ids.includes(a.id)) : [],
    },
  });
  return { service, reads };
}

async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
  try {
    await promise;
  } catch (error) {
    const e = error as { statusCode?: number; code?: string };
    return { statusCode: e.statusCode ?? 0, code: e.code ?? '' };
  }
  throw new Error('expected a refusal');
}

describe('RelatedPayerPolicyService (relatedPayerPolicyPort)', () => {
  it('usablePayers answers the usable payers with their allowed billing addresses', async () => {
    const { service, reads } = harness();
    expect(await service.usablePayers(SUBJECT)).toEqual([
      {
        linkId: link().id,
        payerOrganizationId: Y,
        payerName: 'Payer SA',
        payerTaxId: 'PL1234567890',
        commercialTerms: 'buyer',
        billingAddressIds: [A1, A2],
      },
    ]);
    expect(reads.permissions).toEqual(['related_payers.order_with_payer']);
  });

  it('usablePayers is empty when the capability is off on the channel (FR-002)', async () => {
    expect(await harness({ channelEnabled: false }).service.usablePayers(SUBJECT)).toEqual([]);
  });

  it('usablePayers is empty when the person lacks related_payers.order_with_payer (FR-060)', async () => {
    expect(await harness({ canOrderWithPayer: false }).service.usablePayers(SUBJECT)).toEqual([]);
  });

  it('usablePayers leaves out a link that is not usable (FR-012)', async () => {
    expect(await harness({ links: [link({ state: 'inactive' })] }).service.usablePayers(SUBJECT)).toEqual([]);
    expect(await harness({ payer: { status: 'blocked' } }).service.usablePayers(SUBJECT)).toEqual([]);
    expect(
      await harness({ links: [link({ validTo: new Date('2026-11-18T11:00:00.000Z') })] }).service.usablePayers(SUBJECT),
    ).toEqual([]);
  });

  it('assertUsable refuses a payer that is not usable, and every FR-068 reason the same way', async () => {
    const expected = { statusCode: 422, code: 'RELATED_PAYER_NOT_USABLE' };
    expect(await refusal(harness({ channelEnabled: false }).service.assertUsable(SUBJECT, Y))).toEqual(expected);
    expect(await refusal(harness({ canOrderWithPayer: false }).service.assertUsable(SUBJECT, Y))).toEqual(expected);
    expect(await refusal(harness({ links: [link({ state: 'revoked' })] }).service.assertUsable(SUBJECT, Y))).toEqual(expected);
    expect(await refusal(harness({ links: [] }).service.assertUsable(SUBJECT, Y))).toEqual(expected);
    expect(await refusal(harness({ payer: { status: 'blocked' } }).service.assertUsable(SUBJECT, Y))).toEqual(expected);
  });

  it('assertUsable refuses an address outside the link scope as an address not owned (FR-063)', async () => {
    const { service } = harness({ links: [link({ addressScope: 'one', billingAddressId: A1 })] });
    expect((await service.assertUsable(SUBJECT, Y, { billingAddressId: A1 })).billingAddressIds).toEqual([A1]);
    expect(await refusal(service.assertUsable(SUBJECT, Y, { billingAddressId: A2 }))).toEqual({
      statusCode: 403,
      code: 'ADDRESS_NOT_OWNED',
    });
  });

  it('assertUsable reads the link afresh, never from the cache (placement re-checks, FR-116)', async () => {
    const { service, reads } = harness();
    await service.usablePayers(SUBJECT);
    const before = reads.links;
    await service.assertUsable(SUBJECT, Y);
    await service.assertUsable(SUBJECT, Y);
    expect(reads.links).toBe(before + 2);
  });

  it('payerBillingAddresses returns only the allowed live billing addresses', async () => {
    const { service } = harness({
      links: [link({ addressScope: 'all' })],
      billing: [
        { id: A1, kind: 'billing', deletedAt: null },
        { id: A2, kind: 'delivery', deletedAt: null },
      ],
    });
    expect((await service.payerBillingAddresses(SUBJECT, Y)).map((a) => a.id)).toEqual([A1]);
    const one = harness({ links: [link({ addressScope: 'one', billingAddressId: A2 })] });
    expect((await one.service.payerBillingAddresses(SUBJECT, Y)).map((a) => a.id)).toEqual([A2]);
  });

  it('pricingContext names the payer only on the payer terms', async () => {
    expect(await harness().service.pricingContext(SUBJECT, Y)).toBeNull();
    expect(await harness({ links: [link({ commercialTerms: 'payer' })] }).service.pricingContext(SUBJECT, Y)).toEqual({
      organizationId: Y,
      customerGroupId: 'g1',
    });
  });

  it('hasPayerTermsLinks answers from the cache after the first read', async () => {
    const { service, reads } = harness({ links: [link({ commercialTerms: 'payer' })] });
    expect(await service.hasPayerTermsLinks(X, CHANNEL)).toBe(true);
    const after = reads.links;
    expect(await service.hasPayerTermsLinks(X, CHANNEL)).toBe(true);
    expect(reads.links).toBe(after);
    expect(await harness().service.hasPayerTermsLinks(X, CHANNEL)).toBe(false);
    expect(await harness({ channelEnabled: false, links: [link({ commercialTerms: 'payer' })] }).service.hasPayerTermsLinks(X, CHANNEL)).toBe(false);
  });
});
