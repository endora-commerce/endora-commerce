import { describe, expect, it, vi } from 'vitest';
import type { OpportunityReference } from '@endora-commerce/contracts';
import { HISTORY_REACH, OpportunityHistoryService } from './opportunity-history-service.js';

/**
 * What the history endpoint adds to an audit entry, against stub ports: the
 * references of the texts it shows (User Story 18, FR-084).
 */

const OPPORTUNITY = '00000000-0000-4000-8000-0000000000d1';
const TOMASZ = '00000000-0000-4000-8000-0000000000a1';
const ANNA = '00000000-0000-4000-8000-0000000000a2';

const person = (id: string, label: string): OpportunityReference => ({
  type: 'admin_user',
  id,
  available: true,
  label,
  url: null,
});

interface StubEntry {
  id: string;
  actedAt: Date;
  action: string;
  actorAdminUserId: string | null;
  stateBefore: unknown;
  stateAfter: unknown;
}

function entry(index: number, before: unknown, after: unknown): StubEntry {
  return {
    id: `entry-${index}`,
    actedAt: new Date(Date.UTC(2026, 9, 7, 12, 0, 0) - index * 1000),
    action: 'crm.opportunity.update',
    actorAdminUserId: null,
    stateBefore: before,
    stateAfter: after,
  };
}

