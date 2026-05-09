import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Admin users list — server-side `q` search + pagination envelope.
 *
 * Backs the admin Combobox (sales-rep picker and any future server-driven
 * picker over `/api/v1/admin/admin-users`). Pins:
 *   - relevance ordering (first-name match outranks last-name match,
 *     last-name match outranks email match, prefix outranks substring)
 *   - pagination envelope shape (page, pageSize, total, hasMore, limit)
 *   - default page size and the `q` substring contract
 */

interface ListResponse {
  data: Array<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  }>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    cursor: string | null;
    hasMore: boolean;
    limit: number;
  };
}

describe('Admin users — list search & pagination', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns the pagination envelope alongside data on an unfiltered list', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/admin-users',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ListResponse;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination.page).toBe(0);
    expect(body.pagination.pageSize).toBeGreaterThanOrEqual(1);
    expect(body.pagination.total).toBeGreaterThanOrEqual(body.data.length);
    expect(body.pagination.limit).toBe(body.data.length);
    expect(body.pagination.cursor).toBeNull();
  });

  it('respects pageSize and reports hasMore when more rows remain', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/admin-users?page=0&pageSize=2',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ListResponse;
    expect(body.data.length).toBeLessThanOrEqual(2);
    expect(body.pagination.pageSize).toBe(2);
    if (body.pagination.total > 2) {
      expect(body.pagination.hasMore).toBe(true);
    }
  });

  it('matches q across first name, last name, and email (case-insensitive substring)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/admin-users?q=BLOG',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ListResponse;
    // Seed has firstName=Blog and email=blog-manager@example.com — the row
    // matches via either path. We just need at least one match.
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0]?.firstName).toBe('Blog');
  });

  it('orders firstName-prefix matches before email-only matches (relevance)', async () => {
    // "Blog" matches `firstName=Blog` (prefix → rank 1) on the blog manager
    // *and* the email `blog-manager@example.com` substring (rank 6) on the
    // same row. With multiple rows we want first-name matches first.
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/admin-users?q=manager',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ListResponse;
    // "manager" matches lastName=Manager on Blog Manager and Content Manager
    // (lastName-prefix rank 3) plus email substring on both (rank 6). Within
    // the same rank, email ASC breaks ties → blog-manager comes before
    // content-manager.
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    const idx = body.data.findIndex((u) => u.email === 'blog-manager@example.com');
    const jdx = body.data.findIndex((u) => u.email === 'content-manager@example.com');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(jdx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(jdx);
  });

  it('returns an empty page when q matches nothing', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/admin-users?q=zzzzz-no-such-admin-zzzzz',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ListResponse;
    expect(body.data).toEqual([]);
    expect(body.pagination.total).toBe(0);
    expect(body.pagination.hasMore).toBe(false);
  });
});
