import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AuthCustomerLastSeen,
  AuthSessionKind,
  AuthSessionPort,
  AuthSessionReadPort,
  AuthSessionRecord,
} from '@endora-commerce/contracts';
import { Session } from '../entities/session.entity.js';
import type { SessionService } from './session-service.js';

/**
 * The published face of `auth`'s session machinery (feature 075, Phase P).
 *
 * `SessionService` is not itself the port, and the difference is one field:
 * its `createSession` / `loadSession` hand back the `Session` **entity**, and
 * an entity crossing a module boundary is the problem this feature exists to
 * remove — publishing a port that hands one over would only rename it
 * (contracts/port-publication.md §1.2). So the adapter below maps the row into
 * `AuthSessionRecord`, which drops `tokenHash`: no consumer reads it, and it
 * is the one field that must not travel.
 *
 * The adapter is additive. `sessionService` keeps its registration for the
 * consumers Phase C has not reached yet.
 */

export function toAuthSessionRecord(session: Session, kind: AuthSessionKind): AuthSessionRecord {
  return {
    id: session.id,
    kind,
    customerAccountId: session.customerAccountId ?? null,
    adminUserId: session.adminUserId ?? null,
    impersonatorAdminUserId: session.impersonatorAdminUserId ?? null,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastSeenAt: session.lastSeenAt ?? null,
    ipAddress: session.ipAddress ?? null,
    userAgent: session.userAgent ?? null,
  };
}

/** Same derivation `SessionService` applies internally, over the record's fields. */
function kindOf(session: Session): AuthSessionKind {
  if (session.impersonatorAdminUserId) return 'impersonation';
  if (session.adminUserId) return 'admin';
  return 'customer';
}

export function createAuthSessionPort(sessionService: SessionService): AuthSessionPort {
  return {
    async createSession(input) {
      const created = await sessionService.createSession(input);
      return {
        cookieValue: created.cookieValue,
        expiresAt: created.expiresAt,
        session: toAuthSessionRecord(created.session, kindOf(created.session)),
      };
    },
    async loadSession(cookieValue) {
      const resolved = await sessionService.loadSession(cookieValue);
      if (!resolved) return null;
      return {
        kind: resolved.kind,
        session: toAuthSessionRecord(resolved.session, resolved.kind),
      };
    },
    destroySession: (sessionId) => sessionService.destroySession(sessionId),
    destroyAllForCustomer: (customerAccountId) =>
      sessionService.destroyAllForCustomer(customerAccountId),
    destroyAllForAdmin: (adminUserId) => sessionService.destroyAllForAdmin(adminUserId),
    touchLastSeen: (sessionId) => sessionService.touchLastSeen(sessionId),
    listRecentlyActiveCustomers: (windowMinutes) =>
      sessionService.listRecentlyActiveCustomers(windowMinutes),
  };
}

/**
 * The reporting half. `customers`' online-customers view is the only consumer,
 * and it asks exactly one question: when was each of these accounts last seen?
 */
export class AuthSessionReadService implements AuthSessionReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async lastSeenByCustomerAccount(
    customerAccountIds: readonly string[],
    since: Date,
  ): Promise<AuthCustomerLastSeen[]> {
    if (customerAccountIds.length === 0) return [];
    const em = this.emFactory();
    const rows = await em.find(
      Session,
      { customerAccountId: { $in: [...customerAccountIds] }, lastSeenAt: { $gte: since } },
      { fields: ['customerAccountId', 'lastSeenAt'] },
    );
    const newest = new Map<string, Date>();
    for (const row of rows) {
      if (!row.customerAccountId || !row.lastSeenAt) continue;
      const previous = newest.get(row.customerAccountId);
      if (!previous || row.lastSeenAt > previous) newest.set(row.customerAccountId, row.lastSeenAt);
    }
    return [...newest].map(([customerAccountId, lastSeenAt]) => ({
      customerAccountId,
      lastSeenAt,
    }));
  }
}
