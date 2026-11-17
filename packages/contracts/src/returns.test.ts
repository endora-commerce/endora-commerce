import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  PRODUCT_OR_MODEL_REQUIRED,
  RETURN_CASE_CREATED_EVENT,
  ReturnCaseCreatedEventV1Schema,
  adminReturnsListQuerySchema,
  createReturnCaseClauseRequestSchema,
  createReturnCaseRequestSchema,
  resolutionTypeSchema,
  returnAttachmentSchema,
  returnAttachmentTypeSchema,
  returnCaseClauseSchema,
  returnCaseItemSchema,
  returnFormConfigSchema,
  returnUploadSchema,
  settlementRequestSchema,
  shownClauseSchema,
  updateReturnCaseClauseRequestSchema,
  NOTIFY_REQUIRES_CUSTOMER_VISIBLE,
  adminAddCommentRequestSchema,
  adminReturnRowSchema,
  adminReturnsSortSchema,
  alternativeResolutionConsentSchema,
  recordAlternativeConsentRequestSchema,
  returnCaseDetailSchema,
  returnCaseAuthorizerSchema,
  returnCaseSummarySchema,
  returnNotificationHealthSchema,
  returnStatusCreateSchema,
  returnStatusSchema,
  returnStatusUpdateSchema,
  settlementPrefillSchema,
  type AdminReturnRow,
  type RecordAlternativeConsentRequest,
  type ReturnCaseDetail,
  type ReturnCaseSummary,
  type ReturnStatusDto,
  type SettlementPrefill,
} from './returns.js';
import { REQUEST_LINE_ITEMS_MAX } from './line-bounds.js';

/**
 * `specs/170-organization-roles/` WP-14, T147 (FR-053, R-41 item 6) — a case
 * summary names its filer, so a buyer who sees the Organization's cases can
 * tell a colleague's from their own, as the order summary carries
 * `placedByCustomerAccountId`. Additive: the detail always carried it.
 */

const FILER = '00000000-0000-4000-8000-0000000170a1';
const summary = {
  id: '00000000-0000-4000-8000-0000000170c1',
  rmaNumber: null,
  kind: 'return',
  orderId: '00000000-0000-4000-8000-0000000170d1',
  statusCode: 'new',
  statusLabel: 'New',
  totalRefundAmount: 0,
  currency: 'PLN',
  submittedAt: '2026-11-04T10:00:00.000Z',
  customerAccountId: FILER,
  reference: '#000000C1',
  offPlatform: false,
  productLabel: 'Widget',
  lineCount: 1,
  purchaseDate: null,
} as const;

describe('ReturnCaseSummary.customerAccountId (170 WP-14)', () => {
  it('is carried by the summary', () => {
    expect(returnCaseSummarySchema.parse(summary).customerAccountId).toBe(FILER);
    expectTypeOf<ReturnCaseSummary['customerAccountId']>().toEqualTypeOf<string>();
  });

  it('is required, and must be a uuid', () => {
    const { customerAccountId: _omitted, ...withoutFiler } = summary;
    expect(returnCaseSummarySchema.safeParse(withoutFiler).success).toBe(false);
    expect(returnCaseSummarySchema.safeParse({ ...summary, customerAccountId: 'colleague' }).success).toBe(false);
  });

  it('is inherited by the operator’s row', () => {
    const row = adminReturnRowSchema.parse({
      ...summary,
      customerName: 'Ewa',
      organizationName: 'Acme',
      authorizedBy: null,
    });
    expect(row.customerAccountId).toBe(FILER);
    expectTypeOf<AdminReturnRow['customerAccountId']>().toEqualTypeOf<string>();
  });

  it('keeps the detail’s declaration of it', () => {
    expect(returnCaseDetailSchema.shape.customerAccountId).toBeDefined();
    expect(Object.keys(returnCaseDetailSchema.shape)).toEqual(
      expect.arrayContaining(Object.keys(returnCaseSummarySchema.shape)),
    );
  });
});

