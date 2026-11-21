import { describe, expect, expectTypeOf, it } from 'vitest';
import { ERROR_CODES } from './errors.js';
import {
  RELATED_PAYERS_HOOKABLE_ACTIONS,
  RELATED_PAYERS_DEFAULT_TIME_ZONE,
  adminCreateRequestOrganizationBodySchema,
  relatedPayerInvitationLookupResponseSchema,
  relatedPayersAvailabilityResponseSchema,
  adminRelatedPayerRequestsQuerySchema,
  adminRelatedPayerRequestsResponseSchema,
  addPayerInputSchema,
  adminCreatePayerOrganizationBodySchema,
  checkoutPayerSchema,
  adminAddRelatedPayerBodySchema,
  adminUpdateRelatedPayerLinkBodySchema,
  createRelatedPayerRequestBodySchema,
  payerCommercialTermsSchema,
  rejectRelatedPayerRequestBodySchema,
  RELATED_PAYER_COMMENT_MAX,
  RELATED_PAYER_CONTACT_EMAIL_MAX,
  RELATED_PAYER_SOURCE_PATTERN,
  RELATED_PAYERS_ORGANIZATION_PERMISSIONS,
  RELATED_PAYERS_OPERATOR_PERMISSIONS,
  RELATED_PAYERS_SETTING_CODES,
  RELATED_PAYERS_SETTING_DEFAULTS,
  relatedPayerAcceptedRequestResponseSchema,
  relatedPayerApprovalModeSchema,
  relatedPayerDailyRequestLimitSchema,
  relatedPayerLinkSchema,
  relatedPayerLinkStateSchema,
  relatedPayerOperatorReasonSchema,
  relatedPayerRequestRoutingSchema,
  relatedPayerRequestStateSchema,
  relatedPayerRequestTtlDaysSchema,
  relatedPayerSentRequestSchema,
  relatedPayerUnregisteredModeSchema,
  revokePayerInputSchema,
  type AddPayerInput,
  type PayerCommercialTerms,
  type RelatedPayerPolicyPort,
  type RelatedPayerWritePort,
} from './related-payers.js';

/**
 * `specs/182-related-payers/` — the module's contract shapes (Principle II),
 * written before anything implements them. Each block names the requirement it
 * holds the shape to.
 */

const BUYER = '00000000-0000-4000-8000-0000000000b1';
const PAYER = '00000000-0000-4000-8000-0000000000b2';
const ADDRESS = '00000000-0000-4000-8000-0000000000a1';

describe('createRelatedPayerRequestBodySchema — the sender body (FR-040, FR-041)', () => {
  const body = { taxId: 'PL 123-456-78-90', contactEmail: 'ap@payer.example', comment: 'Please' };

  it('normalises the tax ID the way an Organization tax ID is normalised', () => {
    expect(createRelatedPayerRequestBodySchema.parse(body).taxId).toBe('PL1234567890');
  });

  it('bounds the tax ID to the stored length (8–32 after normalisation)', () => {
    expect(createRelatedPayerRequestBodySchema.safeParse({ ...body, taxId: '12-34' }).success).toBe(false);
    expect(createRelatedPayerRequestBodySchema.safeParse({ ...body, taxId: 'X'.repeat(33) }).success).toBe(false);
    expect(createRelatedPayerRequestBodySchema.safeParse({ ...body, taxId: '--------' }).success).toBe(false);
  });

  it('requires a contact e-mail, trimmed, of a deliverable length', () => {
    expect(createRelatedPayerRequestBodySchema.parse({ ...body, contactEmail: '  ap@payer.example ' }).contactEmail).toBe(
      'ap@payer.example',
    );
    expect(createRelatedPayerRequestBodySchema.safeParse({ ...body, contactEmail: 'not-an-email' }).success).toBe(false);
    const long = `${'a'.repeat(RELATED_PAYER_CONTACT_EMAIL_MAX)}@x.example`;
    expect(createRelatedPayerRequestBodySchema.safeParse({ ...body, contactEmail: long }).success).toBe(false);
    const { contactEmail: _omitted, ...withoutEmail } = body;
    expect(createRelatedPayerRequestBodySchema.safeParse(withoutEmail).success).toBe(false);
  });

  it('takes an optional comment up to its bound', () => {
    const { comment: _omitted, ...withoutComment } = body;
    expect(createRelatedPayerRequestBodySchema.safeParse(withoutComment).success).toBe(true);
    expect(
      createRelatedPayerRequestBodySchema.safeParse({ ...body, comment: 'c'.repeat(RELATED_PAYER_COMMENT_MAX) }).success,
    ).toBe(true);
    expect(
      createRelatedPayerRequestBodySchema.safeParse({ ...body, comment: 'c'.repeat(RELATED_PAYER_COMMENT_MAX + 1) })
        .success,
    ).toBe(false);
  });

  it('refuses commercial terms and routing from a customer (RP-11, FR-119)', () => {
    expect(createRelatedPayerRequestBodySchema.safeParse({ ...body, commercialTerms: 'payer' }).success).toBe(false);
    expect(createRelatedPayerRequestBodySchema.safeParse({ ...body, routing: 'operator' }).success).toBe(false);
  });
});

