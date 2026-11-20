import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { AuditLogService } from '../../composition/index.js';
import { AuditLogEntry } from './audit-log-entry.entity.js';

/**
 * Issue #1555 (UX audit SHELL-20) — the audit viewer pages through the log and
 * offers the actions and object types it holds instead of asking for codes.
 *
 * `query` pages by keyset: `(actedAt desc, id desc)`, and `after` names the last
 * row of the previous page. The id breaks a tie on `actedAt`, without which two
 * entries recorded in the same millisecond would be skipped or repeated across
 * a page boundary. `queryFacets` is two statements, neither a scan of the table.
 */

function serviceWith(em: Partial<Record<'find' | 'getConnection', unknown>>): AuditLogService {
  return new AuditLogService(() => em as unknown as EntityManager);
}

describe('AuditLogService.query — keyset pages', () => {
  it('orders newest first with the id as the tie-break', async () => {
    const find = vi.fn().mockResolvedValue([]);
    await serviceWith({ find }).query({ action: 'product.update' });
    expect(find).toHaveBeenCalledWith(
      AuditLogEntry,
      { action: 'product.update' },
      { orderBy: { actedAt: 'desc', id: 'desc' }, limit: 100 },
    );
  });

  it('reads the rows strictly after the given position, under the other filters', async () => {
    const find = vi.fn().mockResolvedValue([]);
    const actedAt = new Date('2026-11-20T10:00:00.000Z');
    const id = '00000000-0000-4000-8000-000000001555';
    await serviceWith({ find }).query({ objectType: 'product', after: { actedAt, id }, limit: 2 });
    expect(find).toHaveBeenCalledWith(
      AuditLogEntry,
      {
        objectType: 'product',
        $or: [{ actedAt: { $lt: actedAt } }, { actedAt, id: { $lt: id } }],
      },
      { orderBy: { actedAt: 'desc', id: 'desc' }, limit: 2 },
    );
  });

  it('still caps a page at 500 rows', async () => {
    const find = vi.fn().mockResolvedValue([]);
    await serviceWith({ find }).query({ limit: 10_000 });
    expect(find.mock.calls[0]![2]).toMatchObject({ limit: 500 });
  });
});

describe('AuditLogService.queryFacets', () => {
  it('answers the distinct actions, sorted, and the object types they were recorded for', async () => {
    const execute = vi.fn().mockResolvedValue([
      { action: 'order.create', object_type: 'order' },
      { action: 'product.update', object_type: 'product' },
      { action: 'product.create', object_type: 'product' },
    ]);
    const facets = await serviceWith({ getConnection: () => ({ execute }) }).queryFacets();
    expect(facets).toEqual({
      actions: ['order.create', 'product.create', 'product.update'],
      objectTypes: ['order', 'product'],
    });
    expect(execute).toHaveBeenCalledTimes(1);
    // A loose index scan over `action` — a recursive step to the next value,
    // never a `select distinct` over every row.
    const sql = String(execute.mock.calls[0]![0]).toLowerCase();
    expect(sql).toContain('with recursive');
    expect(sql).not.toMatch(/select\s+distinct/);
  });

  it('answers two empty lists for an empty log', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    await expect(serviceWith({ getConnection: () => ({ execute }) }).queryFacets()).resolves.toEqual({
      actions: [],
      objectTypes: [],
    });
  });
});
