import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 011 / US2 — Engine routes contract (T033).
 *
 * Covers the `/api/v1/admin/price-lists-engine` surface from
 * `contracts/price-lists.contract.md`.
 */
const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

describe('Admin Price Lists engine routes (feature 011 US2)', () => {
  let h: BackendServerHandle;
  let createdId: string | undefined;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('POST /price-lists-engine creates a draft list', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/price-lists-engine',
      cookies: ADMIN_COOKIE,
      payload: { name: 'Test list', type: 'base' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      data: {
        id: string;
        name: string;
        type: 'base' | 'sale';
        status: 'draft' | 'active' | 'scheduled' | 'expired';
        startsAt: string | null;
        endsAt: string | null;
        applicationRule: unknown;
        isSystem: boolean;
      };
    };
    expect(body.data.name).toBe('Test list');
    expect(body.data.type).toBe('base');
    expect(body.data.status).toBe('draft');
    expect(body.data.applicationRule).toEqual({ kind: 'all' });
    expect(body.data.isSystem).toBe(false);
    createdId = body.data.id;
  });

  it('GET /price-lists-engine/:id returns the list', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/price-lists-engine/${createdId}`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { id: string } };
    expect(body.data.id).toBe(createdId);
  });

  it('PATCH /price-lists-engine/:id updates the name + bumps modifiedAt', async () => {
    // Capture the initial modifiedAt.
    const before = (
      await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/price-lists-engine/${createdId}`,
        cookies: ADMIN_COOKIE,
      })
    ).json() as { data: { modifiedAt: string } };

    await new Promise((r) => setTimeout(r, 10));

    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/price-lists-engine/${createdId}`,
      cookies: ADMIN_COOKIE,
      payload: { name: 'Renamed' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { name: string; modifiedAt: string } };
    expect(body.data.name).toBe('Renamed');
    expect(new Date(body.data.modifiedAt).getTime()).toBeGreaterThan(
      new Date(before.data.modifiedAt).getTime(),
    );
  });

  it('POST /activate moves a draft → active immediately when no future dates', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/price-lists-engine/${createdId}/activate`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { status: string } };
    expect(body.data.status).toBe('active');
  });

  it('POST /draftify moves an active → draft', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/price-lists-engine/${createdId}/draftify`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { status: string } };
    expect(body.data.status).toBe('draft');
  });

  it('POST /duplicate creates a draft copy with " (copy)" suffix', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/price-lists-engine/${createdId}/duplicate`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { id: string; name: string; status: string } };
    expect(body.data.name).toMatch(/\(copy\)$/);
    expect(body.data.status).toBe('draft');
    expect(body.data.id).not.toBe(createdId);
  });

  it('POST returns 400 when endsAt <= startsAt', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/price-lists-engine',
      cookies: ADMIN_COOKIE,
      payload: {
        name: 'Bad dates',
        type: 'sale',
        startsAt: '2026-06-01T00:00:00.000Z',
        endsAt: '2026-05-01T00:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /internal/sweep returns transition counts', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/price-lists-engine/internal/sweep',
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { scheduledToActive: number; activeToExpired: number };
    };
    expect(body.data).toHaveProperty('scheduledToActive');
    expect(body.data).toHaveProperty('activeToExpired');
  });
});
