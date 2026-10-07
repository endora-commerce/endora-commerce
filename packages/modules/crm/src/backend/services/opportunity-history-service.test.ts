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

function build(entries: StubEntry[]) {
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
  const service = new OpportunityHistoryService({
    emFactory: () => ({ findOne: async () => ({ id: OPPORTUNITY }) }) as never,
    auditLog: { query } as never,
    adminUsers: { findByIds: async () => [] } as never,
    references: { resolveMany },
  });
  return { service, query, resolveMany };
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