/**
 * Issue #905, PR 2 (design D1): a consumer withdrawal settles as a refund, and
 * a credit, a replacement or a repair needs the consumer's consent on record.
 * The operator records it with an evidence note; the case detail and the
 * settlement prefill say what the screen needs to know.
 */
describe('consumer withdrawal — recorded consent (#905)', () => {
  const consent = {
    resolution: 'credit',
    consentGivenAt: '2026-11-10T09:30:00.000Z',
    note: "Customer's e-mail of 2026-11-10, ticket #123",
  } as const;

  it('records consent for credit, replacement or repair, never for a refund', () => {
    for (const resolution of ['credit', 'replacement', 'repair'] as const) {
      expect(recordAlternativeConsentRequestSchema.safeParse({ ...consent, resolution }).success).toBe(true);
    }
    expect(recordAlternativeConsentRequestSchema.safeParse({ ...consent, resolution: 'refund' }).success).toBe(false);
    expectTypeOf<RecordAlternativeConsentRequest['resolution']>().toEqualTypeOf<
      'credit' | 'replacement' | 'repair'
    >();
  });

  it('requires an evidence note of 1 to 2000 characters, trimmed', () => {
    expect(recordAlternativeConsentRequestSchema.parse({ ...consent, note: '  ticket #9  ' }).note).toBe('ticket #9');
    expect(recordAlternativeConsentRequestSchema.safeParse({ ...consent, note: '   ' }).success).toBe(false);
    expect(recordAlternativeConsentRequestSchema.safeParse({ ...consent, note: 'x'.repeat(2001) }).success).toBe(false);
    const { note: _note, ...withoutNote } = consent;
    expect(recordAlternativeConsentRequestSchema.safeParse(withoutNote).success).toBe(false);
  });

  it('requires the moment the consent was given', () => {
    const { consentGivenAt: _at, ...withoutDate } = consent;
    expect(recordAlternativeConsentRequestSchema.safeParse(withoutDate).success).toBe(false);
    expect(recordAlternativeConsentRequestSchema.safeParse({ ...consent, consentGivenAt: 'yesterday' }).success).toBe(false);
  });

  it('puts the classification and the consent on the case detail', () => {
    expect(returnCaseDetailSchema.shape.consumerWithdrawal).toBeDefined();
    expect(returnCaseDetailSchema.shape.alternativeResolutionConsent).toBeDefined();
    // `null` = a case created before the classification existed.
    expectTypeOf<ReturnCaseDetail['consumerWithdrawal']>().toEqualTypeOf<boolean | null>();
    const parsed = alternativeResolutionConsentSchema.parse({
      resolution: 'repair',
      at: consent.consentGivenAt,
      note: consent.note,
      byAdminUserId: FILER,
      source: 'operator_recorded',
    });
    expect(parsed.source).toBe('operator_recorded');
    // The buyer's view of the same consent leaves the note and the operator out.
    expect(
      alternativeResolutionConsentSchema.safeParse({ resolution: 'repair', at: consent.consentGivenAt, source: 'operator_recorded' })
        .success,
    ).toBe(true);
  });

  it('gives the settlement prefill its default resolution, the consent gate and the order’s payment method', () => {
    const prefill = settlementPrefillSchema.parse({
      currency: 'PLN',
      resolutionOptions: ['refund', 'credit', 'replacement', 'repair'],
      defaultResolution: 'refund',
      consentRequiredFor: ['replacement', 'repair'],
      defaultRefundPaymentMethodId: FILER,
      items: [],
    });
    expect(prefill.consentRequiredFor).toEqual(['replacement', 'repair']);
    expectTypeOf<SettlementPrefill['defaultRefundPaymentMethodId']>().toEqualTypeOf<string | null>();
    expect(
      settlementPrefillSchema.safeParse({ currency: 'PLN', resolutionOptions: ['refund'], items: [] }).success,
    ).toBe(false);
  });
});

/**
 * `specs/180-off-platform-complaints/` WP A-1 (T003–T005): the contracts of phase A —
 * notify-on-comment, notify-on-entry, the authorizer and the case reference.
 */
