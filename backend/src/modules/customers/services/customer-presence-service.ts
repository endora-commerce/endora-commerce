import type { EntityManager } from '@mikro-orm/postgresql';
import type { OnlineCustomer } from '@b2b/contracts';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import { Session } from '../../auth/entities/session.entity.js';

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
    private readonly emFactory: () => EntityManager,
    private readonly sessions: RecentActivityPort,
    private readonly resolveFreshnessMinutes: () => Promise<number>,
  ) {}

  async listOnline(): Promise<OnlineCustomer[]> {
    const windowMinutes = await this.resolveFreshnessMinutes();
    const ids = await this.sessions.listRecentlyActiveCustomers(windowMinutes);
    if (ids.length === 0) return [];

    const em = this.emFactory();
    const customers = await em.find(CustomerAccount, { id: { $in: ids }, deletedAt: null });
    // Latest activity per customer, for the displayed timestamp.
    const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);
    const sessions = await em.find(
      Session,
      { customerAccountId: { $in: ids }, lastSeenAt: { $gte: cutoff } },
      { fields: ['customerAccountId', 'lastSeenAt'] },
    );
    const lastSeen = new Map<string, Date>();
    for (const s of sessions) {
      if (!s.customerAccountId || !s.lastSeenAt) continue;
      const prev = lastSeen.get(s.customerAccountId);
      if (!prev || s.lastSeenAt > prev) lastSeen.set(s.customerAccountId, s.lastSeenAt);
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
