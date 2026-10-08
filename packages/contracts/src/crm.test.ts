import { describe, expect, it } from 'vitest';
import * as crm from './crm.js';
import type { OpportunityTransitionOutcome } from './crm.js';

/**
 * `specs/143-crm-sales-opportunities/contracts/admin-api.md` — one accept and
 * one reject case per request schema of §1–§12, the reference-token grammar of
 * §9, the templated status-event names and the transition outcome union.
 */

const UUID_A = '0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a01';
const UUID_B = '6a3b1e9d-0c1f-4a8e-9a2d-4b7f0c5d2e02';

function accepts(schema: { safeParse(v: unknown): { success: boolean } }, value: unknown): void {
  expect(schema.safeParse(value).success).toBe(true);
}

function rejects(schema: { safeParse(v: unknown): { success: boolean } }, value: unknown): void {
  expect(schema.safeParse(value).success).toBe(false);
}

describe('§1 opportunities', () => {
  it('list query: accepts the documented filters and normalises a single value to an array', () => {
    const parsed = crm.OpportunityListQuerySchema.parse({
      q: 'acme',
      statusCode: 'new',
      state: 'open',
      organizationId: UUID_A,
      assignedAdminUserId: 'me',
      tagId: [UUID_A, UUID_B],
      createdFrom: '2026-10-01',
      sort: 'value',
      order: 'asc',
      limit: '25',
    });
    expect(parsed.statusCode).toEqual(['new']);
    expect(parsed.tagId).toEqual([UUID_A, UUID_B]);
    expect(parsed.limit).toBe(25);
  });

  it('list query: defaults the limit to 50 and refuses more than 200', () => {
    expect(crm.OpportunityListQuerySchema.parse({}).limit).toBe(50);
    rejects(crm.OpportunityListQuerySchema, { limit: '201' });
  });

  it('list query: rejects an unknown state, sort and assignee token', () => {
    rejects(crm.OpportunityListQuerySchema, { state: 'closed' });
    rejects(crm.OpportunityListQuerySchema, { sort: 'title' });
    rejects(crm.OpportunityListQuerySchema, { assignedAdminUserId: 'nobody' });
  });

  it('create: accepts title + organization + currency, and the optional fields', () => {
    accepts(crm.CreateOpportunityRequestSchema, {
      title: 'Annual supply contract',
      organizationId: UUID_A,
      currency: 'PLN',
    });
    accepts(crm.CreateOpportunityRequestSchema, {
      title: 'Annual supply contract',
      organizationId: UUID_A,
      currency: 'EUR',
      description: 'See [[product:' + UUID_B + ']]',
      customerAccountId: UUID_B,
      salesChannelId: UUID_B,
      assignedAdminUserId: null,
      valueMode: 'manual',
      manualValue: '1200.50',
      expectedCloseDate: '2026-12-31',
      tagIds: [UUID_A],
    });
  });

  it('create: rejects a missing organization, an empty title, a bad currency, a negative value', () => {
    rejects(crm.CreateOpportunityRequestSchema, { title: 'x', currency: 'PLN' });
    rejects(crm.CreateOpportunityRequestSchema, { title: '', organizationId: UUID_A, currency: 'PLN' });
    rejects(crm.CreateOpportunityRequestSchema, {
      title: 'x'.repeat(201),
      organizationId: UUID_A,
      currency: 'PLN',
    });
    rejects(crm.CreateOpportunityRequestSchema, { title: 'x', organizationId: UUID_A, currency: 'zloty' });
    rejects(crm.CreateOpportunityRequestSchema, {
      title: 'x',
      organizationId: UUID_A,
      currency: 'PLN',
      manualValue: '-1.00',
    });
    rejects(crm.CreateOpportunityRequestSchema, {
      title: 'x',
      organizationId: UUID_A,
      currency: 'PLN',
      expectedCloseDate: '31.12.2026',
    });
  });

  it('refuses a well-formed date the calendar does not have, wherever a date is taken', () => {
    const body = { title: 'x', organizationId: UUID_A, currency: 'PLN' };
    for (const impossible of ['2026-02-31', '2026-13-01', '2026-00-10', '2026-04-31', '2025-02-29', '0000-01-01']) {
      rejects(crm.CreateOpportunityRequestSchema, { ...body, expectedCloseDate: impossible });
      rejects(crm.UpdateOpportunityRequestSchema, { expectedCloseDate: impossible });
      rejects(crm.OpportunityListQuerySchema, { createdFrom: impossible });
      rejects(crm.OpportunityListQuerySchema, { createdTo: impossible });
    }
    for (const real of ['2024-02-29', '2026-12-31', '2026-01-01']) {
      accepts(crm.CreateOpportunityRequestSchema, { ...body, expectedCloseDate: real });
      accepts(crm.OpportunityListQuerySchema, { createdFrom: real, createdTo: real });
    }
  });

  it('update: accepts a partial body and refuses the two immutable fields', () => {
    accepts(crm.UpdateOpportunityRequestSchema, { title: 'Renamed', manualValue: null });
    rejects(crm.UpdateOpportunityRequestSchema, { organizationId: UUID_B });
    rejects(crm.UpdateOpportunityRequestSchema, { currency: 'EUR' });
  });
});

describe('§2 transition', () => {
  it('accepts a status code with an optional reason; rejects a malformed code and an over-long reason', () => {
    accepts(crm.TransitionOpportunityRequestSchema, { to: 'qualified' });
    accepts(crm.TransitionOpportunityRequestSchema, { to: 'lost', reason: 'Budget withdrawn' });
    rejects(crm.TransitionOpportunityRequestSchema, { to: 'Qualified!' });
    rejects(crm.TransitionOpportunityRequestSchema, { to: 'won', reason: 'x'.repeat(2001) });
  });
});