describe('relatedPayerAcceptedRequestResponseSchema — one reply whatever the lookup found (FR-041)', () => {
  it('is the sender row id and pending, nothing else', () => {
    const reply = { data: { id: BUYER, state: 'pending' } };
    expect(relatedPayerAcceptedRequestResponseSchema.parse(reply)).toEqual(reply);
    expect(relatedPayerAcceptedRequestResponseSchema.safeParse({ data: { id: BUYER, state: 'active' } }).success).toBe(
      false,
    );
    expect(Object.keys(relatedPayerAcceptedRequestResponseSchema.shape.data.shape).sort()).toEqual(['id', 'state']);
  });
});

describe('relatedPayerSentRequestSchema — the sender view leaks no lookup outcome (FR-041, R-8)', () => {
  const sent = {
    id: BUYER,
    direction: 'buyer_request',
    taxId: 'PL1234567890',
    contactEmail: 'ap@payer.example',
    comment: null,
    state: 'pending',
    rejectionReason: null,
    createdAt: '2026-11-18T10:00:00.000Z',
    decidedAt: null,
    expiresAt: '2026-12-18T10:00:00.000Z',
  };

  it('has no counterparty, routing or operator reason in its shape', () => {
    const keys = Object.keys(relatedPayerSentRequestSchema.shape);
    for (const hidden of ['counterpartyOrganizationId', 'routing', 'operatorReason', 'counterpartyName']) {
      expect(keys).not.toContain(hidden);
    }
  });

  it('drops them when a serialiser hands them over by mistake', () => {
    const parsed = relatedPayerSentRequestSchema.parse({
      ...sent,
      counterpartyOrganizationId: PAYER,
      routing: 'operator',
      operatorReason: 'ambiguous_tax_id',
    });
    expect(parsed).toEqual(sent);
  });

  it('answers the request states only — never an intermediate routing state', () => {
    expect(relatedPayerSentRequestSchema.safeParse({ ...sent, state: 'awaiting_registration' }).success).toBe(false);
    expect(relatedPayerRequestStateSchema.options).toEqual(['pending', 'active', 'rejected', 'expired', 'withdrawn']);
  });
});

describe('request vocabularies (data-model §2)', () => {
  it('routing and operator reasons', () => {
    expect(relatedPayerRequestRoutingSchema.options).toEqual(['counterparty', 'operator', 'awaiting_registration']);
    expect(relatedPayerOperatorReasonSchema.options).toEqual([
      'approval_mode_admin',
      'second_step',
      'no_eligible_approver',
      'no_account',
      'ambiguous_tax_id',
      'ineligible',
    ]);
  });

  it('a rejection reason is optional and bounded', () => {
    expect(rejectRelatedPayerRequestBodySchema.safeParse({}).success).toBe(true);
    expect(rejectRelatedPayerRequestBodySchema.safeParse({ reason: 'r'.repeat(RELATED_PAYER_COMMENT_MAX + 1) }).success).toBe(
      false,
    );
    expect(rejectRelatedPayerRequestBodySchema.safeParse({ commercialTerms: 'payer' }).success).toBe(false);
  });
});

