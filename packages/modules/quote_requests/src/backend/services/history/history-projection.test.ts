import { describe, expect, it } from 'vitest';
import {
  quoteRequestHistoryEntrySchema,
  type AdminUserRecord,
  type CatalogProductVariantRecord,
  type CustomerAccountRecord,
} from '@endora-commerce/contracts';
import type { QuoteRequestRevisionLine } from '../../entities/quote-request-revision.entity.js';
import { AUTOMATIC_ADMIN_CREATION_NOTE } from './constants.js';
import {
  adminActorDirectory,
  customerActorDirectory,
  predecessorsToRead,
  projectHistory,
  variantLabelDirectory,
  type HistoryDirectory,
  type HistoryEventInput,
  type HistoryRevisionInput,
} from './history-projection.js';

/**
 * Feature 146, Phase 8 (T051) — the admin History read model: which stored
 * events merge into one entry (research R8, FR-011), who each entry is
 * attributed to (FR-017, FR-018, issue #283), what a modification changed
 * (FR-012) and what the actor mapper is allowed to copy (threat model T9).
 */

const ADMIN = 'b0000000-0000-4000-8000-000000000001';
const ADMIN_GONE = 'b0000000-0000-4000-8000-000000000002';
const A = 'c0000000-0000-4000-8000-00000000000a';
const B = 'c0000000-0000-4000-8000-00000000000b';
const CUSTOMER_GONE = 'c0000000-0000-4000-8000-0000000000ff';
const P = '11111111-1111-4111-8111-111111111111';
const SOURCE = 'd0000000-0000-4000-8000-000000000001';
const ORDER = 'e0000000-0000-4000-8000-000000000001';
const REV1 = 'f0000000-0000-4000-8000-000000000001';
const REV2 = 'f0000000-0000-4000-8000-000000000002';

