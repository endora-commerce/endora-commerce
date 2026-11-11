import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 045 (T033) — Rule Builder picker endpoints return option lists,
 * gated by promotions:read.
 */
describe('Promotion rule-target pickers (feature 045)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const restricted = { b2b_session: 'stub-restricted-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const kinds = [
    'sales-channels',
    'customer-groups',
    'organizations',
    'categories',
    'payment-methods',
    'delivery-methods',
  ];

  it('returns an items array for every picker', async () => {
    for (const kind of kinds) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/promotions/rule-targets/${kind}`,
        cookies: adminCookie,
      });
      expect(res.statusCode, kind).toBe(200);
      const body = res.json() as { data: { items: unknown[] } };
      expect(Array.isArray(body.data.items), kind).toBe(true);
    }
  });

  it('gates the pickers behind promotions:read', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/promotions/rule-targets/categories',
      cookies: restricted,
    });
    expect(res.statusCode).toBe(403);
  });

  // `specs/177-tax-id-scope/` T024 (X7) — a personal Organization has no tax ID,
  // so the organization picker carries `taxId: null` for it, never a placeholder.
  it('answers taxId null for a personal Organization and the tax ID for a company', async () => {
    const personal = randomUUID();
    const company = randomUUID();
    const companyTaxId = `PL177${company.slice(0, 8).toUpperCase()}`;
    const insert = `insert into "organizations"
        ("id","name","tax_id","status","vat_status","is_personal","registered_address","path","created_at","updated_at")
      values (?, ?, ?, 'active', ?, ?, '{}'::jsonb, ?, now(), now())`;
    await h.em().execute(insert, [personal, '000 177 personal', null, 'vat_exempt', true, `/${personal}/`]);
    await h.em().execute(insert, [company, '000 177 company', companyTaxId, 'vat_payer', false, `/${company}/`]);
    try {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/promotions/rule-targets/organizations',
        cookies: adminCookie,
      });
      expect(res.statusCode, res.body).toBe(200);
      const items = (res.json() as { data: { items: Array<{ id: string; taxId: string | null }> } }).data.items;
      expect(items.find((item) => item.id === personal)).toMatchObject({ taxId: null });
      expect(items.find((item) => item.id === company)).toMatchObject({ taxId: companyTaxId });
    } finally {
      await h.em().execute('delete from "organizations" where "id" in (?, ?)', [personal, company]);
    }
  });
});