describe('admin comment — notify requires a customer-visible comment (180 FR-A21)', () => {
  const body = { body: 'We received your parcel.' };

  it('refuses notifyCustomer on an internal comment with the detail code', () => {
    const result = adminAddCommentRequestSchema.safeParse({ ...body, isCustomerVisible: false, notifyCustomer: true });
    expect(result.success).toBe(false);
    const issue = result.error!.issues[0]!;
    expect(issue.path).toEqual(['notifyCustomer']);
    expect(issue.message).toBe(NOTIFY_REQUIRES_CUSTOMER_VISIBLE);
    expect(NOTIFY_REQUIRES_CUSTOMER_VISIBLE).toBe('notify_requires_customer_visible');
  });

  it('accepts the other three combinations', () => {
    for (const [isCustomerVisible, notifyCustomer] of [
      [true, true],
      [true, false],
      [false, false],
    ] as const) {
      expect(adminAddCommentRequestSchema.safeParse({ ...body, isCustomerVisible, notifyCustomer }).success).toBe(true);
    }
  });

  it('still requires both booleans (the API has no default)', () => {
    expect(adminAddCommentRequestSchema.safeParse({ ...body, isCustomerVisible: true }).success).toBe(false);
    expect(adminAddCommentRequestSchema.safeParse({ ...body, notifyCustomer: false }).success).toBe(false);
  });
});

describe('status — notify the customer on entry (180 FR-A30)', () => {
  const status = {
    code: 'received',
    name: { en: 'Received' },
    defaultName: 'Received',
    isInitial: false,
    isTerminal: false,
    isSystem: true,
    weight: 30,
    color: '#8b5cf6',
  };

  it('is required on the status', () => {
    expect(returnStatusSchema.safeParse(status).success).toBe(false);
    expect(returnStatusSchema.parse({ ...status, notifyCustomerOnEntry: true }).notifyCustomerOnEntry).toBe(true);
    expectTypeOf<ReturnStatusDto['notifyCustomerOnEntry']>().toEqualTypeOf<boolean>();
  });

  it('is optional on the create and patch bodies', () => {
    const create = { code: 'awaiting_parts', name: { en: 'Awaiting parts' }, defaultName: 'Awaiting parts' };
    expect(returnStatusCreateSchema.parse(create).notifyCustomerOnEntry).toBeUndefined();
    expect(returnStatusCreateSchema.parse({ ...create, notifyCustomerOnEntry: true }).notifyCustomerOnEntry).toBe(true);
    expect(returnStatusUpdateSchema.parse({}).notifyCustomerOnEntry).toBeUndefined();
    expect(returnStatusUpdateSchema.parse({ notifyCustomerOnEntry: false }).notifyCustomerOnEntry).toBe(false);
    expect(returnStatusUpdateSchema.safeParse({ notifyCustomerOnEntry: 'yes' }).success).toBe(false);
  });
});