let seq = 0;
function uuid(): string {
  seq += 1;
  return `a0000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}

const T0 = Date.parse('2026-10-01T10:00:00.000Z');

function event(
  eventType: HistoryEventInput['eventType'],
  actor: { admin?: string; customer?: string; role?: string | null },
  payload: Record<string, unknown> = {},
  revisionId: string | null = null,
): HistoryEventInput {
  return {
    id: uuid(),
    eventType,
    actorAdminUserId: actor.admin ?? null,
    actorCustomerAccountId: actor.customer ?? null,
    actorRoleLabel: actor.role === undefined ? (actor.admin ? 'Sales representative' : actor.customer ? 'Customer' : null) : actor.role,
    payload: { type: eventType, ...payload },
    revisionId,
    createdAt: new Date(T0 + seq * 1000),
  };
}

function line(extra: Partial<QuoteRequestRevisionLine> = {}): QuoteRequestRevisionLine {
  return {
    productId: P,
    variantId: null,
    productName: 'Product P',
    productSlug: 'p',
    quantity: 10,
    desiredUnitPrice: 100,
    agreedUnitPrice: null,
    lineNote: null,
    lineCurrency: 'PLN',
    discountPercent: null,
    packagingUnitName: null,
    packagingUnitBaseQuantity: null,
    ...extra,
  };
}

function revision(id: string, revisionNumber: number, items: QuoteRequestRevisionLine[], previousRevisionId: string | null = null): HistoryRevisionInput {
  return { id, revisionNumber, previousRevisionId, headerNoteSnapshot: null, itemsSnapshot: items };
}

function adminRecord(id: string, extra: Partial<AdminUserRecord> = {}): AdminUserRecord {
  return {
    id,
    email: 'rep@example.test',
    firstName: 'Carol',
    lastName: 'Rep',
    adminRoleId: null,
    status: 'active',
    twoFactorEnabled: true,
    lastLoginAt: new Date(),
    preferredLanguage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...extra,
  };
}

function customerRecord(id: string, firstName: string, lastName: string, email: string): CustomerAccountRecord {
  return {
    id,
    organizationId: '00000000-0000-4000-8000-0000000000aa',
    email,
    firstName,
    lastName,
    role: 'organization_admin',
    emailVerifiedAt: null,
    twoFactorEnabled: true,
    lastLoginAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    customFieldValues: { secret: 'x' },
    deletedAt: null,
    customerGroupId: null,
    subtreeRollupEnabled: false,
    blockedAt: null,
    blockReason: null,
    blockSource: null,
    blockedByAdminUserId: null,
    blockedByCustomerAccountId: null,
    deletionRequestedByAdminUserId: null,
    anonymizedAt: null,
  } as CustomerAccountRecord;
}

function directory(): HistoryDirectory {
  return {
    admins: adminActorDirectory([adminRecord(ADMIN)]),
    customers: customerActorDirectory([
      customerRecord(A, 'Alice', 'Asker', 'alice@example.test'),
      customerRecord(B, 'Bob', 'Boss', 'bob@example.test'),
    ]),
    variantLabels: new Map(),
  };
}

function project(events: HistoryEventInput[], revisions: HistoryRevisionInput[] = []) {
  const entries = projectHistory(events, revisions, directory());
  for (const entry of entries) {
    const parsed = quoteRequestHistoryEntrySchema.safeParse(entry);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  }
  return entries;
}

describe('projectHistory — pairing (research R8, FR-011)', () => {
  it('created + submitted by the same customer is one `submitted` entry', () => {
    const created = event('created', { customer: A }, {}, REV1);
    const submitted = event('submitted', { customer: A }, { itemCount: 1 }, REV1);
    const entries = project([created, submitted], [revision(REV1, 1, [line()])]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: created.id,
      eventIds: [created.id, submitted.id],
      kind: 'submitted',
      revisionNumber: 1,
      changes: null,
      occurredAt: created.createdAt.toISOString(),
    });
  });

  it('created (with source) + re-submitted is one `resubmitted` entry naming the source', () => {
    const entries = project([
      event('created', { customer: A }, { sourceRfqId: SOURCE }),
      event('re-submitted', { customer: A }, { sourceRfqId: SOURCE, newRfqId: uuid() }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'resubmitted', relatedQuoteRequestId: SOURCE });
  });

  it('admin created + the automatic note is one `created_by_admin` entry and the note is dropped', () => {
    const entries = project([
      event('created', { admin: ADMIN }),
      event('note-added', { admin: ADMIN }, { note: AUTOMATIC_ADMIN_CREATION_NOTE }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'created_by_admin', note: null });
  });

  it('an operator-typed note after an admin create is kept as its own entry', () => {
    const entries = project([
      event('created', { admin: ADMIN }),
      event('note-added', { admin: ADMIN }, { note: 'Call before delivery' }),
    ]);
    expect(entries.map((e) => [e.kind, e.note])).toEqual([
      ['created', null],
      ['note_added', 'Call before delivery'],
    ]);
  });

  it('customer accepted revision + approved is one `accepted_by_customer` entry with the revision number', () => {
    const entries = project([
      event('customer-accepted-revision', { customer: A }, { revisionNumber: 3 }),
      event('approved', { customer: A }, { approvedBy: 'customer' }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'accepted_by_customer', revisionNumber: 3 });
  });

  it('customer rejected revision + canceled is one `rejected_by_customer` entry with the reason', () => {
    const entries = project([
      event('customer-rejected-revision', { customer: A }, { revisionNumber: 2, reason: 'Too expensive' }),
      event('canceled', { customer: A }, { canceledBy: 'customer', reason: 'Too expensive' }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'rejected_by_customer', reason: 'Too expensive', revisionNumber: 2 });
  });

  it('admin note + approved is one `approved` entry carrying the note', () => {
    const entries = project([
      event('note-added', { admin: ADMIN }, { note: 'Approved at list price' }),
      event('approved', { admin: ADMIN }, { approvedBy: 'admin' }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'approved', note: 'Approved at list price' });
  });

  it('a pair by different actors does not merge', () => {
    const entries = project([
      event('customer-accepted-revision', { customer: A }, { revisionNumber: 2 }),
      event('approved', { customer: B }, { approvedBy: 'customer' }),
    ]);
    expect(entries.map((e) => e.kind)).toEqual(['accepted_by_customer', 'approved']);
  });

  it('non-adjacent halves do not merge', () => {
    const entries = project([
      event('created', { customer: A }),
      event('note-added', { customer: A }, { note: 'x' }),
      event('submitted', { customer: A }),
    ]);
    expect(entries.map((e) => e.kind)).toEqual(['created', 'note_added', 'submitted']);
  });

  it('every other event is one entry: canceled (reason), expired, completed (order)', () => {
    const entries = project([
      event('canceled', { admin: ADMIN }, { canceledBy: 'admin', reason: 'Out of stock' }),
      event('expired', { role: 'System' }, { expiryDaysAtTime: 30 }),
      event('completed', { role: 'System' }, { orderId: ORDER }),
    ]);
    expect(entries.map((e) => e.kind)).toEqual(['canceled', 'expired', 'completed']);
    expect(entries[0]).toMatchObject({ reason: 'Out of stock' });
    expect(entries[2]).toMatchObject({ orderId: ORDER });
  });

  it('entries are ordered oldest first', () => {
    const late = event('expired', { role: 'System' });
    const early = event('canceled', { admin: ADMIN });
    early.createdAt = new Date(T0 - 1000);
    expect(project([late, early]).map((e) => e.kind)).toEqual(['canceled', 'expired']);
  });
});

describe('projectHistory — actors (FR-017, FR-018, US3)', () => {
  it('admin, customer, system and unknown actor kinds', () => {
    const entries = project([
      event('canceled', { admin: ADMIN, role: 'Platform administrator' }),
      event('note-added', { customer: A }, { note: 'hi' }),
      event('expired', { role: 'System' }),
      event('note-added', { role: 'Legacy role' }, { note: 'old' }),
    ]);
    expect(entries.map((e) => e.actor)).toEqual([
      { kind: 'admin', adminUserId: ADMIN, name: 'Carol Rep', recordedRole: 'Platform administrator' },
      { kind: 'customer', customerAccountId: A, name: 'Alice Asker', email: 'alice@example.test', recordedRole: 'Customer' },
      { kind: 'system' },
      { kind: 'unknown', recordedRole: 'Legacy role' },
    ]);
  });

  it('names organization administrator B — not requester A — on an acceptance of A\'s request (US3 #1)', () => {
    const entries = project([
      event('created', { customer: A }),
      event('submitted', { customer: A }),
      event('customer-accepted-revision', { customer: B }, { revisionNumber: 2 }),
      event('approved', { customer: B }, { approvedBy: 'customer' }),
    ]);
    expect(entries[1]?.actor).toMatchObject({ kind: 'customer', customerAccountId: B, name: 'Bob Boss', email: 'bob@example.test' });
  });

  it('an admin or account no port returned is named null — "unknown user" (FR-018)', () => {
    const entries = project([
      event('canceled', { admin: ADMIN_GONE }),
      event('note-added', { customer: CUSTOMER_GONE }, { note: 'x' }),
    ]);
    expect(entries.map((e) => e.actor)).toEqual([
      { kind: 'admin', adminUserId: ADMIN_GONE, name: null, recordedRole: 'Sales representative' },
      { kind: 'customer', customerAccountId: CUSTOMER_GONE, name: null, email: null, recordedRole: 'Customer' },
    ]);
  });
});

describe('projectHistory — modifications (FR-012, FR-013, R7)', () => {
  it('a modification lists the diff against the previous revision plus the validity change from the payload', () => {
    const before = '2026-10-31T00:00:00.000Z';
    const after = '2026-11-14T00:00:00.000Z';
    const entries = project(
      [event('modified', { admin: ADMIN }, { diff: [], validity: { before, after } }, REV2)],
      [revision(REV1, 1, [line({ quantity: 10 })]), revision(REV2, 2, [line({ quantity: 12 })], REV1)],
    );
    expect(entries[0]).toMatchObject({ kind: 'modified', revisionNumber: 2 });
    expect(entries[0]?.changes).toEqual([
      { kind: 'line_quantity', line: expect.objectContaining({ productId: P }), before: 10, after: 12 },
      { kind: 'validity', before, after },
    ]);
  });

  it('finds the previous revision by number when the link is missing', () => {
    const entries = project(
      [event('modified', { customer: A }, { diff: [] }, REV2)],
      [revision(REV1, 1, [line({ desiredUnitPrice: 100 })]), revision(REV2, 2, [line({ desiredUnitPrice: 95 })])],
    );
    expect(entries[0]?.changes?.map((c) => c.kind)).toEqual(['line_proposed_unit_price']);
  });

  it('a modification without listable changes has `changes: []` (FR-013); a pre-release one has no validity (US2 #8)', () => {
    const entries = project(
      [event('modified', { admin: ADMIN }, { diff: [] }, REV2)],
      [revision(REV1, 1, [line()]), revision(REV2, 2, [line()], REV1)],
    );
    expect(entries[0]?.changes).toEqual([]);
  });

  it('a malformed validity payload is ignored rather than passed through', () => {
    const entries = project(
      [event('modified', { admin: ADMIN }, { diff: [], validity: { before: 'yesterday', after: 42 } }, REV2)],
      [revision(REV1, 1, [line()]), revision(REV2, 2, [line()], REV1)],
    );
    expect(entries[0]?.changes).toEqual([]);
  });

  it('non-modification entries carry `changes: null`', () => {
    expect(project([event('expired', { role: 'System' })])[0]?.changes).toBeNull();
  });
});

describe('actor mapper (threat model T9)', () => {
  it('copies only first and last name from an admin record', () => {
    const map = adminActorDirectory([adminRecord(ADMIN)]);
    expect(map.get(ADMIN)).toEqual({ name: 'Carol Rep' });
  });

  it('an admin with no name is named null', () => {
    expect(adminActorDirectory([adminRecord(ADMIN, { firstName: '', lastName: '' })]).get(ADMIN)).toEqual({ name: null });
  });

  it('copies only name and e-mail from a customer record', () => {
    const map = customerActorDirectory([customerRecord(A, 'Alice', 'Asker', 'alice@example.test')]);
    expect(map.get(A)).toEqual({ name: 'Alice Asker', email: 'alice@example.test' });
  });

  it('a history entry for an admin carries no e-mail, login, 2FA or status key anywhere', () => {
    const [entry] = project([event('canceled', { admin: ADMIN })]);
    const json = JSON.stringify(entry);
    for (const forbidden of ['email', 'lastLoginAt', 'twoFactorEnabled', 'status', 'rep@example.test']) {
      expect(json).not.toContain(forbidden);
    }
  });
});

describe('variant labels and bounded revision reads', () => {
  it('labels a variant from its attribute values, falling back to the SKU', () => {
    const base = { parentProductId: P, priceOverride: null, stockLevel: null, createdAt: new Date(), updatedAt: new Date() };
    const labels = variantLabelDirectory([
      { ...base, id: 'v1', sku: 'SKU-1', variantAttributeValues: { colour: 'red', size: 'L' } },
      { ...base, id: 'v2', sku: 'SKU-2', variantAttributeValues: {} },
    ] as CatalogProductVariantRecord[]);
    expect(labels.get('v1')).toBe('colour=red, size=L');
    expect(labels.get('v2')).toBe('SKU-2');
  });

  it('asks for the predecessor of a modification\'s revision only — by link, else by number, unless loaded', () => {
    const REV3 = 'f0000000-0000-4000-8000-000000000003';
    const REV4 = 'f0000000-0000-4000-8000-000000000004';
    const LINKED = 'f0000000-0000-4000-8000-0000000000aa';
    const events = [
      event('created', { customer: A }, {}, REV1),
      event('modified', { admin: ADMIN }, {}, REV2),
      event('modified', { admin: ADMIN }, {}, REV4),
      event('approved', { admin: ADMIN }, {}, REV3),
    ];
    const loaded = [
      revision(REV1, 1, []),
      revision(REV2, 2, [], LINKED),
      revision(REV3, 3, []),
      revision(REV4, 4, []),
    ];
    // REV2 names its predecessor; REV4 does not, and number 3 is already
    // loaded; the created and approved events' revisions need none.
    expect(predecessorsToRead(events, loaded)).toEqual({ ids: [LINKED], numbers: [] });
    expect(predecessorsToRead(events, loaded.filter((r) => r.id !== REV3))).toEqual({ ids: [LINKED], numbers: [3] });
  });
});

describe('feature 153 — the quote PDF sent by e-mail (owner answer Q4)', () => {
  it('a pdf-sent event is one pdf_sent entry with its delivery; every other entry carries none', () => {
    const entries = projectHistory(
      [
        event('note-added', { admin: ADMIN }, { note: 'call back' }),
        event('pdf-sent', { admin: ADMIN }, {
          recipients: ['buyer@example.com', 'two@example.com'],
          templateId: 'f0000000-0000-4000-8000-0000000000aa',
          templateName: 'With discounts',
          language: 'pl-PL',
          message: 'Please see the offer.',
        }),
      ],
      [],
      directory(),
    );
    expect(entries.map((e) => e.kind)).toEqual(['note_added', 'pdf_sent']);
    expect(entries[0]!.delivery).toBeNull();
    expect(entries[1]).toMatchObject({
      kind: 'pdf_sent',
      actor: { kind: 'admin', adminUserId: ADMIN },
      note: null,
      delivery: {
        recipients: ['buyer@example.com', 'two@example.com'],
        templateName: 'With discounts',
        language: 'pl-PL',
        message: 'Please see the offer.',
      },
    });
    expect(quoteRequestHistoryEntrySchema.safeParse(entries[1]).success).toBe(true);
  });

  it('a hostile payload keeps what is readable', () => {
    const [entry] = projectHistory(
      [event('pdf-sent', { admin: ADMIN }, { recipients: ['ok@example.com', 7, null], templateName: 3, language: '', message: { x: 1 } })],
      [],
      directory(),
    );
    expect(entry!.delivery).toEqual({ recipients: ['ok@example.com'], templateName: null, language: null, message: null });
  });
});

describe('feature 162 — values a Sales Opportunity could not carry', () => {
  const OPPORTUNITY = 'f0000000-0000-4000-8000-0000000000bb';

  it('a custom-field-carry-skipped event is one system entry naming its source and every skipped key', () => {
    const entries = projectHistory(
      [
        event('note-added', { admin: ADMIN }, { note: 'call back' }),
        event('custom-field-carry-skipped', { role: 'System' }, {
          source: { entityType: 'opportunity', recordId: OPPORTUNITY, reference: 'OPP-000007' },
          skipped: [{ key: 'order_source', reason: 'value_invalid' }],
        }),
      ],
      [],
      directory(),
    );
    expect(entries.map((e) => e.kind)).toEqual(['note_added', 'custom_field_carry_skipped']);
    expect(entries[0]!.customFieldCarry).toBeNull();
    expect(entries[1]).toMatchObject({
      kind: 'custom_field_carry_skipped',
      actor: { kind: 'system' },
      customFieldCarry: {
        source: { entityType: 'opportunity', recordId: OPPORTUNITY, reference: 'OPP-000007' },
        skipped: [{ key: 'order_source', reason: 'value_invalid' }],
      },
    });
    expect(quoteRequestHistoryEntrySchema.safeParse(entries[1]).success).toBe(true);
  });

  it('a hostile payload keeps only well-formed skips, and a source that is not one reads as none', () => {
    const [entry] = projectHistory(
      [
        event('custom-field-carry-skipped', { role: 'System' }, {
          source: { entityType: 'order', recordId: 7 },
          skipped: [{ key: 'ok', reason: 'audience_mismatch' }, { key: 3, reason: 'value_invalid' }, { key: 'x', reason: 'other' }],
        }),
      ],
      [],
      directory(),
    );
    expect(entry!.customFieldCarry).toBeNull();
  });

  it('passes each skip’s label snapshot through, and a skip stored without one stays without (owner ruling 2026-10-21, V3)', () => {
    const label = { labelDefault: 'Order source', labels: { pl: 'Źródło zamówienia' } };
    const [entry] = projectHistory(
      [
        event('custom-field-carry-skipped', { role: 'System' }, {
          source: { entityType: 'opportunity', recordId: OPPORTUNITY, reference: 'OPP-000008' },
          skipped: [
            { key: 'order_source', reason: 'target_missing', label },
            { key: 'fair', reason: 'value_invalid' },
          ],
        }),
      ],
      [],
      directory(),
    );
    expect(entry!.customFieldCarry?.skipped).toEqual([
      { key: 'order_source', reason: 'target_missing', label },
      { key: 'fair', reason: 'value_invalid' },
    ]);
    expect(quoteRequestHistoryEntrySchema.safeParse(entry).success).toBe(true);
  });
});