describe('§3 links', () => {
  it('create: accepts both document kinds; rejects an unknown kind and a non-uuid id', () => {
    accepts(crm.CreateOpportunityLinkRequestSchema, { documentKind: 'order', documentId: UUID_A });
    accepts(crm.CreateOpportunityLinkRequestSchema, {
      documentKind: 'quote_request',
      documentId: UUID_A,
      syncStatus: false,
    });
    rejects(crm.CreateOpportunityLinkRequestSchema, { documentKind: 'invoice', documentId: UUID_A });
    rejects(crm.CreateOpportunityLinkRequestSchema, { documentKind: 'order', documentId: '42' });
  });

  it('update: requires the boolean', () => {
    accepts(crm.UpdateOpportunityLinkRequestSchema, { syncStatus: false });
    rejects(crm.UpdateOpportunityLinkRequestSchema, {});
  });
});

describe('§4 workflow configuration', () => {
  it('create status: accepts a full status; rejects a bad code, kind and colour', () => {
    accepts(crm.CreateOpportunityStatusRequestSchema, {
      code: 'in_delivery',
      name: { en: 'In delivery', pl: 'W dostawie' },
      defaultName: 'In delivery',
      kind: 'open',
    });
    rejects(crm.CreateOpportunityStatusRequestSchema, {
      code: 'In-Delivery',
      defaultName: 'In delivery',
      kind: 'open',
    });
    rejects(crm.CreateOpportunityStatusRequestSchema, {
      code: 'in_delivery',
      defaultName: 'In delivery',
      kind: 'closed',
    });
    rejects(crm.CreateOpportunityStatusRequestSchema, {
      code: 'in_delivery',
      defaultName: 'In delivery',
      kind: 'open',
      color: 'red',
    });
  });

  it('update status: accepts a partial body and refuses a code change', () => {
    accepts(crm.UpdateOpportunityStatusRequestSchema, { weight: 35, isInitial: true });
    rejects(crm.UpdateOpportunityStatusRequestSchema, { code: 'renamed' });
  });

  it('transitions: accepts add/remove edge lists; rejects a self-edge', () => {
    accepts(crm.SetOpportunityTransitionsRequestSchema, {
      add: [{ fromStatusCode: 'new', toStatusCode: 'qualified' }],
      remove: [{ fromStatusCode: 'lost', toStatusCode: 'new' }],
    });
    rejects(crm.SetOpportunityTransitionsRequestSchema, {
      add: [{ fromStatusCode: 'new', toStatusCode: 'new' }],
    });
  });

  it('order-status mappings: accepts both directions; rejects an unknown direction', () => {
    accepts(crm.SetOrderStatusMappingsRequestSchema, {
      mappings: [
        { direction: 'opportunity_to_order', opportunityStatusCode: 'won', orderStatusCode: 'processing' },
        {
          direction: 'order_to_opportunity',
          opportunityStatusCode: 'won',
          orderStatusCode: 'completed',
          requireAllOrders: true,
        },
      ],
    });
    rejects(crm.SetOrderStatusMappingsRequestSchema, {
      mappings: [{ direction: 'both', opportunityStatusCode: 'won', orderStatusCode: 'completed' }],
    });
    rejects(crm.SetOrderStatusMappingsRequestSchema, {});
  });

  it('value-counting statuses: accepts order codes and the fixed quote statuses; rejects an unknown quote status', () => {
    accepts(crm.SetValueCountingStatusesRequestSchema, {
      order: ['paid', 'completed'],
      quoteRequest: ['Approved', 'Completed'],
    });
    rejects(crm.SetValueCountingStatusesRequestSchema, { order: [], quoteRequest: ['approved'] });
  });
});

describe('§5 assignment', () => {
  it('accepts a user id or an explicit null; rejects an absent field', () => {
    accepts(crm.AssignOpportunityRequestSchema, { adminUserId: UUID_A });
    accepts(crm.AssignOpportunityRequestSchema, { adminUserId: null });
    rejects(crm.AssignOpportunityRequestSchema, {});
  });
});

describe('§6 notes and messages', () => {
  it('list query: accepts either kind; rejects another', () => {
    accepts(crm.OpportunityCommentListQuerySchema, { kind: 'note' });
    rejects(crm.OpportunityCommentListQuerySchema, { kind: 'email' });
  });

  it('create: accepts a body of 1…10 000 characters; rejects an empty and an over-long one', () => {
    accepts(crm.CreateOpportunityCommentRequestSchema, { kind: 'message', body: 'Called the buyer.' });
    rejects(crm.CreateOpportunityCommentRequestSchema, { kind: 'note', body: '' });
    rejects(crm.CreateOpportunityCommentRequestSchema, { kind: 'note', body: 'x'.repeat(10_001) });
  });

  it('update: carries the body only', () => {
    accepts(crm.UpdateOpportunityCommentRequestSchema, { body: 'Corrected.' });
    rejects(crm.UpdateOpportunityCommentRequestSchema, { body: '' });
  });
});

describe('§7 attachments', () => {
  it('accepts an asset id; rejects a non-uuid', () => {
    accepts(crm.CreateOpportunityAttachmentRequestSchema, { assetId: UUID_A });
    rejects(crm.CreateOpportunityAttachmentRequestSchema, { assetId: 'file.pdf' });
  });
});