describe('the authorizer and the case reference (180 FR-A41 – FR-A44, D-7)', () => {
  const ADMIN = '00000000-0000-4000-8000-0000000180a1';

  it('puts the reference on the summary, and so on the admin row and the detail', () => {
    const { reference: _omitted, ...withoutReference } = summary;
    expect(returnCaseSummarySchema.safeParse(withoutReference).success).toBe(false);
    expect(returnCaseSummarySchema.parse(summary).reference).toBe('#000000C1');
    expect(returnCaseDetailSchema.shape.reference).toBeDefined();
    expect(adminReturnRowSchema.shape.reference).toBeDefined();
  });

  it('puts authorizedAt and authorizedBy on the detail', () => {
    expect(returnCaseDetailSchema.shape.authorizedAt).toBeDefined();
    expect(returnCaseDetailSchema.shape.authorizedBy).toBeDefined();
    expectTypeOf<ReturnCaseDetail['authorizedAt']>().toEqualTypeOf<string | null>();
    expectTypeOf<ReturnCaseDetail['authorizedBy']>().toEqualTypeOf<{ adminUserId: string | null; name: string | null } | null>();
  });

  it('describes the authorizer as an id and a resolved name, either of which may be null', () => {
    expect(returnCaseAuthorizerSchema.parse({ adminUserId: ADMIN, name: 'Ada' })).toEqual({ adminUserId: ADMIN, name: 'Ada' });
    // A removed administrator: the id is known, no name resolves (FR-A42).
    expect(returnCaseAuthorizerSchema.parse({ adminUserId: ADMIN, name: null }).name).toBeNull();
    // Unknown: authorized before the authorizer was recorded (FR-A43).
    expect(returnCaseAuthorizerSchema.parse({ adminUserId: null, name: null }).adminUserId).toBeNull();
    expect(returnCaseAuthorizerSchema.safeParse({ adminUserId: 'someone', name: null }).success).toBe(false);
  });

  it('carries the authorizer on the admin row', () => {
    const row = adminReturnRowSchema.parse({
      ...summary,
      customerName: null,
      organizationName: null,
      authorizedBy: { adminUserId: ADMIN, name: 'Ada' },
    });
    expect(row.authorizedBy?.name).toBe('Ada');
    expect(
      adminReturnRowSchema.safeParse({ ...summary, customerName: null, organizationName: null }).success,
    ).toBe(false);
    expectTypeOf<AdminReturnRow['authorizedBy']>().toEqualTypeOf<{ adminUserId: string | null; name: string | null } | null>();
  });

  it('parses the notification health answer', () => {
    const health = returnNotificationHealthSchema.parse({
      recipientsMissing: { global: true, salesChannelIds: [ADMIN] },
    });
    expect(health.recipientsMissing.global).toBe(true);
    expect(returnNotificationHealthSchema.safeParse({ recipientsMissing: { global: true, salesChannelIds: ['x'] } }).success).toBe(
      false,
    );
  });

  it('leaves the sort unchanged: the authorizer is not sortable', () => {
    expect(adminReturnsSortSchema.options).toEqual(['submittedAt:asc', 'submittedAt:desc', 'rmaNumber:asc', 'rmaNumber:desc']);
  });
});

