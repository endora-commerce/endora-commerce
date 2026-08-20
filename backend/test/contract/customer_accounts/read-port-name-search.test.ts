import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CustomerAccountReadService } from '../../../src/modules/customer_accounts/services/customer-account-ports.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';

/**
 * Feature 075, Phase P addendum — `CustomerAccountReadPort.searchIdsByName`.
 *
 * The admin orders list matches a search term against the placing customer's
 * e-mail **and** first and last name, and does it today with
 * `em.find(CustomerAccount, { $or: [...] })` from inside `orders`.
 * `searchByEmail` is the wrong shape for that cut: an operator typing a surname
 * into the orders search expects the surname to match, and it does. So the
 * question is published as the twin of
 * `OrganizationDetailsPort.searchIdsByName`, which the same list already uses
 * for the organisation half of the filter.
 *
 * Additive: no consumer resolves it yet. These are the three properties the
 * `orders` cut leans on.
 */
describe('CustomerAccountReadPort.searchIdsByName', () => {
  let h: BackendServerHandle;
  let port: CustomerAccountReadService;
  let sample: CustomerAccount;

  beforeAll(async () => {
    h = await setupBackendServer();
    port = new CustomerAccountReadService(h.em);
    sample = await h.em().findOneOrFail(CustomerAccount, { deletedAt: null });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('matches the last name, case-insensitively', async () => {
    const ids = await port.searchIdsByName(sample.lastName.toUpperCase());
    expect(ids).toContain(sample.id);
  });

  it('matches the first name and the e-mail as well', async () => {
    expect(await port.searchIdsByName(sample.firstName)).toContain(sample.id);
    expect(await port.searchIdsByName(sample.email)).toContain(sample.id);
  });

  it('returns nothing for an empty query rather than every account', async () => {
    expect(await port.searchIdsByName('   ')).toEqual([]);
  });

  it('returns nothing for a term nobody carries', async () => {
    expect(await port.searchIdsByName('zzz-no-such-person-zzz')).toEqual([]);
  });
});
