import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { CustomerAddressService } from '../../../src/modules/customers/services/customer-address-service.js';
import { CustomerAddress } from '../../../src/modules/customers/entities/customer-address.entity.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { AddressReadService } from '../../../../packages/modules/addresses/src/backend/services/address-ports.js';
import { CustomerAccountReadService } from '../../../src/modules/customer_accounts/services/customer-account-ports.js';
import { seedAdHocOrganization } from '../../helpers/seed-organizations.js';

/**
 * Feature 040, US2 — personal address book: one-default-per-(customer, kind)
 * demotion, ownership enforcement, and graceful default removal.
 */
describe('CustomerAddressService', () => {
  let db: TestDb;
  let em: EntityManager;
  let service: CustomerAddressService;
  let customerId: string;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    em = await db.beginTx();
    // Both ports real, not stubs: the org-shared half of this service is a call
    // through `addresses`', and the account read is the tenant boundary — a
    // stub there would assert the guard away instead of exercising it. These
    // cases run in the harness's system scope, where it answers for every
    // account.
    service = new CustomerAddressService(
      () => em,
      new AddressReadService(() => em),
      new CustomerAccountReadService(() => em),
    );
    // D-178 — every account is scoped by an Organization, so the fixture writes
    // one. It is a company organisation rather than a personal one because
    // nothing here is about the B2C shape.
    const org = await seedAdHocOrganization(em, 'Address Book Org');
    const c = em.create(CustomerAccount, {
      organizationId: org.id,
      email: `addr-${Date.now()}-${Math.floor(performance.now())}@example.test`,
      passwordHash: 'x'.repeat(32),
      firstName: 'Addr',
      lastName: 'Book',
    });
    await em.persistAndFlush(c);
    customerId = c.id;
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  const base = {
    recipientName: 'Jan Kowalski',
    street: 'ul. Testowa 1',
    city: 'Warszawa',
    postalCode: '00-001',
    country: 'PL',
  };

  it('enforces exactly one default per (customer, kind)', async () => {
    const a = await service.create(customerId, { ...base, kind: 'delivery', isDefault: true });
    const b = await service.create(customerId, { ...base, kind: 'delivery', isDefault: true });

    const all = await service.listPersonal(customerId, 'delivery');
    const defaults = all.filter((x) => x.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.id).toBe(b.id);

    // The previous default was demoted.
    const reloadedA = await em.findOne(CustomerAddress, { id: a.id });
    expect(reloadedA!.isDefault).toBe(false);
  });

  it('keeps billing and delivery defaults independent', async () => {
    await service.create(customerId, { ...base, kind: 'delivery', isDefault: true });
    await service.create(customerId, { ...base, kind: 'billing', isDefault: true });
    const delivery = await service.listPersonal(customerId, 'delivery');
    const billing = await service.listPersonal(customerId, 'billing');
    expect(delivery.filter((x) => x.isDefault)).toHaveLength(1);
    expect(billing.filter((x) => x.isDefault)).toHaveLength(1);
  });

  it('deleting the default leaves no default of that kind', async () => {
    const a = await service.create(customerId, { ...base, kind: 'delivery', isDefault: true });
    await service.delete(customerId, a.id);
    const remaining = await service.listPersonal(customerId, 'delivery');
    expect(remaining).toHaveLength(0);
  });

  it('refuses to mutate an address the customer does not own', async () => {
    const other = em.create(CustomerAccount, {
      organizationId: (await seedAdHocOrganization(em, 'Other Org')).id,
      email: `other-${Date.now()}@example.test`,
      passwordHash: 'x'.repeat(32),
      firstName: 'Other',
      lastName: 'Person',
    });
    await em.persistAndFlush(other);
    const a = await service.create(other.id, { ...base, kind: 'delivery' });
    await expect(service.delete(customerId, a.id)).rejects.toMatchObject({
      code: 'CUSTOMER_ADDRESS_NOT_FOUND',
    });
  });

  it('setDefault promotes one and demotes the prior default', async () => {
    const a = await service.create(customerId, { ...base, kind: 'billing', isDefault: true });
    const b = await service.create(customerId, { ...base, kind: 'billing' });
    await service.setDefault(customerId, b.id);
    const all = await service.listPersonal(customerId, 'billing');
    expect(all.find((x) => x.id === a.id)!.isDefault).toBe(false);
    expect(all.find((x) => x.id === b.id)!.isDefault).toBe(true);
  });
});