/**
 * `specs/180-off-platform-complaints/` WP B-1 (T043–T045): the complaint without a
 * platform order — the create union, the form configuration, attachments, clauses,
 * the outside settlement, the list origin and the detail blocks.
 */
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('the create request (180 T043, contracts/customer-api.md §C3)', () => {
  const orderCase = {
    orderId: U(1),
    kind: 'complaint' as const,
    lines: [{ orderItemId: U(2), quantity: 1, reasonId: U(3), serialNumber: 'SN-1' }],
    attachments: [{ uploadId: U(4) }],
    shownClauses: [{ id: U(5), revision: 2 }],
    acceptedClauses: [{ id: U(5), revision: 2 }],
    submissionKey: U(6),
  };
  const noOrder = {
    orderId: null,
    kind: 'complaint' as const,
    lines: [
      { productId: U(7), quantity: 1, reasonId: U(3), description: 'Does not start' },
      { modelName: 'Drill X200', quantity: 2, reasonId: U(3), description: 'Battery swells', serialNumber: 'AB-12' },
    ],
    purchase: { proofNumber: 'FV/1/2026', date: '2026-10-01' },
    contact: { name: 'Ewa Nowak', email: 'ewa@example.test', phone: '+48 600 000 000' },
    returnAddress: { name: 'Ewa Nowak', street: 'Prosta 1', postalCode: '00-001', city: 'Warszawa', countryCode: 'PL' },
  };

  it('accepts the order branch with the new optional fields', () => {
    expect(createReturnCaseRequestSchema.safeParse(orderCase).success).toBe(true);
  });

  it('accepts the no-order branch', () => {
    const parsed = createReturnCaseRequestSchema.parse(noOrder);
    expect(parsed.orderId).toBeNull();
  });

  it('refuses kind return without an order (R3)', () => {
    expect(createReturnCaseRequestSchema.safeParse({ ...noOrder, kind: 'return' }).success).toBe(false);
  });

  it.each(['purchase', 'contact', 'returnAddress'] as const)('requires %s on the no-order branch', (key) => {
    const { [key]: _omitted, ...rest } = noOrder;
    expect(createReturnCaseRequestSchema.safeParse(rest).success).toBe(false);
  });

  it('requires the purchase date', () => {
    expect(createReturnCaseRequestSchema.safeParse({ ...noOrder, purchase: { proofNumber: 'x' } }).success).toBe(false);
  });

  it('requires exactly one of productId and modelName per line, with product_or_model_required', () => {
    const line = { quantity: 1, reasonId: U(3), description: 'x' };
    for (const bad of [line, { ...line, productId: U(7), modelName: 'Both' }]) {
      const result = createReturnCaseRequestSchema.safeParse({ ...noOrder, lines: [bad] });
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain(PRODUCT_OR_MODEL_REQUIRED);
    }
  });

  it('requires a non-empty description on a no-order line', () => {
    const lines = [{ modelName: 'X', quantity: 1, reasonId: U(3), description: '  ' }];
    expect(createReturnCaseRequestSchema.safeParse({ ...noOrder, lines }).success).toBe(false);
  });

  it('ties an attachment to one line of the request by its index, on both branches', () => {
    const tied = [{ uploadId: U(4), line: 1 }, { uploadId: U(8) }];
    const parsed = createReturnCaseRequestSchema.parse({ ...noOrder, attachments: tied });
    expect(parsed.attachments).toEqual(tied);
    expect(createReturnCaseRequestSchema.safeParse({ ...orderCase, attachments: [{ uploadId: U(4), line: 0 }] }).success).toBe(true);
  });

  it('refuses a line index that is negative, fractional or beyond the line bound', () => {
    for (const line of [-1, 0.5, REQUEST_LINE_ITEMS_MAX]) {
      expect(createReturnCaseRequestSchema.safeParse({ ...noOrder, attachments: [{ uploadId: U(4), line }] }).success).toBe(false);
    }
    expect(
      createReturnCaseRequestSchema.safeParse({ ...noOrder, attachments: [{ uploadId: U(4), line: REQUEST_LINE_ITEMS_MAX - 1 }] }).success,
    ).toBe(true);
  });

  it('refuses attachmentAssetIds as an unknown key, on both branches', () => {
    expect(createReturnCaseRequestSchema.safeParse({ ...orderCase, attachmentAssetIds: [U(9)] }).success).toBe(false);
    expect(createReturnCaseRequestSchema.safeParse({ ...noOrder, attachmentAssetIds: [U(9)] }).success).toBe(false);
  });
});

describe('form configuration, uploads, attachments and clauses (180 T044)', () => {
  it('parses the form configuration (D-1, D-11, D-12)', () => {
    const config = returnFormConfigSchema.parse({
      offPlatformComplaintsEnabled: true,
      proofOfPurchaseRequired: false,
      confirmationEmailEnabled: true,
      today: '2026-11-13',
      clauses: [{ id: U(1), revision: 1, mode: 'inform_only', label: 'Terms', text: 'Text', linkUrl: null }],
      attachmentLimits: { maxFileBytes: 10, maxSubmissionBytes: 30, maxFilesPerCase: 10, acceptedMimeTypes: ['application/pdf'] },
    });
    expect(config.clauses[0]!.mode).toBe('inform_only');
    expect(returnFormConfigSchema.safeParse({ ...config, today: '13.11.2026' }).success).toBe(false);
  });

  it('parses an upload answer and a typed attachment with no asset id', () => {
    expect(
      returnUploadSchema.parse({
        uploadId: U(1),
        type: 'proof_of_purchase',
        filename: 'receipt.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1000,
        expiresAt: '2026-11-14T10:00:00.000Z',
      }).type,
    ).toBe('proof_of_purchase');
    const attachment = returnAttachmentSchema.parse({
      id: U(1),
      returnCaseId: U(2),
      returnCaseItemId: U(3),
      type: 'photo',
      filename: 'a.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 10,
      createdAt: '2026-11-14T10:00:00.000Z',
    });
    expect('assetId' in attachment).toBe(false);
    expect(attachment.returnCaseItemId).toBe(U(3));
    expect(returnAttachmentSchema.safeParse({ ...attachment, returnCaseItemId: null }).success).toBe(true);
    const { returnCaseItemId: _line, ...withoutLine } = attachment;
    expect(returnAttachmentSchema.safeParse(withoutLine).success).toBe(false);
    expect(returnAttachmentTypeSchema.options).toEqual(['photo', 'proof_of_purchase', 'other']);
  });

  it('defines clauses with appliesTo, mode and an https-only link', () => {
    const body = { label: { en: 'Terms' }, text: { en: 'Read me' } };
    const created = createReturnCaseClauseRequestSchema.parse(body);
    expect(created.appliesTo).toBeUndefined();
    expect(createReturnCaseClauseRequestSchema.safeParse({ ...body, linkUrl: { en: 'https://shop.example/terms' } }).success).toBe(true);
    expect(createReturnCaseClauseRequestSchema.safeParse({ ...body, linkUrl: { en: 'http://shop.example/terms' } }).success).toBe(false);
    expect(createReturnCaseClauseRequestSchema.safeParse({ ...body, mode: 'inform' }).success).toBe(false);
    expect(createReturnCaseClauseRequestSchema.safeParse({ ...body, appliesTo: 'both', mode: 'inform_only' }).success).toBe(true);
    expect(updateReturnCaseClauseRequestSchema.parse({ weight: 5 }).weight).toBe(5);
    expect(returnCaseClauseSchema.shape.revision).toBeDefined();
  });
});

