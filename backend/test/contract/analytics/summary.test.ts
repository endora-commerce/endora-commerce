import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AnalyticsEvent } from '../../../src/modules/analytics/entities/analytics-event.entity.js';

/**
 * T237 — admin summary endpoint returns totals by type and a daily series
 * within the requested time window. Salesforce-channel filter narrows the
 * aggregation when supplied.
 */

describe('GET /api/v1/admin/analytics/summary', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const baseDay = new Date('2026-04-01T12:00:00Z');
    const otherDay = new Date('2026-04-02T08:30:00Z');
    em.create(AnalyticsEvent, { type: 'product.viewed', occurredAt: baseDay });
    em.create(AnalyticsEvent, { type: 'product.viewed', occurredAt: baseDay });
    em.create(AnalyticsEvent, { type: 'product.viewed', occurredAt: otherDay });
    em.create(AnalyticsEvent, { type: 'search.performed', occurredAt: baseDay });
    await em.flush();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns totals by type and a per-day breakdown', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/analytics/summary?from=2026-04-01T00:00:00Z&to=2026-04-03T00:00:00Z',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        totalsByType: Array<{ type: string; count: number }>;
        daily: Array<{ day: string; type: string; count: number }>;
      };
    };
    const productTotal = body.data.totalsByType.find((t) => t.type === 'product.viewed');
    const searchTotal = body.data.totalsByType.find((t) => t.type === 'search.performed');
    expect(productTotal?.count).toBe(3);
    expect(searchTotal?.count).toBe(1);

    const day1Product = body.data.daily.find(
      (d) => d.day === '2026-04-01' && d.type === 'product.viewed',
    );
    const day2Product = body.data.daily.find(
      (d) => d.day === '2026-04-02' && d.type === 'product.viewed',
    );
    expect(day1Product?.count).toBe(2);
    expect(day2Product?.count).toBe(1);
  });

  it('rejects unauthenticated callers', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/analytics/summary?from=2026-04-01T00:00:00Z&to=2026-04-03T00:00:00Z',
    });
    expect(res.statusCode).toBe(401);
  });
});