describe('§8 tags', () => {
  it('create: accepts a name with an optional colour; rejects an empty and an over-long name', () => {
    accepts(crm.CreateOpportunityTagRequestSchema, { name: 'Key account' });
    accepts(crm.CreateOpportunityTagRequestSchema, { name: 'Key account', color: '#0ea5e9' });
    rejects(crm.CreateOpportunityTagRequestSchema, { name: '' });
    rejects(crm.CreateOpportunityTagRequestSchema, { name: 'x'.repeat(65) });
  });

  it('update: accepts a partial body; rejects a bad colour', () => {
    accepts(crm.UpdateOpportunityTagRequestSchema, { color: '#112233' });
    rejects(crm.UpdateOpportunityTagRequestSchema, { color: 'blue' });
  });

  it('set tags: replaces the set with uuids; rejects a non-uuid member', () => {
    accepts(crm.SetOpportunityTagsRequestSchema, { tagIds: [] });
    accepts(crm.SetOpportunityTagsRequestSchema, { tagIds: [UUID_A, UUID_B] });
    rejects(crm.SetOpportunityTagsRequestSchema, { tagIds: ['vip'] });
  });
});

describe('§9 reference tokens', () => {
  it('formats a token for each reference type', () => {
    expect(crm.formatOpportunityReferenceToken('product', UUID_A)).toBe(`[[product:${UUID_A}]]`);
    expect(crm.formatOpportunityReferenceToken('order', UUID_B)).toBe(`[[order:${UUID_B}]]`);
  });

  it('extracts every well-formed token, in order, with duplicates collapsed', () => {
    const text = `Quote [[product:${UUID_A}]] against [[order:${UUID_B}]], again [[product:${UUID_A}]].`;
    expect(crm.extractOpportunityReferenceTokens(text)).toEqual([
      { type: 'product', id: UUID_A },
      { type: 'order', id: UUID_B },
    ]);
  });

  it('ignores an unknown type, a non-uuid id and an unterminated token', () => {
    const text = `[[invoice:${UUID_A}]] [[product:42]] [[order:${UUID_B}] [product:${UUID_A}]`;
    expect(crm.extractOpportunityReferenceTokens(text)).toEqual([]);
  });

  it('the reference shape accepts an unavailable target with no label', () => {
    accepts(crm.OpportunityReferenceSchema, {
      type: 'order',
      id: UUID_A,
      available: false,
      label: null,
      url: null,
    });
    rejects(crm.OpportunityReferenceSchema, { type: 'customer', id: UUID_A, available: true, label: 'x', url: null });
  });

  // User Story 18 — a person is the third thing a text can refer to.
  it('formats, extracts and splits a mention of a person beside the other two', () => {
    expect(crm.formatOpportunityReferenceToken('admin_user', UUID_A)).toBe(`[[admin_user:${UUID_A}]]`);
    const text = `[[admin_user:${UUID_A}]] - take this over, see [[order:${UUID_B}]]`;
    expect(crm.extractOpportunityReferenceTokens(text)).toEqual([
      { type: 'admin_user', id: UUID_A },
      { type: 'order', id: UUID_B },
    ]);
    expect(crm.splitOpportunityReferenceText(text)[0]).toEqual({
      kind: 'reference',
      type: 'admin_user',
      id: UUID_A,
    });
    // The word the platform does not use for an administrator is not a token.
    expect(crm.extractOpportunityReferenceTokens(`[[user:${UUID_A}]] [[admin:${UUID_A}]]`)).toEqual([]);
  });

  it('a resolved person has a name and no address; the shape is the one of the other two', () => {
    accepts(crm.OpportunityReferenceSchema, {
      type: 'admin_user',
      id: UUID_A,
      available: true,
      label: 'Tomasz Nowak',
      url: null,
    });
  });

  it('mentionedAdminUserIds answers the people of a text, each once, and nothing for no text', () => {
    const text = `[[admin_user:${UUID_A}]] [[product:${UUID_B}]] [[admin_user:${UUID_A.toUpperCase()}]]`;
    expect(crm.mentionedAdminUserIds(text)).toEqual([UUID_A]);
    expect(crm.mentionedAdminUserIds(null)).toEqual([]);
    expect(crm.mentionedAdminUserIds('jan@example.com @Tomasz')).toEqual([]);
  });
});

describe('§10a the people who may be mentioned', () => {
  it('query: an optional search, an optional Organization and a limit', () => {
    expect(crm.OpportunityMentionLookupQuerySchema.parse({}).limit).toBe(20);
    accepts(crm.OpportunityMentionLookupQuerySchema, { q: 'tom', organizationId: UUID_A, limit: '5' });
    rejects(crm.OpportunityMentionLookupQuerySchema, { organizationId: 'nope' });
    rejects(crm.OpportunityMentionLookupQuerySchema, { limit: '51' });
  });

  it('answer: an id and a name, and nothing else survives the schema', () => {
    const parsed = crm.OpportunityMentionLookupResponseSchema.parse({
      data: [{ id: UUID_A, name: 'Tomasz Nowak', email: 'tomasz@example.com' }],
    });
    expect(parsed.data).toEqual([{ id: UUID_A, name: 'Tomasz Nowak' }]);
  });
});

describe('§10 board', () => {
  it('accepts the list filters and perColumn; has no status filter of its own', () => {
    const parsed = crm.OpportunityBoardQuerySchema.parse({ tagId: UUID_A, perColumn: '20' });
    expect(parsed.perColumn).toBe(20);
    expect(parsed.tagId).toEqual([UUID_A]);
    expect(crm.OpportunityBoardQuerySchema.parse({}).perColumn).toBe(50);
    expect('statusCode' in crm.OpportunityBoardQuerySchema.parse({ statusCode: 'new' })).toBe(false);
    rejects(crm.OpportunityBoardQuerySchema, { perColumn: '0' });
  });
});