describe('relatedPayerLinkSchema (FR-011, data-model §1)', () => {
  const link = {
    id: '00000000-0000-4000-8000-0000000000c1',
    buyerOrganizationId: BUYER,
    buyerName: 'Buyer Ltd',
    payerOrganizationId: PAYER,
    payerName: 'Payer SA',
    payerTaxId: 'PL1234567890',
    buyerTaxId: 'PL9876543210',
    state: 'active',
    addressScope: 'all',
    billingAddressId: null,
    validFrom: null,
    validTo: null,
    commercialTerms: 'buyer',
    notifyPayerOnOrders: false,
    origin: 'operator',
    originSource: null,
    revokedAt: null,
    revokedByKind: null,
    version: 1,
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:00:00.000Z',
  };

  it('names the buyer\'s tax ID too, so the payer\'s list of buyers shows it (RP-20 d)', () => {
    expect(relatedPayerLinkSchema.parse(link).buyerTaxId).toBe('PL9876543210');
    expect(relatedPayerLinkSchema.safeParse({ ...link, buyerTaxId: undefined }).success).toBe(false);
  });

  it('parses an active link over all billing addresses', () => {
    expect(relatedPayerLinkSchema.parse(link)).toEqual(link);
  });

  it('states are active, inactive and revoked', () => {
    expect(relatedPayerLinkStateSchema.options).toEqual(['active', 'inactive', 'revoked']);
    expect(relatedPayerLinkSchema.safeParse({ ...link, state: 'pending' }).success).toBe(false);
  });

  it('pairs the address scope with the billing address: one ⇔ an address', () => {
    expect(relatedPayerLinkSchema.safeParse({ ...link, addressScope: 'one', billingAddressId: ADDRESS }).success).toBe(true);
    expect(relatedPayerLinkSchema.safeParse({ ...link, addressScope: 'one', billingAddressId: null }).success).toBe(false);
    expect(relatedPayerLinkSchema.safeParse({ ...link, addressScope: 'all', billingAddressId: ADDRESS }).success).toBe(false);
  });

  it('commercial terms are buyer or payer', () => {
    expect(payerCommercialTermsSchema.options).toEqual(['buyer', 'payer']);
    expect(relatedPayerLinkSchema.safeParse({ ...link, commercialTerms: 'payer' }).success).toBe(true);
    expect(relatedPayerLinkSchema.safeParse({ ...link, commercialTerms: 'mixed' }).success).toBe(false);
  });

  it('the window is two optional instants, from not after to (RP-15)', () => {
    const from = '2026-01-01T00:00:00.000+01:00';
    const to = '2026-12-31T23:59:59.999+01:00';
    expect(relatedPayerLinkSchema.safeParse({ ...link, validFrom: from, validTo: null }).success).toBe(true);
    expect(relatedPayerLinkSchema.safeParse({ ...link, validFrom: null, validTo: to }).success).toBe(true);
    expect(relatedPayerLinkSchema.safeParse({ ...link, validFrom: from, validTo: from }).success).toBe(true);
    // Compared as instants, not as strings: 23:30Z is after 00:00+01:00 on the same "date".
    expect(
      relatedPayerLinkSchema.safeParse({ ...link, validFrom: '2026-02-01T00:30:00.000+01:00', validTo: '2026-01-31T23:45:00.000Z' })
        .success,
    ).toBe(true);
    expect(
      relatedPayerLinkSchema.safeParse({ ...link, validFrom: '2026-02-01T00:00:00.000Z', validTo: '2026-01-31T23:59:59.000Z' })
        .success,
    ).toBe(false);
    // A bare calendar date is no longer a window bound.
    expect(relatedPayerLinkSchema.safeParse({ ...link, validFrom: '2026-01-01' }).success).toBe(false);
  });
});

describe('admin link writes — the operator may set commercial terms (FR-021, FR-119)', () => {
  it('adds a payer with a scope, a window and terms', () => {
    const parsed = adminAddRelatedPayerBodySchema.parse({
      payerOrganizationId: PAYER,
      addressScope: { kind: 'one', billingAddressId: ADDRESS },
      validFrom: '2026-01-01T00:00:00.000Z',
      commercialTerms: 'payer',
    });
    expect(parsed.commercialTerms).toBe('payer');
    expect(parsed.addressScope).toEqual({ kind: 'one', billingAddressId: ADDRESS });
  });

  it('defaults to every billing address and the buyer terms', () => {
    const parsed = adminAddRelatedPayerBodySchema.parse({ payerOrganizationId: PAYER });
    expect(parsed.addressScope).toEqual({ kind: 'all' });
    expect(parsed.commercialTerms).toBe('buyer');
    expect(parsed.notifyPayerOnOrders).toBe(false);
  });

  it('a one-address scope without an address is refused', () => {
    expect(
      adminAddRelatedPayerBodySchema.safeParse({ payerOrganizationId: PAYER, addressScope: { kind: 'one' } }).success,
    ).toBe(false);
  });

  it('an update changes something, and may set a state but never revoke', () => {
    expect(adminUpdateRelatedPayerLinkBodySchema.safeParse({}).success).toBe(false);
    expect(adminUpdateRelatedPayerLinkBodySchema.safeParse({ commercialTerms: 'payer' }).success).toBe(true);
    expect(adminUpdateRelatedPayerLinkBodySchema.safeParse({ state: 'inactive' }).success).toBe(true);
    expect(adminUpdateRelatedPayerLinkBodySchema.safeParse({ state: 'revoked' }).success).toBe(false);
    expect(
      adminUpdateRelatedPayerLinkBodySchema
        .safeParse({ validFrom: '2026-03-01T00:00:00.000Z', validTo: '2026-02-01T00:00:00.000Z' }).success,
    ).toBe(false);
  });
});

