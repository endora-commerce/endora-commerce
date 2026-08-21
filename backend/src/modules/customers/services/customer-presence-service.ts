import type {
  AuthSessionReadPort,
  CustomerAccountReadPort,
  OnlineCustomer,
} from '@b2b/contracts';

/**
 * CustomerPresenceService — the admin "online customers" view (feature 040,
 * US7 / FR-034). A customer is online if a session of theirs was active within
 * the configurable freshness window.
 */
export interface RecentActivityPort {
  listRecentlyActiveCustomers(windowMinutes: number): Promise<string[]>;
}

export class CustomerPresenceService {
  constructor(
    private readonly sessions: RecentActivityPort,
    /**
     * Feature 075 — `auth`'s published read, where this service ran
     * `em.find(Session, …)` over that module's table to work out when each
     * account was last seen. The port answers the same question and carries no
     * `Session` entity, so the "who is online" panel no longer needs an
     * `EntityManager` at all.
     */
    private readonly sessionReads: AuthSessionReadPort,
    private readonly resolveFreshnessMinutes: () => Promise<number>,
    /**
     * Feature 075 — `customer_accounts`' published read, where this service ran
     * `em.find(CustomerAccount, …)` over that module's table. The four fields
     * it renders are all on the record.
     */
    private readonly accounts: CustomerAccountReadPort,
  ) {}

  async listOnline(): Promise<OnlineCustomer[]> {
    const windowMinutes = await this.resolveFreshnessMinutes();
    const ids = await this.sessions.listRecentlyActiveCustomers(windowMinutes);
    if (ids.length === 0) return [];

    const customers = await this.accounts.findByIds(ids, { activeOnly: true });
    // Latest activity per customer, for the displayed timestamp.
    const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);
    const lastSeen = new Map<string, Date>();
    for (const row of await this.sessionReads.lastSeenByCustomerAccount(ids, cutoff)) {
      lastSeen.set(row.customerAccountId, row.lastSeenAt);
    }

    return customers.map((c) => ({
      id: c.id,
      email: c.email,
      firstName: c.firstName,
      lastName: c.lastName,
      lastSeenAt: (lastSeen.get(c.id) ?? new Date()).toISOString(),
    }));
  }
}