describe('§11 history', () => {
  it('accepts limit and cursor; rejects a limit above the page maximum', () => {
    accepts(crm.OpportunityHistoryQuerySchema, { limit: '20', cursor: 'abc' });
    rejects(crm.OpportunityHistoryQuerySchema, { limit: '500' });
  });

  it('the answer says whether earlier entries exist beyond its reach', () => {
    const page = { data: [], pagination: { cursor: null, hasMore: false, limit: 50 } };
    rejects(crm.OpportunityHistoryResponseSchema, page);
    accepts(crm.OpportunityHistoryResponseSchema, { ...page, truncated: false });
    accepts(crm.OpportunityHistoryResponseSchema, { ...page, truncated: true });
  });

  it('an entry carries the references of the texts it shows, resolved for its reader', () => {
    const entry = {
      id: 'a1',
      actedAt: '2026-10-07T10:00:00.000Z',
      action: 'crm.opportunity.update',
      actor: { kind: 'admin', id: UUID_A, name: 'Ada Min' },
      before: { description: null },
      after: { description: `[[admin_user:${UUID_B}]]` },
    };
    rejects(crm.OpportunityHistoryEntrySchema, entry);
    accepts(crm.OpportunityHistoryEntrySchema, {
      ...entry,
      references: [{ type: 'admin_user', id: UUID_B, available: true, label: 'Tomasz Nowak', url: null }],
    });
  });
});

describe('§12 analytics', () => {
  it('range query: requires from and to as dates; accepts the two optional filters', () => {
    accepts(crm.OpportunityAnalyticsQuerySchema, { from: '2026-09-01', to: '2026-09-30' });
    accepts(crm.OpportunityAnalyticsQuerySchema, {
      from: '2026-09-01',
      to: '2026-09-30',
      salesChannelId: UUID_A,
      assignedAdminUserId: UUID_B,
    });
    rejects(crm.OpportunityAnalyticsQuerySchema, { from: '2026-09-01' });
    rejects(crm.OpportunityAnalyticsQuerySchema, { from: 'September', to: '2026-09-30' });
  });

  it('time-in-status: adds the status filter', () => {
    const parsed = crm.OpportunityTimeInStatusQuerySchema.parse({
      from: '2026-09-01',
      to: '2026-09-30',
      statusCode: 'proposal',
    });
    expect(parsed.statusCode).toEqual(['proposal']);
  });

  it('top opportunities: defaults limit to 10 and basis to created; rejects another basis', () => {
    const parsed = crm.TopOpportunitiesQuerySchema.parse({ from: '2026-09-01', to: '2026-09-30' });
    expect(parsed.limit).toBe(10);
    expect(parsed.basis).toBe('created');
    rejects(crm.TopOpportunitiesQuerySchema, { from: '2026-09-01', to: '2026-09-30', basis: 'won' });
  });
});

describe('opportunityStatusEventName', () => {
  it('builds the four templated names', () => {
    const p = { from: 'proposal', to: 'won' };
    expect(crm.opportunityStatusEventName('fromToBefore', p)).toBe(
      'crm.opportunity.status.from_proposal_to_won.before',
    );
    expect(crm.opportunityStatusEventName('fromBefore', { from: 'proposal' })).toBe(
      'crm.opportunity.status.from_proposal.before',
    );
    expect(crm.opportunityStatusEventName('fromToAfter', p)).toBe(
      'crm.opportunity.status.from_proposal_to_won.after',
    );
    expect(crm.opportunityStatusEventName('toAfter', { to: 'won' })).toBe(
      'crm.opportunity.status.to_won.after',
    );
  });

  it('names the coarse and lifecycle events once', () => {
    expect(crm.CRM_EVENTS).toEqual({
      STATUS_CHANGED: 'crm.opportunity.status_changed.v1',
      CREATED: 'crm.opportunity.created.v1',
      CLOSED: 'crm.opportunity.closed.v1',
      ASSIGNED: 'crm.opportunity.assigned.v1',
      DOCUMENT_LINKED: 'crm.opportunity.document_linked.v1',
    });
  });
});

describe('OpportunityTransitionOutcome', () => {
  /**
   * The `never` assignment is the exhaustiveness proof: a variant added to the
   * union without a branch here is a type error, and `tsc` is the instrument.
   */
  function describeOutcome(outcome: OpportunityTransitionOutcome): string {
    if (outcome.applied) return `applied:${outcome.from}->${outcome.to}`;
    switch (outcome.reason) {
      case 'already_there':
        return `already_there:${outcome.from}`;
      case 'not_found':
      case 'unknown_status':
      case 'not_permitted':
      case 'vetoed':
        return `${outcome.reason}:${outcome.detail}`;
      default: {
        const unreachable: never = outcome;
        return unreachable;
      }
    }
  }

  it('every variant is a value a caller can branch on', () => {
    expect(describeOutcome({ applied: true, from: 'new', to: 'qualified' })).toBe('applied:new->qualified');
    expect(describeOutcome({ applied: false, reason: 'already_there', from: 'new' })).toBe('already_there:new');
    for (const reason of crm.OPPORTUNITY_TRANSITION_REFUSALS) {
      expect(describeOutcome({ applied: false, reason, from: null, detail: 'why' })).toBe(`${reason}:why`);
    }
    expect([...crm.OPPORTUNITY_TRANSITION_REFUSALS]).toEqual([
      'not_found',
      'unknown_status',
      'not_permitted',
      'vetoed',
    ]);
  });

  it('a veto carries the transition it refused', () => {
    const veto = new crm.OpportunityTransitionVetoError('Contract not signed', 'negotiation', 'won');
    expect(veto).toBeInstanceOf(Error);
    expect(veto.name).toBe('OpportunityTransitionVetoError');
    expect(veto.message).toBe('Contract not signed');
    expect([veto.from, veto.to]).toEqual(['negotiation', 'won']);
  });
});

/**
 * `contracts/events-and-ports.md` §6 — the three events offered to outbound
 * webhooks. The delivery bridge serialises an event whole, so **the event
 * payload is the webhook payload**, and these schemas are a public contract: a
 * field added to an event is a reviewed change here, or the strict parse — and
 * the test that holds every emitted event to it — refuses it.
 */
