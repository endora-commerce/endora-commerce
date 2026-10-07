import { describe, expect, it, vi } from 'vitest';
import type { OpportunityReference } from '@endora-commerce/contracts';
import { OpportunityHistoryService } from './opportunity-history-service.js';

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
  const query = vi.fn(async (filter: { limit?: number }) => entries.slice(0, filter.limit ?? 100));
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