describe('the six settings (FR-003, data-model §6)', () => {
  it('codes and defaults', () => {
    expect(RELATED_PAYERS_SETTING_CODES).toEqual({
      MODULE_ENABLED: 'related_payers.module_enabled',
      ENABLED: 'related_payers.enabled',
      APPROVAL_MODE: 'related_payers.approval_mode',
      UNREGISTERED_PAYER_MODE: 'related_payers.unregistered_payer_mode',
      PAYER_MAY_INVITE_BUYERS: 'related_payers.payer_may_invite_buyers',
      REQUEST_TTL_DAYS: 'related_payers.request_ttl_days',
      DAILY_REQUEST_LIMIT: 'related_payers.daily_request_limit',
      TIME_ZONE: 'related_payers.time_zone',
    });
    expect(RELATED_PAYERS_SETTING_DEFAULTS).toEqual({
      'related_payers.enabled': false,
      'related_payers.approval_mode': 'payer',
      'related_payers.unregistered_payer_mode': 'admin',
      'related_payers.payer_may_invite_buyers': true,
      'related_payers.request_ttl_days': 30,
      'related_payers.daily_request_limit': 10,
    });
  });

  it('enums', () => {
    expect(relatedPayerApprovalModeSchema.options).toEqual(['payer', 'admin', 'payer_then_admin']);
    expect(relatedPayerUnregisteredModeSchema.options).toEqual(['invite', 'admin']);
  });

  it('ranges: lifetime 1–365 days, daily limit 1–1000, whole numbers', () => {
    expect(relatedPayerRequestTtlDaysSchema.safeParse(1).success).toBe(true);
    expect(relatedPayerRequestTtlDaysSchema.safeParse(365).success).toBe(true);
    expect(relatedPayerRequestTtlDaysSchema.safeParse(0).success).toBe(false);
    expect(relatedPayerRequestTtlDaysSchema.safeParse(366).success).toBe(false);
    expect(relatedPayerRequestTtlDaysSchema.safeParse(1.5).success).toBe(false);
    expect(relatedPayerDailyRequestLimitSchema.safeParse(1).success).toBe(true);
    expect(relatedPayerDailyRequestLimitSchema.safeParse(1000).success).toBe(true);
    expect(relatedPayerDailyRequestLimitSchema.safeParse(0).success).toBe(false);
    expect(relatedPayerDailyRequestLimitSchema.safeParse(1001).success).toBe(false);
  });
});

describe('permission codes (FR-024, data-model §7)', () => {
  it('organization and operator vocabularies', () => {
    expect(RELATED_PAYERS_ORGANIZATION_PERMISSIONS).toEqual({
      MANAGE: 'related_payers.manage',
      APPROVE: 'related_payers.approve',
      ORDER_WITH_PAYER: 'related_payers.order_with_payer',
      VIEW_PAID_ORDERS: 'related_payers.view_paid_orders',
    });
    expect(RELATED_PAYERS_OPERATOR_PERMISSIONS).toEqual({
      READ: 'related_payers:read',
      MANAGE: 'related_payers:manage',
    });
  });
});