describe('outbound webhook event schemas (events-and-ports.md §6)', () => {
  const envelope = { eventId: 'evt-1', occurredAt: '2026-10-05T12:00:00.000Z' };

  const statusChanged = {
    ...envelope,
    opportunityId: UUID_A,
    number: 'OPP-000123',
    organizationId: UUID_B,
    salesChannelId: null,
    from: 'new',
    to: 'won',
    fromKind: 'open',
    toKind: 'won',
    actor: { kind: 'admin', adminUserId: UUID_A },
    cause: 'manual',
    reason: null,
  };
  const created = { ...envelope, opportunityId: UUID_A, number: 'OPP-000123', organizationId: UUID_B, source: 'manual' };
  const closed = {
    ...envelope,
    opportunityId: UUID_A,
    organizationId: UUID_B,
    outcome: 'won',
    value: '1500.00',
    currency: 'PLN',
  };

  const offered = [
    ['crm.opportunity.status_changed.v1', crm.OpportunityStatusChangedEventV1Schema, statusChanged],
    ['crm.opportunity.created.v1', crm.OpportunityCreatedEventV1Schema, created],
    ['crm.opportunity.closed.v1', crm.OpportunityClosedEventV1Schema, closed],
  ] as const;

  it('names exactly the three offered event types, each with its schema', () => {
    expect(Object.keys(crm.CRM_WEBHOOK_EVENT_SCHEMAS).sort()).toEqual(offered.map(([name]) => name).sort());
    for (const [name, schema] of offered) expect(crm.CRM_WEBHOOK_EVENT_SCHEMAS[name]).toBe(schema);
    expect(crm.CRM_WEBHOOK_EVENT_TYPES).toEqual([
      crm.CRM_EVENTS.STATUS_CHANGED,
      crm.CRM_EVENTS.CREATED,
      crm.CRM_EVENTS.CLOSED,
    ]);
  });

  it.each(offered)('%s accepts its payload', (_name, schema, payload) => {
    accepts(schema, payload);
  });

  it.each(offered)('%s is strict — a field the contract does not name is refused', (_name, schema, payload) => {
    rejects(schema, { ...payload, title: 'Leaked' });
    rejects(schema, { ...payload, description: 'Leaked' });
    rejects(schema, { ...payload, anythingElse: 1 });
  });

  it.each(offered)('%s carries eventId, occurredAt, opportunityId and organizationId', (_name, schema, payload) => {
    for (const field of ['eventId', 'occurredAt', 'opportunityId', 'organizationId']) {
      const { [field]: _dropped, ...rest } = payload as Record<string, unknown>;
      rejects(schema, rest);
    }
    rejects(schema, { ...payload, organizationId: null });
    rejects(schema, { ...payload, occurredAt: 'yesterday' });
  });

  it('carries the fields of §6 and no other', () => {
    expect(Object.keys(crm.OpportunityStatusChangedEventV1Schema.shape).sort()).toEqual(
      [
        'eventId',
        'occurredAt',
        'opportunityId',
        'number',
        'organizationId',
        'salesChannelId',
        'from',
        'to',
        'fromKind',
        'toKind',
        'actor',
        'cause',
        'causeOrderId',
        'reason',
      ].sort(),
    );
    expect(Object.keys(crm.OpportunityCreatedEventV1Schema.shape).sort()).toEqual(
      ['eventId', 'occurredAt', 'opportunityId', 'number', 'organizationId', 'source'].sort(),
    );
    expect(Object.keys(crm.OpportunityClosedEventV1Schema.shape).sort()).toEqual(
      ['eventId', 'occurredAt', 'opportunityId', 'organizationId', 'outcome', 'value', 'currency'].sort(),
    );
  });

  it('holds no free text: no title, description, note or message body in any of the three', () => {
    const FREE_TEXT = ['title', 'description', 'body', 'note', 'message', 'comment', 'name'];
    for (const [name, schema] of offered) {
      for (const field of FREE_TEXT) {
        expect(Object.keys(schema.shape), `${name}.${field}`).not.toContain(field);
      }
    }
  });

  it('status_changed: the actor is strict, causeOrderId is optional, reason may be a short text', () => {
    const schema = crm.OpportunityStatusChangedEventV1Schema;
    accepts(schema, { ...statusChanged, actor: { kind: 'system' } });
    accepts(schema, { ...statusChanged, cause: 'order_status', causeOrderId: UUID_B });
    accepts(schema, { ...statusChanged, reason: 'Budget confirmed', salesChannelId: UUID_A });
    rejects(schema, { ...statusChanged, actor: { kind: 'admin', adminUserId: UUID_A, name: 'Leaked' } });
    rejects(schema, { ...statusChanged, actor: { kind: 'customer' } });
    rejects(schema, { ...statusChanged, cause: 'webhook' });
    rejects(schema, { ...statusChanged, toKind: 'closed' });
    rejects(schema, { ...statusChanged, reason: 'x'.repeat(2001) });
  });

  it('closed: one event for won and lost, told apart by outcome; the value may be absent', () => {
    const schema = crm.OpportunityClosedEventV1Schema;
    accepts(schema, { ...closed, outcome: 'lost', value: null });
    rejects(schema, { ...closed, outcome: 'open' });
    rejects(schema, { ...closed, currency: 'zloty' });
  });

  it('created: the source is one of the three', () => {
    for (const source of ['manual', 'order', 'quote_request']) {
      accepts(crm.OpportunityCreatedEventV1Schema, { ...created, source });
    }
    rejects(crm.OpportunityCreatedEventV1Schema, { ...created, source: 'import' });
  });
});