describe('outside settlement, list origin and detail blocks (180 T045)', () => {
  it('adds settled_outside and the resolution note', () => {
    expect(resolutionTypeSchema.options).toContain('settled_outside');
    const request = settlementRequestSchema.parse({ resolutionType: 'settled_outside', lines: [], resolutionNote: '  refunded in store  ' });
    expect(request.resolutionNote).toBe('refunded in store');
    expect(settlementRequestSchema.safeParse({ resolutionType: 'settled_outside', lines: [], resolutionNote: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('lets the summary have no order, and carries the off-platform fields (D-3)', () => {
    const offPlatform = { ...summary, orderId: null, offPlatform: true, productLabel: 'Drill', lineCount: 2, purchaseDate: '2026-10-01' };
    expect(returnCaseSummarySchema.parse(offPlatform).orderId).toBeNull();
    const { productLabel: _p, ...withoutLabel } = offPlatform;
    expect(returnCaseSummarySchema.safeParse(withoutLabel).success).toBe(false);
  });

  it('filters the list by origin', () => {
    expect(adminReturnsListQuerySchema.parse({ origin: 'off_platform' }).origin).toBe('off_platform');
    expect(adminReturnsListQuerySchema.safeParse({ origin: 'elsewhere' }).success).toBe(false);
  });

  it('puts the off-platform blocks on the detail', () => {
    for (const key of [
      'purchase',
      'contact',
      'returnAddress',
      'attachments',
      'acceptedClauses',
      'clausesAcceptedAt',
      'resolutionNote',
      'personalDataErasedAt',
    ]) {
      expect(returnCaseDetailSchema.shape).toHaveProperty(key);
    }
    expect(
      shownClauseSchema.parse({ clauseId: U(1), revision: 1, mode: 'must_accept', language: 'pl', label: 'L', text: 'T', linkUrl: null }).mode,
    ).toBe('must_accept');
    expect(returnCaseItemSchema.shape.serialNumber).toBeDefined();
    expect(returnCaseItemSchema.shape.orderItemId.safeParse(null).success).toBe(true);
  });

  it('declares return_case.created.v1 with a strict payload', () => {
    expect(RETURN_CASE_CREATED_EVENT).toBe('return_case.created.v1');
    const event = {
      eventId: U(1),
      occurredAt: '2026-11-13T10:00:00.000Z',
      returnCaseId: U(2),
      organizationId: U(3),
      salesChannelId: U(4),
      kind: 'complaint',
      offPlatform: true,
    };
    expect(ReturnCaseCreatedEventV1Schema.parse(event).offPlatform).toBe(true);
    expect(ReturnCaseCreatedEventV1Schema.safeParse({ ...event, contact: 'x' }).success).toBe(false);
  });
});
