import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { RFQ_SHIPPED_ORDER_ID, seedShippedOrder } from '../../helpers/seed-commerce.js';
import { Organization } from '../../helpers/package-entities.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Issue #767 — `GET /api/v1/admin/orders/:id` enriches the order with its
 * Organization for the detail page's Organization panel. A personal (B2C)
 * Organization's tax id is an internal 32-hex placeholder, so the reply carries
 * `taxId: null` and `isPersonal: true` for it (the panel labels it an
 * individual customer, owner ruling of 2026-11-05); a company Organization's tax id is carried as before.
 */
const PLACEHOLDER_TAX_ID = '79963f233e3843bd84e144a8fcdd37f8';

describe('GET /api/v1/admin/orders/:id — Organization tax id (#767)', () => {
  let h: BackendServerHandle;
  let original: { name: string; legalName: string | null; taxId: string; isPersonal: boolean };

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedShippedOrder(h.em());
    const org = await h.em().findOneOrFail(Organization, { id: TEST_ORGANIZATION_ID });
    original = { name: org.name, legalName: org.legalName ?? null, taxId: org.taxId, isPersonal: org.isPersonal };
  });

  afterAll(async () => {
    await h.em().nativeUpdate(Organization, { id: TEST_ORGANIZATION_ID }, original);
    await teardownBackendServer(h);
  });

  async function organizationOf(kind: 'personal' | 'company') {
    await h.em().nativeUpdate(
      Organization,
      { id: TEST_ORGANIZATION_ID },
      kind === 'personal'
        ? { name: 'Jan Kowalski', legalName: null, taxId: PLACEHOLDER_TAX_ID, isPersonal: true }
        : { name: 'Acme', legalName: 'Acme Sp. z o.o.', taxId: '5260250274', isPersonal: false },
    );
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders/${RFQ_SHIPPED_ORDER_ID}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { organization: { name: string; taxId: string | null; isPersonal: boolean } | null } }).data.organization;
  }

  it("carries a company Organization's tax id", async () => {
    expect(await organizationOf('company')).toMatchObject({ name: 'Acme', taxId: '5260250274', isPersonal: false });
  });

  it("never carries a personal Organization's placeholder", async () => {
    expect(await organizationOf('personal')).toMatchObject({ name: 'Jan Kowalski', taxId: null, isPersonal: true });
  });
});