describe('splitOpportunityReferenceText', () => {
  const product = '11111111-1111-4111-8111-111111111111';
  const order = '22222222-2222-4222-8222-2222222222AB';

  it('cuts a text at its tokens and keeps everything else as text', () => {
    const text = `Ask about [[product:${product}]] and [[order:${order}]].`;
    const parts = crm.splitOpportunityReferenceText(text);
    expect(parts).toEqual([
      { kind: 'text', text: 'Ask about ' },
      { kind: 'reference', type: 'product', id: product },
      { kind: 'text', text: ' and ' },
      { kind: 'reference', type: 'order', id: order.toLowerCase() },
      { kind: 'text', text: '.' },
    ]);
  });

  it('leaves a malformed token, and markup, as text', () => {
    const text = '[[product:not-a-uuid]] <b>bold</b> [[invoice:1]]';
    expect(crm.splitOpportunityReferenceText(text)).toEqual([{ kind: 'text', text }]);
  });

  it('answers nothing for an empty text and repeats a token as often as it appears', () => {
    expect(crm.splitOpportunityReferenceText('')).toEqual([]);
    const twice = `[[product:${product}]][[product:${product}]]`;
    expect(crm.splitOpportunityReferenceText(twice)).toHaveLength(2);
  });
});

describe('board card fields and field filters (§12c, US19)', () => {
  it('a field reference is builtin:<key> or custom:<definition key>', () => {
    accepts(crm.opportunityBoardFieldRefSchema, 'builtin:organization');
    accepts(crm.opportunityBoardFieldRefSchema, 'custom:lead_source');
    rejects(crm.opportunityBoardFieldRefSchema, 'organization');
    rejects(crm.opportunityBoardFieldRefSchema, 'custom:Lead Source');
    rejects(crm.opportunityBoardFieldRefSchema, 'other:thing');
  });

  it('the default card is built-in fields within the limit', () => {
    expect(crm.OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS.length).toBeLessThanOrEqual(
      crm.OPPORTUNITY_BOARD_CARD_MAX_FIELDS,
    );
    for (const ref of crm.OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS) {
      const key = ref.replace(/^builtin:/, '');
      expect(crm.OPPORTUNITY_BOARD_BUILTIN_FIELD_KEYS).toContain(key);
    }
  });

  it('the configuration takes six fields at most and none twice', () => {
    const schema = crm.SetOpportunityBoardCardFieldsRequestSchema;
    accepts(schema, { fields: [] });
    accepts(schema, { fields: ['builtin:value', 'custom:lead_source'] });
    rejects(schema, { fields: ['builtin:value', 'builtin:value'] });
    rejects(schema, { fields: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((key) => `custom:${key}`) });
    rejects(schema, { fields: ['builtin:value'], extra: true });
  });

  it('fieldFilters is a JSON object of operators per field, on the list and on the board', () => {
    const raw = JSON.stringify({
      'custom:lead_source': { in: ['referral'] },
      'builtin:value': { min: '100', max: '2500.50' },
      'builtin:expectedCloseDate': { from: '2026-01-01', to: '2026-12-31' },
      'custom:vip': { is: false },
      'builtin:number': { contains: ' 0042 ' },
    });
    for (const schema of [crm.OpportunityListQuerySchema, crm.OpportunityBoardQuerySchema]) {
      const parsed = schema.parse({ fieldFilters: raw });
      expect(parsed.fieldFilters?.['custom:lead_source']).toEqual({ in: ['referral'] });
      expect(parsed.fieldFilters?.['builtin:number']).toEqual({ contains: '0042' });
      expect(schema.parse({}).fieldFilters).toBeUndefined();
      rejects(schema, { fieldFilters: '{not json' });
      rejects(schema, { fieldFilters: JSON.stringify({ lead_source: { in: ['x'] } }) });
      rejects(schema, { fieldFilters: JSON.stringify({ 'custom:a': { like: 'x' } }) });
      rejects(schema, { fieldFilters: JSON.stringify({ 'custom:a': { min: 'ten' } }) });
      rejects(schema, { fieldFilters: JSON.stringify({ 'custom:a': { from: '2026-02-30' } }) });
      rejects(schema, { fieldFilters: JSON.stringify(['custom:a']) });
    }
  });

  it('a refused field filter is located once: fieldFilters, the field, the operator (N-BFR6)', () => {
    const result = crm.OpportunityBoardQuerySchema.safeParse({
      fieldFilters: JSON.stringify({ 'custom:a': { from: '2026-02-30' } }),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['fieldFilters', 'custom:a', 'from']]);
  });

  it('the list adds card values only when asked', () => {
    expect(crm.OpportunityListQuerySchema.parse({}).cardValues).toBeUndefined();
    expect(crm.OpportunityListQuerySchema.parse({ cardValues: 'true' }).cardValues).toBe(true);
    expect(crm.OpportunityListQuerySchema.parse({ cardValues: 'false' }).cardValues).toBeUndefined();
    rejects(crm.OpportunityListQuerySchema, { cardValues: 'yes' });
  });
});

