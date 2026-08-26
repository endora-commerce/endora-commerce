import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 026 US8 — Picker search endpoint.
 *
 * `GET /api/v1/admin/organizations?q=...` must be diacritic-insensitive:
 * a query of "lodz" and a query of "Łódź" must both find an Organization
 * whose canonical name is "Bauhaus Łódź". The denormalized `name_search`
 * column populated by the entity's @BeforeCreate / @BeforeUpdate hooks
 * is what makes this work without needing the pg_trgm/unaccent
 * extensions (research.md R9 revision).
 */
describe('Picker search — diacritic-insensitive (feature 026 US8)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    const orgs = ['Bauhaus Łódź', 'Castorama Kraków', 'Leroy Wrocław', 'Tabor Żywiec'];
    for (const name of orgs) {
      const o = em.create(Organization, {
        name,
        taxId: `PL026US8${Math.floor(Math.random() * 9_999_999_999)
          .toString()
          .padStart(10, '0')}`,
        status: 'active',
        vatStatus: 'vat_payer',
        registeredAddress: {
          street: 'ul. Pickerowa 1',
          city: 'Test',
          postalCode: '00-001',
          country: 'PL',
        },
      });
      await em.persistAndFlush(o);
    }
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('finds "Bauhaus Łódź" when queried as "lodz" (diacritic-insensitive)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/organizations?q=lodz',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ name: string }> };
    const names = body.data.map((o) => o.name);
    expect(names).toContain('Bauhaus Łódź');
  });

  it('finds the same row when queried with the original diacritics', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations?q=${encodeURIComponent('Łódź')}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ name: string }> };
    const names = body.data.map((o) => o.name);
    expect(names).toContain('Bauhaus Łódź');
  });

  it('finds rows whose name contains the queried fragment in case-insensitive mode', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/organizations?q=KRAKOW',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ name: string }> };
    const names = body.data.map((o) => o.name);
    expect(names).toContain('Castorama Kraków');
  });

  it('also matches a taxId fragment as a fallback', async () => {
    const em = h.em();
    const taxId = 'PL026US8X12345678';
    const o = em.create(Organization, {
      name: 'Tax-Match Org',
      taxId,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Vatowa 1',
        city: 'Test',
        postalCode: '00-001',
        country: 'PL',
      },
    });
    await em.persistAndFlush(o);

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/organizations?q=X12345',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const body = res.json() as { data: Array<{ taxId: string }> };
    expect(body.data.map((o) => o.taxId)).toContain(taxId);
  });
});
