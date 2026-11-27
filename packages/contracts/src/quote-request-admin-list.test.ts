import { describe, expect, it } from 'vitest';
import {
  ADMIN_QUOTE_REQUEST_LIST_PAGE_SIZE_MAX,
  adminQuoteRequestListQuerySchema,
  adminQuoteRequestListResponseSchema,
} from './quote-requests.js';

/**
 * Issue #317 — the admin quote request list is paged, filtered and sorted by
 * the server, so its query is a published shape and its pagination block is
 * true for the response.
 */
describe('adminQuoteRequestListQuerySchema (issue #317)', () => {
  it('defaults to the first page of 25, newest change first', () => {
    expect(adminQuoteRequestListQuerySchema.parse({})).toEqual({
      sort: 'updatedAt:desc',
      page: 1,
      pageSize: 25,
    });
  });

  it('bounds the page size', () => {
    expect(ADMIN_QUOTE_REQUEST_LIST_PAGE_SIZE_MAX).toBe(200);
    expect(adminQuoteRequestListQuerySchema.safeParse({ pageSize: '200' }).success).toBe(true);
    expect(adminQuoteRequestListQuerySchema.safeParse({ pageSize: '201' }).success).toBe(false);
    expect(adminQuoteRequestListQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('reads the saved-view vocabulary: scope, organization, status, search and sort', () => {
    const parsed = adminQuoteRequestListQuerySchema.parse({
      assignmentScope: 'unassigned',
      organizationId: '00000000-0000-4000-8000-000000000001',
      status: 'Pending,Approved',
      q: '  ACME ',
      sort: 'total:asc',
      page: '3',
      pageSize: '50',
    });
    expect(parsed).toEqual({
      assignmentScope: 'unassigned',
      organizationId: '00000000-0000-4000-8000-000000000001',
      status: ['Pending', 'Approved'],
      q: 'ACME',
      sort: 'total:asc',
      page: 3,
      pageSize: 50,
    });
  });

  it('accepts status repeated as well as comma-separated, and drops an unknown status as before', () => {
    expect(adminQuoteRequestListQuerySchema.parse({ status: ['Pending', 'Expired'] }).status).toEqual([
      'Pending',
      'Expired',
    ]);
    expect(adminQuoteRequestListQuerySchema.parse({ status: 'submitted' }).status).toBeUndefined();
    expect(adminQuoteRequestListQuerySchema.parse({ status: 'Created from admin,nope' }).status).toEqual([
      'Created from admin',
    ]);
  });

  it('treats an empty search as none', () => {
    expect(adminQuoteRequestListQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
  });

  it('refuses a sort, scope or organization outside its vocabulary', () => {
    expect(adminQuoteRequestListQuerySchema.safeParse({ sort: 'createdAt:desc' }).success).toBe(false);
    expect(adminQuoteRequestListQuerySchema.safeParse({ assignmentScope: 'everyone' }).success).toBe(false);
    expect(adminQuoteRequestListQuerySchema.safeParse({ organizationId: 'acme' }).success).toBe(false);
  });
});

describe('adminQuoteRequestListResponseSchema (issue #317)', () => {
  it('carries the page it read, its size and the total', () => {
    const parsed = adminQuoteRequestListResponseSchema.safeParse({
      data: [],
      pagination: { page: 2, pageSize: 25, total: 26, limit: 25, hasMore: false, nextCursor: null },
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(
      adminQuoteRequestListResponseSchema.safeParse({
        data: [],
        pagination: { limit: 50, nextCursor: null, hasMore: false },
      }).success,
    ).toBe(false);
  });
});

describe('adminQuoteRequestListQuerySchema — sharing (`specs/192-quote-request-draft-share/`)', () => {
  it('reads `sharing=unshared|shared`; absent is both', () => {
    expect(adminQuoteRequestListQuerySchema.parse({ sharing: 'unshared' }).sharing).toBe('unshared');
    expect(adminQuoteRequestListQuerySchema.parse({ sharing: 'shared' }).sharing).toBe('shared');
    expect(adminQuoteRequestListQuerySchema.parse({})).not.toHaveProperty('sharing');
  });

  it('refuses any other value', () => {
    expect(adminQuoteRequestListQuerySchema.safeParse({ sharing: 'foo' }).success).toBe(false);
  });
});
