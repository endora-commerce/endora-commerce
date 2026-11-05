import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { Order, Organization } from '../../helpers/package-entities.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Issue #759 — the billing snapshot an order is placed with.
 *
 * A company Organization's name and tax id are the defaults the buyer may
 * override for one order. A personal (B2C) Organization is not a company: its
 * tax id is an internal 32-hex placeholder and its name is the person's, so
 * neither may be written onto the order as company data. The order is billed
 * to the person unless the buyer typed company data explicitly (owner ruling
 * of 2026-11-05: the "I need a company invoice" checkbox at checkout).
 */
const PLACEHOLDER_TAX_ID = '79963f233e3843bd84e144a8fcdd37f8';

describe('placeOrder — billing company data for personal and company Organizations (#759)', () => {
  let h: BackendServerHandle;
  let original: { name: string; legalName: string | null; taxId: string; isPersonal: boolean };

  beforeAll(async () => {
    h = await setupBackendServer();
    const org = await h.em().findOneOrFail(Organization, { id: TEST_ORGANIZATION_ID });
    original = {
      name: org.name,
      legalName: org.legalName ?? null,
      taxId: org.taxId,
      isPersonal: org.isPersonal,
    };
  });

  afterAll(async () => {
    await h.em().nativeUpdate(Organization, { id: TEST_ORGANIZATION_ID }, original);
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await seedCartForStubCustomer(h.em());
  });

  async function becomes(kind: 'personal' | 'company'): Promise<void> {
    await h.em().nativeUpdate(
      Organization,
      { id: TEST_ORGANIZATION_ID },
      kind === 'personal'
        ? { name: 'Jan Kowalski', legalName: null, taxId: PLACEHOLDER_TAX_ID, isPersonal: true }
        : { name: 'Acme', legalName: 'Acme Sp. z o.o.', taxId: '5260250274', isPersonal: false },
    );
  }

  async function place(extra: Record<string, string> = {}) {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        ...extra,
      },
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json() as { data: { id: string } }).data.id;
    const order = await h.em().fork().findOneOrFail(Order, { id });
    return order.billingAddress;
  }

  it('bills a personal Organization to the person: no placeholder tax id, no company name', async () => {
    await becomes('personal');
    const billing = await place();
    expect(billing.taxId ?? null).toBeNull();
    expect(billing.companyName ?? null).toBeNull();
    expect(billing.recipientName).toBeTruthy();
  });

  it('keeps the company data a personal Organization typed explicitly', async () => {
    await becomes('personal');
    const billing = await place({ billingCompanyName: 'Kowalski Usługi', billingTaxId: '7740001454' });
    expect(billing.companyName).toBe('Kowalski Usługi');
    expect(billing.taxId).toBe('7740001454');
  });

  it("defaults a company Organization's billing data to its legal name and tax id", async () => {
    await becomes('company');
    const billing = await place();
    expect(billing.companyName).toBe('Acme Sp. z o.o.');
    expect(billing.taxId).toBe('5260250274');
  });

  it("lets a company Organization's buyer override the defaults for one order", async () => {
    await becomes('company');
    const billing = await place({ billingCompanyName: 'Acme Oddział', billingTaxId: '1132853869' });
    expect(billing.companyName).toBe('Acme Oddział');
    expect(billing.taxId).toBe('1132853869');
  });
});