interface StubValueChange {
  id: string;
  opportunityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

function build(
  entries: StubEntry[],
  mayReadCustomFields: () => Promise<boolean> = async () => true,
  stored: StubValueChange[] = [],
) {
  const query = vi.fn(async (filter: { limit?: number }) =>
    // As the port does: newest first, never more than its cap.
    entries.slice(0, Math.min(filter.limit ?? 100, 500)),
  );
  const resolveMany = vi.fn(async (texts: ReadonlyArray<string | null | undefined>) =>
    texts.map((text) => [
      ...((text ?? '').includes(TOMASZ) ? [person(TOMASZ, 'Tomasz Nowak')] : []),
      ...((text ?? '').includes(ANNA) ? [person(ANNA, 'Anna Żak')] : []),
    ]),
  );
  // The value store, read as the scoped EntityManager reads it: by the
  // Opportunity's id and the ids the page points at.
  const find = vi.fn(async (_entity: unknown, where: { opportunityId: string; id: { $in: string[] } }) =>
    stored.filter((row) => row.opportunityId === where.opportunityId && where.id.$in.includes(row.id)),
  );
  const service = new OpportunityHistoryService({
    emFactory: () => ({ findOne: async () => ({ id: OPPORTUNITY }), find }) as never,
    auditLog: { query } as never,
    adminUsers: { findByIds: async () => [] } as never,
    references: { resolveMany },
    mayReadCustomFields,
  });
  return { service, query, resolveMany, find };
}

/** The audit port's own cap (`AuditPort.query`): it never answers more, whatever is asked. */
const PORT_CAP = 500;

describe('OpportunityHistoryService — the reach of a history (second review)', () => {
  const many = (count: number): StubEntry[] => Array.from({ length: count }, (_, index) => entry(index, null, null));

  /** Every page from the first, as a reader pressing *Show earlier changes* gets them. */
  async function readAll(service: OpportunityHistoryService, limit = 200) {
    const ids: string[] = [];
    const flags: boolean[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard += 1) {
      const page = await service.list(OPPORTUNITY, { limit, ...(cursor ? { cursor } : {}) });
      ids.push(...page.data.map((item) => item.id));
      flags.push(page.truncated);
      if (!page.pagination.hasMore || !page.pagination.cursor) return { ids, flags };
      cursor = page.pagination.cursor;
    }
    throw new Error('the history did not end');
  }

  it('serves one entry fewer than the port can answer, so the last one proves there is more', () => {
    expect(HISTORY_REACH).toBe(PORT_CAP - 1);
  });

  it('a short history is whole: nothing is cut and nothing says so', async () => {
    const { service } = build(many(3));
    const page = await service.list(OPPORTUNITY, { limit: 50 });
    expect(page.data).toHaveLength(3);
    expect(page.pagination.hasMore).toBe(false);
    expect(page.truncated).toBe(false);
  });

  it('a history of exactly the reach is whole too', async () => {
    const { service } = build(many(HISTORY_REACH));
    const { ids, flags } = await readAll(service);
    expect(ids).toHaveLength(HISTORY_REACH);
    expect(flags.every((flag) => flag === false)).toBe(true);
  });

  it('a longer history ends at the reach and says, on its last page only, that earlier entries exist', async () => {
    const { service } = build(many(PORT_CAP + 100));
    const { ids, flags } = await readAll(service);
    expect(ids).toHaveLength(HISTORY_REACH);
    expect(new Set(ids).size).toBe(HISTORY_REACH);
    expect(ids[0]).toBe('entry-0');
    expect(ids.at(-1)).toBe(`entry-${HISTORY_REACH - 1}`);
    // Pages with a next page do not claim it: only the end of what can be read does.
    expect(flags.slice(0, -1).every((flag) => flag === false)).toBe(true);
    expect(flags.at(-1)).toBe(true);
  });

  it('one entry past the reach is enough to say so', async () => {
    const { service } = build(many(HISTORY_REACH + 1));
    const { ids, flags } = await readAll(service);
    expect(ids).toHaveLength(HISTORY_REACH);
    expect(flags.at(-1)).toBe(true);
  });

  it('never asks the port for more than it answers', async () => {
    const { service, query } = build(many(PORT_CAP + 100));
    await readAll(service);
    for (const [filter] of query.mock.calls) expect(filter.limit).toBeLessThanOrEqual(PORT_CAP);
  });
});

describe('OpportunityHistoryService — references of an audited text', () => {
  it('carries what the description named before and names after, per entry, in one resolution for the page', async () => {
    const { service, resolveMany } = build([
      entry(0, { description: `Ask [[admin_user:${TOMASZ}]]` }, { description: `Ask [[admin_user:${ANNA}]]` }),
      entry(1, { title: 'Fleet' }, { title: 'Fleet renewal' }),
      entry(2, null, { description: `For [[admin_user:${TOMASZ}]]`, title: 'Fleet' }),
    ]);
    const page = await service.list(OPPORTUNITY, { limit: 50 });
    expect(page.data.map((item) => item.references)).toEqual([
      [person(TOMASZ, 'Tomasz Nowak'), person(ANNA, 'Anna Żak')],
      [],
      [person(TOMASZ, 'Tomasz Nowak')],
    ]);
    expect(resolveMany).toHaveBeenCalledTimes(1);
    // The audited state is returned as it was written.
    expect(page.data[0]?.after).toEqual({ description: `Ask [[admin_user:${ANNA}]]` });
  });

  it('reads no text out of a key that is not one — a note’s audited length, a title', async () => {
    const { service, resolveMany } = build([
      entry(0, null, { commentId: 'c', kind: 'note', length: 12, title: `[[admin_user:${TOMASZ}]]` }),
    ]);
    const page = await service.list(OPPORTUNITY, { limit: 50 });
    expect(page.data[0]?.references).toEqual([]);
    expect(resolveMany.mock.calls[0]?.[0]).toEqual(['']);
  });
});

/**
 * Owner ruling P2 = a (`specs/162-custom-fields-value-carry/`, review fixes
 * 2026-10-21): an Opportunity's custom-field values are served in its history
 * only to a caller who may read custom fields; a carry's skip lines name a
 * field and a reason, never a value, and stay.
 */
describe('OpportunityHistoryService — custom-field values and custom_fields:read', () => {
  const carry = {
    source: { entityType: 'order', recordId: 'o-1', reference: 'ORD-1' },
    carried: ['lead_source'],
    skipped: [{ key: 'seats', reason: 'target_missing', label: { labelDefault: 'Seats', labels: {} } }],
  };
  const entries = [
    entry(0, { title: 'A', customFieldValues: { lead_source: 'fair' } }, {
      title: 'B',
      customFieldValues: { lead_source: 'web' },
      customFieldCarry: carry,
    }),
    entry(1, null, { title: 'A', customFieldValues: { lead_source: 'fair' } }),
    entry(2, null, { title: 'Untouched' }),
  ];

  it('strips customFieldValues from every before and after for a caller who may not read them, and keeps the rest', async () => {
    const { service } = build(entries, async () => false);
    const page = await service.list(OPPORTUNITY, { limit: 50 });
    expect(page.data.map((item) => [item.before, item.after])).toEqual([
      [{ title: 'A' }, { title: 'B', customFieldCarry: carry }],
      [null, { title: 'A' }],
      [null, { title: 'Untouched' }],
    ]);
  });

  it('serves them unchanged to a caller who may', async () => {
    const { service } = build(entries, async () => true);
    const page = await service.list(OPPORTUNITY, { limit: 50 });
    expect(page.data.map((item) => [item.before, item.after])).toEqual(
      entries.map((item) => [item.stateBefore, item.stateAfter]),
    );
  });

  it('asks once per page', async () => {
    const check = vi.fn(async () => false);
    const { service } = build(entries, check);
    await service.list(OPPORTUNITY, { limit: 50 });
    expect(check).toHaveBeenCalledTimes(1);
  });
});

/**
 * Issue #470 (D-288) — an entry names what a write changed and points at the
 * Opportunity's own value store; the history serves the values from there.
 */
describe('OpportunityHistoryService — values from the Opportunity’s own store (#470)', () => {
  const V1 = '00000000-0000-4000-8000-0000000004f1';
  const V2 = '00000000-0000-4000-8000-0000000004f2';
  const OTHER_OPPORTUNITY = '00000000-0000-4000-8000-0000000000d2';
  const named = (changed: Record<string, unknown>, pointer: string) => ({
    number: 'OPP-000001',
    statusCode: 'new',
    ...changed,
    valueChangeId: pointer,
  });

  it('serves the stored values in place of the names, as entries before #470 carried them', async () => {
    const { service, find } = build(
      [entry(0, { number: 'OPP-000001', statusCode: 'new' }, named({ changedFields: ['title'] }, V1))],
      async () => true,
      [{ id: V1, opportunityId: OPPORTUNITY, before: { title: 'Fleet' }, after: { title: 'Fleet renewal' } }],
    );
    const page = await service.list(OPPORTUNITY, { limit: 50 });
    expect(page.data[0]?.before).toEqual({ number: 'OPP-000001', statusCode: 'new', title: 'Fleet' });
    expect(page.data[0]?.after).toEqual({ number: 'OPP-000001', statusCode: 'new', title: 'Fleet renewal' });
    expect(find).toHaveBeenCalledTimes(1);
    expect(find.mock.calls[0]?.[1]).toEqual({ opportunityId: OPPORTUNITY, id: { $in: [V1] } });
  });

  it('reads only this Opportunity’s rows: a pointer to another one’s serves the names, never its values', async () => {
    const { service } = build(
      [entry(0, null, named({ changedFields: ['title'] }, V2))],
      async () => true,
      [{ id: V2, opportunityId: OTHER_OPPORTUNITY, before: null, after: { title: 'Not yours' } }],
    );
    const page = await service.list(OPPORTUNITY, { limit: 50 });
    expect(page.data[0]?.after).toEqual({ number: 'OPP-000001', statusCode: 'new', changedFields: ['title'] });
  });

  it('follows a pointer on the side that has one — a removed Event names itself before', async () => {
    const { service } = build(
      [entry(0, { eventId: 'e', changedFields: ['eventName'], valueChangeId: V1 }, { eventId: 'e', deleted: true })],
      async () => true,
      [{ id: V1, opportunityId: OPPORTUNITY, before: { eventName: 'Kick-off' }, after: null }],
    );
    const page = await service.list(OPPORTUNITY, { limit: 50 });
    expect(page.data[0]?.before).toEqual({ eventId: 'e', eventName: 'Kick-off' });
    expect(page.data[0]?.after).toEqual({ eventId: 'e', deleted: true });
  });

  it('resolves the references of a stored description', async () => {
    const { service } = build(
      [entry(0, null, named({ changedFields: ['description'] }, V1))],
      async () => true,
      [{ id: V1, opportunityId: OPPORTUNITY, before: null, after: { description: `Ask [[admin_user:${TOMASZ}]]` } }],
    );
    const page = await service.list(OPPORTUNITY, { limit: 50 });
    expect(page.data[0]?.references).toEqual([person(TOMASZ, 'Tomasz Nowak')]);
  });

  it('serves stored custom-field values, and their names, only to a caller who may read custom fields', async () => {
    const entries = [entry(0, null, named({ changedFields: ['title'], changedCustomFields: ['risk'] }, V1))];
    const stored = [
      { id: V1, opportunityId: OPPORTUNITY, before: null, after: { title: 'A', customFieldValues: { risk: 'high' } } },
    ];
    const hidden = await build(entries, async () => false, stored).service.list(OPPORTUNITY, { limit: 50 });
    expect(hidden.data[0]?.after).toEqual({ number: 'OPP-000001', statusCode: 'new', title: 'A' });
    const shown = await build(entries, async () => true, stored).service.list(OPPORTUNITY, { limit: 50 });
    expect(shown.data[0]?.after).toEqual({
      number: 'OPP-000001',
      statusCode: 'new',
      title: 'A',
      customFieldValues: { risk: 'high' },
    });
  });

  it('hides the names of changed custom fields from a caller who may not read them, when no row is found', async () => {
    const { service } = build([entry(0, null, named({ changedCustomFields: ['risk'] }, V1))], async () => false);
    const page = await service.list(OPPORTUNITY, { limit: 50 });
    expect(page.data[0]?.after).toEqual({ number: 'OPP-000001', statusCode: 'new' });
  });

  it('reads no store for a page that points at none', async () => {
    const { service, find } = build([entry(0, null, { title: 'Before #470' })]);
    const page = await service.list(OPPORTUNITY, { limit: 50 });
    expect(find).not.toHaveBeenCalled();
    // An entry written before #470 keeps its audited values: nothing rewrites it (O-4).
    expect(page.data[0]?.after).toEqual({ title: 'Before #470' });
  });
});
