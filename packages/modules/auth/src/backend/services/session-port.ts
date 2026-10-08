import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AuthAdminLastSeen,
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
 * The reporting half. It answers one question, of two populations: when was
 * each of these people last seen? `customers`' online-customers view asks it of
 * customer accounts; `crm` asks it of administrators, to decide whether the
 * recipient of an Event reminder is in the Admin UI to see a bell entry.
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

  /**
   * The same question for administrators
   * (`specs/143-crm-sales-opportunities/contracts/foreign-module-changes.md` §CAL-B2).
   *
   * Restricted to rows with no `customerAccountId`: a session in which an
   * administrator is browsing the storefront as a customer is the customer's
   * presence there, not the administrator's in the Admin UI. Such a session
   * carries the administrator in `impersonatorAdminUserId` and not here, so the
   * restriction is the rule stated twice — once by which column is asked, once
   * by the condition — and a row that ever carried both ids would still not
   * count.
   *
   * The answer is true since the plugin stamps the admin cookie's session
   * (§CAL-B3); before that the column held an administrator's sign-in time and
   * nothing after.
   */
  async lastSeenByAdminUser(
    adminUserIds: readonly string[],
    since: Date,
  ): Promise<AuthAdminLastSeen[]> {
    if (adminUserIds.length === 0) return [];
    const em = this.emFactory();
    const rows = await em.find(
      Session,
      { adminUserId: { $in: [...adminUserIds] }, customerAccountId: null, lastSeenAt: { $gte: since } },
      { fields: ['adminUserId', 'lastSeenAt'] },
    );
    const newest = new Map<string, Date>();
    for (const row of rows) {
      if (!row.adminUserId || !row.lastSeenAt) continue;
      const previous = newest.get(row.adminUserId);
      if (!previous || row.lastSeenAt > previous) newest.set(row.adminUserId, row.lastSeenAt);
    }
    return [...newest].map(([adminUserId, lastSeenAt]) => ({ adminUserId, lastSeenAt }));
  }
}