describe('addPayerInputSchema — the automation port (FR-030, ports.md §2)', () => {
  const input = { buyerOrganizationId: BUYER, payerOrganizationId: PAYER, source: 'erp.sync-1' };

  it('requires a source code matching ^[a-z0-9_.-]{1,64}$', () => {
    expect(RELATED_PAYER_SOURCE_PATTERN.source).toBe('^[a-z0-9_.-]{1,64}$');
    expect(addPayerInputSchema.safeParse(input).success).toBe(true);
    expect(addPayerInputSchema.safeParse({ ...input, source: 'a'.repeat(64) }).success).toBe(true);
    for (const bad of ['', 'a'.repeat(65), 'ERP', 'erp sync', 'erp/sync', 'zażółć']) {
      expect(addPayerInputSchema.safeParse({ ...input, source: bad }).success, bad).toBe(false);
    }
    expect(revokePayerInputSchema.safeParse({ ...input, source: 'ERP' }).success).toBe(false);
  });

  it('allows commercial terms through the port (RP-11)', () => {
    expect(addPayerInputSchema.parse({ ...input, commercialTerms: 'payer' }).commercialTerms).toBe('payer');
  });

  it('refuses a pair naming one Organization twice (FR-010)', () => {
    expect(addPayerInputSchema.safeParse({ ...input, payerOrganizationId: BUYER }).success).toBe(false);
  });

  it('types match ports.md', () => {
    expectTypeOf<AddPayerInput['commercialTerms']>().toEqualTypeOf<PayerCommercialTerms | undefined>();
    expectTypeOf<RelatedPayerWritePort['addPayer']>().returns.resolves.toEqualTypeOf<{
      linkId: string;
      created: boolean;
    }>();
    expectTypeOf<RelatedPayerWritePort['revokePayer']>().returns.resolves.toEqualTypeOf<{ revoked: boolean }>();
    expectTypeOf<RelatedPayerPolicyPort['hasPayerTermsLinks']>().returns.resolves.toEqualTypeOf<boolean>();
    expectTypeOf<RelatedPayerPolicyPort['pricingContext']>().returns.resolves.toEqualTypeOf<{
      organizationId: string;
      customerGroupId: string | null;
    } | null>();
  });
});

describe('customer-facing writes carry no commercial terms (FR-119)', () => {
  it('no customer body declares commercialTerms', () => {
    for (const schema of [createRelatedPayerRequestBodySchema, rejectRelatedPayerRequestBodySchema]) {
      expect(Object.keys(schema.shape)).not.toContain('commercialTerms');
    }
  });
});

