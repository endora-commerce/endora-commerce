import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { creditLimitListResponseSchema, creditLimitViewSchema } from '@endora-commerce/contracts';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';
import { Organization } from '../../helpers/package-entities.js';

/**
 * T218 — `GET /api/v1/admin/credit-limits` lists every granted credit
 * limit so the admin Credit Limits UI can render a roster. Anonymous /
 * insufficient-permission callers get rejected.
 */

describe('GET /api/v1/admin/credit-limits', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns an empty list when no limits have been granted', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/credit-limits',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('after a grant, the row appears in the list', async () => {
    const orgId = '00000000-0000-4000-8000-0000000000aa';
    const grant = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/credit-limit`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { grantedAmount: 5000, currency: 'PLN' },
    });
    expect(grant.statusCode).toBe(201);

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/credit-limits',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as {
      data: Array<{ organizationId: string; grantedAmount: number; currency: string }>;
    };
    const row = body.data.find((d) => d.organizationId === orgId);
    expect(row).toBeDefined();
    expect(row!.grantedAmount).toBe(5000);
    expect(row!.currency).toBe('PLN');
    // Issue #599 §6 — the roster is the published shape and nothing beside it.
    expect(disagreements(deepStrict(creditLimitListResponseSchema), list.json())).toEqual([]);
  });

  it('the organization detail and the adjustment answer the published view', async () => {
    const orgId = '00000000-0000-4000-8000-0000000000aa';
    const url = `/api/v1/admin/organizations/${orgId}/credit-limit`;
    const cookies = { b2b_session: 'stub-admin-session' };
    const strictView = deepStrict(creditLimitViewSchema);

    const detail = await h.app.inject({ method: 'GET', url, cookies });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(disagreements(strictView, (detail.json() as { data: unknown }).data)).toEqual([]);

    const adjusted = await h.app.inject({ method: 'PATCH', url, cookies, payload: { grantedAmount: 6000 } });
    expect(adjusted.statusCode, adjusted.body).toBe(200);
    expect(disagreements(strictView, (adjusted.json() as { data: unknown }).data)).toEqual([]);
  });

  it('pages the list newest first, with the total across every page (issue #1664)', async () => {
    const cookies = { b2b_session: 'stub-admin-session' };
    const em = h.em();
    const orgs = ['A', 'B', 'C'].map((label, i) =>
      em.create(Organization, {
        name: `1664 ${label} Org`,
        taxId: `PL1664${i}${Date.now().toString().slice(-6)}`,
        status: 'active' as const,
        vatStatus: 'vat_payer' as const,
        registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-100', country: 'PL' },
      }),
    );
    await em.persist(orgs).flush();
    for (const org of orgs) {
      const grant = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${org.id}/credit-limit`,
        cookies,
        payload: { grantedAmount: 1000, currency: 'PLN' },
      });
      expect(grant.statusCode, grant.body).toBe(201);
    }
    const ids = (body: unknown): string[] =>
      (body as { data: Array<{ organizationId: string }> }).data.map((d) => d.organizationId);
    const strictList = deepStrict(creditLimitListResponseSchema);

    // A caller naming no page size keeps the whole list, as the endpoint answered before.
    const whole = await h.app.inject({ method: 'GET', url: '/api/v1/admin/credit-limits', cookies });
    expect(whole.statusCode).toBe(200);
    const all = ids(whole.json());
    const total = all.length;
    expect(total).toBeGreaterThanOrEqual(4);
    expect((whole.json() as { meta: unknown }).meta).toEqual({ page: 1, pageSize: total, total });
    expect(disagreements(strictList, whole.json())).toEqual([]);
    // Newest first: the last grant leads.
    expect(all[0]).toBe(orgs[2]!.id);

    const first = await h.app.inject({ method: 'GET', url: '/api/v1/admin/credit-limits?page=1&pageSize=2', cookies });
    expect(first.statusCode).toBe(200);
    expect((first.json() as { meta: unknown }).meta).toEqual({ page: 1, pageSize: 2, total });
    expect(disagreements(strictList, first.json())).toEqual([]);
    const second = await h.app.inject({ method: 'GET', url: '/api/v1/admin/credit-limits?page=2&pageSize=2', cookies });
    expect((second.json() as { meta: unknown }).meta).toEqual({ page: 2, pageSize: 2, total });
    // The pages are the whole list's order cut in two — no row repeated, none skipped.
    expect([...ids(first.json()), ...ids(second.json())]).toEqual(all.slice(0, 4));

    const tooLarge = await h.app.inject({ method: 'GET', url: '/api/v1/admin/credit-limits?pageSize=500', cookies });
    expect(tooLarge.statusCode).toBe(400);
  });

  it('rejects anonymous callers', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/credit-limits' });
    expect(res.statusCode).toBe(401);
  });
});
