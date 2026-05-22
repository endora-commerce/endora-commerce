import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';

/**
 * Feature 026 US7 — VAT-ID validation endpoint contract.
 *
 *   POST /api/v1/admin/organizations/:id/vat-validations
 *   GET  /api/v1/admin/organizations/:id/vat-validations
 *
 * Drives the test harness's `FakeVatValidator` which returns three
 * deterministic outcomes based on the taxId suffix:
 *   - `…00000` → validated  (legalName auto-fill demo)
 *   - `…99999` → deferred   (simulated outage; org save not blocked)
 *   - other    → failed     (not_found)
 *
 * Every attempt persists one `organization_tax_id_validations` row
 * regardless of outcome; the GET endpoint surfaces history newest-first.
 */
describe('VAT validation (feature 026 US7)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function seedOrg(taxIdSuffix: string): Promise<string> {
    const em = h.em();
    const org = em.create(Organization, {
      name: `VAT Test Co ${taxIdSuffix}`,
      taxId: `PL${taxIdSuffix.padStart(10, '0')}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Vatowa 1',
        city: 'Warszawa',
        postalCode: '00-007',
        country: 'PL',
      },
    });
    await em.persistAndFlush(org);
    return org.id;
  }

  it('returns outcome=validated and persists a history row on a valid NIP', async () => {
    const orgId = await seedOrg('1234500000');

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/vat-validations`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { providerHint: 'auto', applyAutoFill: false },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      provider: string;
      outcome: string;
      legalNameReturned: string | null;
      createdAt: string;
    };
    expect(body.provider).toBe('mf_pl');
    expect(body.outcome).toBe('validated');
    expect(body.legalNameReturned).toBe('Test Legal Co');

    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${orgId}/vat-validations`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as { items: Array<{ outcome: string }> };
    expect(listBody.items.length).toBeGreaterThan(0);
    expect(listBody.items[0]!.outcome).toBe('validated');
  });

  it('applies auto-fill when applyAutoFill=true on a validated outcome', async () => {
    const orgId = await seedOrg('5555500000');

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/vat-validations`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { providerHint: 'auto', applyAutoFill: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      outcome: string;
      organization: { id: string; legalName: string | null; version: number } | null;
    };
    expect(body.outcome).toBe('validated');
    expect(body.organization).not.toBeNull();
    expect(body.organization?.legalName).toBe('Test Legal Co');
    expect(body.organization?.version).toBeGreaterThan(0);
  });

  it('persists a deferred record on provider outage; org save is not blocked', async () => {
    const orgId = await seedOrg('1234599999');

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/vat-validations`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { providerHint: 'auto', applyAutoFill: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      outcome: string;
      errorKind: string | null;
      organization: unknown;
    };
    expect(body.outcome).toBe('deferred');
    expect(body.errorKind).toBe('network_timeout');
    // applyAutoFill ignored on non-validated outcomes.
    expect(body.organization).toBeNull();
  });

  it('returns outcome=failed for an unknown NIP', async () => {
    const orgId = await seedOrg('1234567890');

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/vat-validations`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { outcome: string; errorKind: string | null };
    expect(body.outcome).toBe('failed');
    expect(body.errorKind).toBe('not_found');
  });

  it('GET returns history newest-first', async () => {
    const orgId = await seedOrg('1111100000');

    // Trigger twice.
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/vat-validations`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {},
    });
    // Brief pause so created_at timestamps differ.
    await new Promise((r) => setTimeout(r, 10));
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/vat-validations`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {},
    });

    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${orgId}/vat-validations`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const body = list.json() as { items: Array<{ createdAt: string }> };
    expect(body.items.length).toBe(2);
    expect(new Date(body.items[0]!.createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(body.items[1]!.createdAt).getTime(),
    );
  });
});
