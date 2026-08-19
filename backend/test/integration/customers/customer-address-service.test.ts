import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { CustomerAddressService } from '../../../src/modules/customers/services/customer-address-service.js';
import { CustomerAddress } from '../../../src/modules/customers/entities/customer-address.entity.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { AddressReadService } from '../../../src/modules/addresses/services/address-ports.js';

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
    // The real `addresses` read port, not a stub: the org-shared half of this
    // service is now a call through it (feature 075).
    service = new CustomerAddressService(() => em, new AddressReadService(() => em));
    const c = em.create(CustomerAccount, {
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