describe('events and the calendar (§12d, US21, US22)', () => {
  const event = {
    name: 'Site visit',
    allDay: false,
    startsAt: '2026-11-03T10:00:00+01:00',
    endsAt: '2026-11-03T11:30:00+01:00',
    timeZone: 'Europe/Warsaw',
  };

  it('create: accepts a timed Event, trims its name and takes the optional members', () => {
    accepts(crm.CreateOpportunityEventRequestSchema, event);
    expect(crm.CreateOpportunityEventRequestSchema.parse({ ...event, name: '  Site visit  ' }).name).toBe(
      'Site visit',
    );
    accepts(crm.CreateOpportunityEventRequestSchema, {
      ...event,
      description: 'Bring the samples.',
      remindAt: '2026-11-03T08:00:00.000Z',
    });
    accepts(crm.CreateOpportunityEventRequestSchema, { ...event, description: null, remindAt: null });
    expect(crm.CreateOpportunityEventRequestSchema.parse(event).remindAt).toBeUndefined();
  });

  it('create: the name is 1 to 200 characters after trimming, the description 5 000 at most', () => {
    rejects(crm.CreateOpportunityEventRequestSchema, { ...event, name: '' });
    rejects(crm.CreateOpportunityEventRequestSchema, { ...event, name: '   ' });
    accepts(crm.CreateOpportunityEventRequestSchema, { ...event, name: 'x'.repeat(200) });
    rejects(crm.CreateOpportunityEventRequestSchema, { ...event, name: 'x'.repeat(201) });
    accepts(crm.CreateOpportunityEventRequestSchema, { ...event, description: 'x'.repeat(5000) });
    rejects(crm.CreateOpportunityEventRequestSchema, { ...event, description: 'x'.repeat(5001) });
  });

  it('create: refuses an end that is not after the start, located on endsAt', () => {
    rejects(crm.CreateOpportunityEventRequestSchema, { ...event, endsAt: event.startsAt });
    const result = crm.CreateOpportunityEventRequestSchema.safeParse({
      ...event,
      endsAt: '2026-11-03T09:59:00+01:00',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['endsAt']]);
    // The same instant written with two offsets is still not after itself.
    rejects(crm.CreateOpportunityEventRequestSchema, {
      ...event,
      startsAt: '2026-11-03T10:00:00+01:00',
      endsAt: '2026-11-03T09:00:00Z',
    });
  });

  it('create: refuses a span over 25 hours and takes exactly 25 (the long day of a DST change)', () => {
    accepts(crm.CreateOpportunityEventRequestSchema, {
      ...event,
      allDay: true,
      startsAt: '2026-10-24T22:00:00.000Z',
      endsAt: '2026-10-25T23:00:00.000Z',
    });
    rejects(crm.CreateOpportunityEventRequestSchema, {
      ...event,
      allDay: true,
      startsAt: '2026-10-24T22:00:00.000Z',
      endsAt: '2026-10-25T23:00:00.001Z',
    });
    expect(crm.OPPORTUNITY_EVENT_MAX_SPAN_HOURS).toBe(25);
  });

  it('create: the zone is required and at most 64 characters; instants carry an offset', () => {
    const { timeZone: _timeZone, ...withoutZone } = event;
    rejects(crm.CreateOpportunityEventRequestSchema, withoutZone);
    rejects(crm.CreateOpportunityEventRequestSchema, { ...event, timeZone: '' });
    rejects(crm.CreateOpportunityEventRequestSchema, { ...event, timeZone: 'x'.repeat(65) });
    rejects(crm.CreateOpportunityEventRequestSchema, { ...event, startsAt: '2026-11-03T10:00:00' });
    rejects(crm.CreateOpportunityEventRequestSchema, { ...event, startsAt: '2026-11-03' });
    rejects(crm.CreateOpportunityEventRequestSchema, { ...event, remindAt: 'tomorrow' });
    rejects(crm.CreateOpportunityEventRequestSchema, { ...event, allDay: 'yes' });
  });

  it('update: every member optional, strict, and the two rules held when both instants are given', () => {
    const schema = crm.UpdateOpportunityEventRequestSchema;
    accepts(schema, {});
    accepts(schema, { name: 'Renamed' });
    accepts(schema, { remindAt: null });
    accepts(schema, { description: null });
    // One instant alone cannot be judged without the stored one: the service does that.
    accepts(schema, { endsAt: '2026-11-03T09:00:00+01:00' });
    expect(schema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
    rejects(schema, { name: ' ' });
    rejects(schema, { startsAt: event.startsAt, endsAt: event.startsAt });
    rejects(schema, { startsAt: '2026-11-03T10:00:00Z', endsAt: '2026-11-04T11:00:00.001Z' });
    rejects(schema, { opportunityId: UUID_A });
  });

  it('the refusals of a well-formed Event are five rules', () => {
    expect(crm.opportunityEventRuleSchema.options).toEqual([
      'ends_before_start',
      'spans_days',
      'not_whole_day',
      'unknown_time_zone',
      'reminder_in_past',
    ]);
  });

  const stored = {
    id: UUID_A,
    opportunityId: UUID_B,
    name: 'Site visit',
    description: null,
    allDay: false,
    startsAt: '2026-11-03T09:00:00.000Z',
    endsAt: '2026-11-03T10:30:00.000Z',
    timeZone: 'Europe/Warsaw',
    allDayDate: null,
    reminder: null,
    createdBy: { id: UUID_A, name: 'Ada Lovelace' },
    createdAt: '2026-10-08T10:00:00.000Z',
    updatedAt: '2026-10-08T10:00:00.000Z',
  };

  it('OpportunityEvent: a timed Event with no reminder, an all-day one with its date, a removed author', () => {
    accepts(crm.OpportunityEventSchema, stored);
    accepts(crm.OpportunityEventSchema, {
      ...stored,
      allDay: true,
      startsAt: '2026-11-02T23:00:00.000Z',
      endsAt: '2026-11-03T23:00:00.000Z',
      allDayDate: '2026-11-03',
      description: 'Trade fair',
      createdBy: null,
    });
    rejects(crm.OpportunityEventSchema, { ...stored, allDayDate: '2026-02-31' });
    rejects(crm.OpportunityEventSchema, { ...stored, allDayDate: '03.11.2026' });
    const { timeZone: _timeZone, ...withoutZone } = stored;
    rejects(crm.OpportunityEventSchema, withoutZone);
    accepts(crm.OpportunityEventResponseSchema, { data: stored });
    accepts(crm.OpportunityEventListResponseSchema, { data: [stored] });
  });

  it('OpportunityEvent: each reminder state, with channels exactly when it was sent', () => {
    const reminder = (state: string, channels: string[], handledAt: string | null = null) => ({
      ...stored,
      reminder: { at: '2026-11-03T08:00:00.000Z', state, handledAt, channels },
    });
    expect(crm.opportunityEventReminderStateSchema.options).toEqual([
      'scheduled',
      'paused',
      'sent',
      'missed',
      'no_recipient',
      'undeliverable',
      'interrupted',
    ]);
    for (const state of crm.opportunityEventReminderStateSchema.options) {
      if (state === 'sent') continue;
      accepts(crm.OpportunityEventSchema, reminder(state, []));
      rejects(crm.OpportunityEventSchema, reminder(state, ['bell']));
    }
    const handledAt = '2026-11-03T08:00:20.000Z';
    accepts(crm.OpportunityEventSchema, reminder('sent', ['bell'], handledAt));
    accepts(crm.OpportunityEventSchema, reminder('sent', ['email'], handledAt));
    accepts(crm.OpportunityEventSchema, reminder('sent', ['bell', 'email'], handledAt));
    rejects(crm.OpportunityEventSchema, reminder('sent', [], handledAt));
    rejects(crm.OpportunityEventSchema, reminder('sent', ['sms'], handledAt));
    rejects(crm.OpportunityEventSchema, reminder('sending', []));
  });

  it('calendar query: a range of instants, with an optional scope', () => {
    const schema = crm.CalendarEventsQuerySchema;
    const parsed = schema.parse({ from: '2026-11-01T00:00:00.000Z', to: '2026-11-08T00:00:00.000Z' });
    expect(parsed.scope).toBeUndefined();
    accepts(schema, { from: '2026-11-01T00:00:00.000Z', to: '2026-11-08T00:00:00.000Z', scope: 'mine' });
    accepts(schema, { from: '2026-11-01T00:00:00.000Z', to: '2026-11-08T00:00:00.000Z', scope: 'all' });
    rejects(schema, { from: '2026-11-01T00:00:00.000Z', to: '2026-11-08T00:00:00.000Z', scope: 'team' });
    rejects(schema, { from: '2026-11-01', to: '2026-11-08' });
    rejects(schema, { from: '2026-11-01T00:00:00.000Z' });
    rejects(schema, {});
  });

  it('calendar query: refuses an end not after the start and a range over 45 days', () => {
    const schema = crm.CalendarEventsQuerySchema;
    const from = '2026-11-01T00:00:00.000Z';
    rejects(schema, { from, to: from });
    rejects(schema, { from, to: '2026-10-31T23:59:59.000Z' });
    accepts(schema, { from, to: '2026-12-16T00:00:00.000Z' });
    rejects(schema, { from, to: '2026-12-16T00:00:00.001Z' });
    rejects(schema, { from, to: '2026-12-17T00:00:00.000Z' });
    expect(crm.CALENDAR_EVENTS_MAX_RANGE_DAYS).toBe(45);
    const result = schema.safeParse({ from, to: '2026-12-17T00:00:00.000Z' });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['to']]);
  });

  const drawn = {
    id: UUID_A,
    name: 'Site visit',
    allDay: false,
    startsAt: '2026-11-03T09:00:00.000Z',
    endsAt: '2026-11-03T10:30:00.000Z',
    allDayDate: null,
    hasReminder: true,
    opportunity: {
      id: UUID_B,
      number: 'OPP-000042',
      title: 'Fleet renewal',
      assignee: { id: UUID_A, name: 'Ada Lovelace' },
    },
  };

  it('CalendarEvent: what a calendar draws — and no description', () => {
    accepts(crm.CalendarEventSchema, drawn);
    accepts(crm.CalendarEventSchema, { ...drawn, opportunity: { ...drawn.opportunity, assignee: null } });
    expect(Object.keys(crm.CalendarEventSchema.shape)).not.toContain('description');
    expect(crm.CalendarEventSchema.parse({ ...drawn, description: 'Private.' })).not.toHaveProperty(
      'description',
    );
    const { hasReminder: _hasReminder, ...withoutFlag } = drawn;
    rejects(crm.CalendarEventSchema, withoutFlag);
    const { opportunity: _opportunity, ...withoutOpportunity } = drawn;
    rejects(crm.CalendarEventSchema, withoutOpportunity);
  });

  it('CalendarEventsMeta: the scope applied, the scopes offered, and whether the answer was cut', () => {
    accepts(crm.CalendarEventsMetaSchema, { scope: 'all', scopes: ['all', 'mine'], truncated: false });
    accepts(crm.CalendarEventsMetaSchema, { scope: 'mine', scopes: ['mine'], truncated: true });
    rejects(crm.CalendarEventsMetaSchema, { scope: 'mine', scopes: [], truncated: false });
    rejects(crm.CalendarEventsMetaSchema, { scope: 'team', scopes: ['mine'], truncated: false });
    rejects(crm.CalendarEventsMetaSchema, { scope: 'mine', scopes: ['mine'] });
    accepts(crm.CalendarEventsResponseSchema, {
      data: [drawn],
      meta: { scope: 'mine', scopes: ['mine'], truncated: false },
    });
    rejects(crm.CalendarEventsResponseSchema, { data: [drawn] });
    expect(crm.CALENDAR_EVENTS_MAX_RESULTS).toBe(500);
  });

  it('OpportunityDetail carries upcomingEventCount, and the summary does not', () => {
    expect(Object.keys(crm.OpportunityDetailSchema.shape)).toContain('upcomingEventCount');
    expect(Object.keys(crm.OpportunitySummarySchema.shape)).not.toContain('upcomingEventCount');
    const count = crm.OpportunityDetailSchema.shape.upcomingEventCount;
    accepts(count, 0);
    accepts(count, 3);
    rejects(count, -1);
    rejects(count, 1.5);
    rejects(count, undefined);
  });
});
