import { describe, expect, it } from 'vitest';
import type { AuthSessionReadPort, CustomerAccountReadPort } from '@endora-commerce/contracts';
import { CustomerPresenceService } from '../../../src/modules/customers/services/customer-presence-service.js';

/**
 * Feature 075, Phase C — the online-customers panel reads `auth`'s published
 * session read instead of `auth`'s `Session` entity.
 *
 * The last site in `customers` that named that entity was here: an
 * `em.find(Session, { customerAccountId: { $in }, lastSeenAt: { $gte } })`
 * followed by a max-per-account fold this module performed itself. The port
 * answers the folded question, so the service no longer takes an
 * `EntityManager` at all — which is what these tests pin: the *only* session
 * data reaching the panel is what `lastSeenByCustomerAccount` returned, and the
 * window it was asked for is the configured freshness window.
 */
describe('CustomerPresenceService (feature 075)', () => {
  const account = (id: string): Awaited<ReturnType<CustomerAccountReadPort['findByIds']>>[number] =>
    ({
      id,
      email: `${id}@example.test`,
      firstName: 'Ada',
      lastName: 'Lovelace',
    }) as Awaited<ReturnType<CustomerAccountReadPort['findByIds']>>[number];

  const accountsPort = (ids: readonly string[]): CustomerAccountReadPort =>
    ({
      findByIds: async () => ids.map(account),
    }) as unknown as CustomerAccountReadPort;

  it('renders the last-seen stamp the session read port returned', async () => {
    const lastSeenAt = new Date('2026-08-01T10:00:00.000Z');
    const sessionReads: AuthSessionReadPort = {
      lastSeenByCustomerAccount: async () => [{ customerAccountId: 'c1', lastSeenAt }],
    };

    const service = new CustomerPresenceService(
      { listRecentlyActiveCustomers: async () => ['c1'] },
      sessionReads,
      async () => 10,
      accountsPort(['c1']),
    );

    const online = await service.listOnline();
    expect(online).toHaveLength(1);
    expect(online[0]?.id).toBe('c1');
    expect(online[0]?.lastSeenAt).toBe(lastSeenAt.toISOString());
  });

  it('asks the port for the configured freshness window and for exactly the active ids', async () => {
    const asked: { ids: readonly string[]; since: Date }[] = [];
    const sessionReads: AuthSessionReadPort = {
      lastSeenByCustomerAccount: async (ids, since) => {
        asked.push({ ids, since });
        return [];
      },
    };

    const before = Date.now();
    const service = new CustomerPresenceService(
      { listRecentlyActiveCustomers: async () => ['c1', 'c2'] },
      sessionReads,
      async () => 30,
      accountsPort(['c1', 'c2']),
    );
    await service.listOnline();
    const after = Date.now();

    expect(asked).toHaveLength(1);
    expect([...(asked[0]?.ids ?? [])]).toEqual(['c1', 'c2']);
    const since = asked[0]?.since.getTime() ?? 0;
    expect(since).toBeGreaterThanOrEqual(before - 30 * 60 * 1000);
    expect(since).toBeLessThanOrEqual(after - 30 * 60 * 1000);
  });

  it('does not reach the session read at all when no account was recently active', async () => {
    let calls = 0;
    const sessionReads: AuthSessionReadPort = {
      lastSeenByCustomerAccount: async () => {
        calls += 1;
        return [];
      },
    };

    const service = new CustomerPresenceService(
      { listRecentlyActiveCustomers: async () => [] },
      sessionReads,
      async () => 10,
      accountsPort([]),
    );

    expect(await service.listOnline()).toEqual([]);
    expect(calls).toBe(0);
  });
});