describe('adminCreatePayerOrganizationBodySchema (FR-021)', () => {
  const organization = {
    name: 'Payer SA',
    taxId: 'PL 123-456-78-90',
    registeredAddress: { street: 'Prosta 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
    salesChannelIds: [PAYER],
  };

  it('creates as the admin form does, and defaults the link to the buyer terms', () => {
    const parsed = adminCreatePayerOrganizationBodySchema.parse({ organization });
    expect(parsed.organization.taxId).toBe('PL1234567890');
    expect(parsed.link).toEqual({ commercialTerms: 'buyer', notifyPayerOnOrders: false });
  });

  it('cannot choose the status, a parent, or an address scope', () => {
    expect(
      adminCreatePayerOrganizationBodySchema.safeParse({ organization: { ...organization, status: 'pending_verification' } })
        .success,
    ).toBe(false);
    expect(adminCreatePayerOrganizationBodySchema.safeParse({ organization: { ...organization, parentId: PAYER } }).success).toBe(
      false,
    );
    expect(
      adminCreatePayerOrganizationBodySchema.safeParse({ organization, link: { addressScope: { kind: 'all' } } }).success,
    ).toBe(false);
  });
});

describe('error codes minted with their first raise site (Phase 1)', () => {
  it('LINK_EXISTS and INVALID_PAIR are in the platform vocabulary', () => {
    expect(ERROR_CODES.RELATED_PAYER_LINK_EXISTS).toBe('RELATED_PAYER_LINK_EXISTS');
    expect(ERROR_CODES.RELATED_PAYER_INVALID_PAIR).toBe('RELATED_PAYER_INVALID_PAIR');
  });
});

describe('checkoutPayerSchema — the payer\'s available credit (RP-16 c)', () => {
  const base = {
    payerOrganizationId: PAYER,
    name: 'Payer SA',
    taxId: 'PL1234567890',
    commercialTerms: 'buyer',
    billingAddresses: [],
    paymentMethodIds: null,
  };
  it('carries the available credit, or null without a grant', () => {
    expect(checkoutPayerSchema.parse({ ...base, creditAvailable: 120.5 }).creditAvailable).toBe(120.5);
    expect(checkoutPayerSchema.parse({ ...base, creditAvailable: null }).creditAvailable).toBeNull();
    expect(checkoutPayerSchema.safeParse(base).success).toBe(false);
  });
});

describe('Phase 5 — the operator queue query and the outbox actions (T080 – T082)', () => {
  it('the queue query takes a state, a reason, a channel and a page, and nothing else', () => {
    expect(adminRelatedPayerRequestsQuerySchema.parse({ state: 'pending', reason: 'second_step' })).toEqual({
      state: 'pending',
      reason: 'second_step',
      page: 1,
    });
    expect(adminRelatedPayerRequestsQuerySchema.safeParse({ reason: 'anything' }).success).toBe(false);
    expect(adminRelatedPayerRequestsQuerySchema.safeParse({ routing: 'operator' }).success).toBe(false);
  });

  it('pages the queue from the query string: one-based page, at most 200 a page (UX audit DS-05, #1439)', () => {
    expect(adminRelatedPayerRequestsQuerySchema.parse({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 });
    expect(adminRelatedPayerRequestsQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(adminRelatedPayerRequestsQuerySchema.safeParse({ pageSize: '201' }).success).toBe(false);
    expect(adminRelatedPayerRequestsQuerySchema.safeParse({ pageSize: '1.5' }).success).toBe(false);
  });

  it('the queue answers one page and the total across every page', () => {
    const page = { data: [], meta: { page: 2, pageSize: 20, total: 21 } };
    expect(adminRelatedPayerRequestsResponseSchema.parse(page)).toEqual(page);
    expect(adminRelatedPayerRequestsResponseSchema.safeParse({ data: [] }).success).toBe(false);
  });

  it('the outbox actions are the Commands\' own names, after commit only (research R-8; expiry RP-20 c)', () => {
    expect(Object.values(RELATED_PAYERS_HOOKABLE_ACTIONS).map((ref) => [ref.action, ref.objectType, ref.phases])).toEqual([
      ['related_payers.request.create', 'related_payer_request', ['afterCommit']],
      ['related_payers.request.accept', 'related_payer_request', ['afterCommit']],
      ['related_payers.request.reject', 'related_payer_request', ['afterCommit']],
      ['related_payers.link.revoke', 'related_payer_link', ['afterCommit']],
      ['related_payers.request.expire', 'related_payer_request', ['afterCommit']],
      ['related_payers.request.route', 'related_payer_request', ['afterCommit']],
    ]);
  });
});

describe('RP-20 — the store time zone, the buyer tax ID on a payee, expiry through the outbox', () => {
  it('the daily limit counts days in a time zone of its own, Europe/Warsaw by default (RP-20 a)', () => {
    expect(RELATED_PAYERS_SETTING_CODES.TIME_ZONE).toBe('related_payers.time_zone');
    expect(RELATED_PAYERS_DEFAULT_TIME_ZONE).toBe('Europe/Warsaw');
    // Not one of the six channel settings of FR-003: it is read for the default store only.
    expect(Object.keys(RELATED_PAYERS_SETTING_DEFAULTS)).not.toContain('related_payers.time_zone');
  });
});

describe('Phase 6 — no account yet and payer invitations (US5, US6)', () => {
  const organization = {
    name: 'Payer SA',
    taxId: 'PL 123-456-78-90',
    registeredAddress: { street: 'Prosta 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
    salesChannelIds: [PAYER],
  };

  it('the queue creates an Organization as the admin form does, never with a status or parent (FR-023)', () => {
    expect(adminCreateRequestOrganizationBodySchema.parse({ organization }).organization.taxId).toBe('PL1234567890');
    expect(adminCreateRequestOrganizationBodySchema.safeParse({ organization: { ...organization, status: 'active' } }).success).toBe(false);
    expect(adminCreateRequestOrganizationBodySchema.safeParse({ organization, link: { commercialTerms: 'payer' } }).success).toBe(false);
  });

  it('the invitation lookup answers the tax ID to prefill, and nothing else (FR-044)', () => {
    expect(relatedPayerInvitationLookupResponseSchema.parse({ data: { taxId: 'PL1234567890', extra: 1 } })).toEqual({
      data: { taxId: 'PL1234567890' },
    });
  });

  it('the availability read answers whether the capability is on for the channel, and nothing else (FR-002)', () => {
    expect(relatedPayersAvailabilityResponseSchema.parse({ data: { enabled: false, extra: 1 } })).toEqual({
      data: { enabled: false },
    });
    expect(relatedPayersAvailabilityResponseSchema.safeParse({ data: { enabled: 'yes' } }).success).toBe(false);
  });
});
