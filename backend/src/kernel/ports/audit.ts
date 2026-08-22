import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditLogEntry } from '../audit/audit-log-entry.entity.js';

/**
 * Kernel port — the append-only audit log (D-160.10).
 *
 * The **container name is `auditLogService`**, and it is a composition-root
 * registration rather than a module's: it is on `PLATFORM_OWNED_NAMES`
 * (`backend/scripts/check-port-dependencies.ts`), so a consumer declares no
 * manifest dependency for it and there is no owner to switch off. A module
 * reads it off its own cradle, as it always has; what changes here is only the
 * type it reads it as.
 *
 * **Why the class is not published, and why that is not a stylistic
 * preference.** `contracts/host-package.md` §1.3 row 4 measured 39 modules
 * naming `AuditLogService` in a constructor signature across 147 specifiers,
 * and recorded the tension as its Q3: Principle XIII routes a domain write
 * through `CommandBus.run` precisely so that the audit row and the write commit
 * together, which makes the bus — not the writer — the caller of the audit log.
 * Publishing the class as the platform's contract would freeze the shape the
 * principle routes *around* into something the host owes third-party module
 * packages a major version to change. D-160.10 answered it: publish the seam,
 * keep the implementation the host's.
 *
 * The port is therefore written here rather than derived from the class. A
 * `Pick<AuditLogService, …>`, a `ReturnType<>` or an `InstanceType<>` would each
 * import the class into every consumer's type graph, which is the coupling the
 * ruling removes; and each would silently re-widen the surface the day somebody
 * adds a method.
 *
 * **Not in `@b2b/contracts`.** Two of these four signatures name types that
 * package cannot have: `recordWithin` takes the caller's MikroORM
 * `EntityManager` — that *is* the co-transactional guarantee, not an
 * implementation detail — and every method answers in `AuditLogEntry`, a kernel
 * entity. `@b2b/contracts` depends on `zod` alone and is consumed by the admin
 * SPA and the storefront; giving it an ORM dependency to hold a backend-only
 * seam would be a new runtime dependency (Constitution IV) on the one package
 * three applications share. `kernel/ports/settings.ts` and
 * `kernel/ports/sales-channel.ts` are the standing precedent: a platform port
 * lives beside the platform, and §1.3 rows 3, 16, 27 and 53 already classify
 * `kernel/ports/*` as published.
 */
export interface AuditPort {
  /**
   * Append one entry on the port's **own** EntityManager, flushed immediately.
   *
   * What a caller reaches for when it has one row and no unit of work of its
   * own to join. A write that is part of a domain transaction wants
   * {@link AuditPort.recordWithin} — or, better, wants to be a Command
   * (Principle XIII), which writes the row through the bus and gets undo with
   * it.
   */
  record(input: RecordAuditInput): Promise<AuditLogEntry>;

  /**
   * Append one entry on the **caller's** transactional EntityManager, with no
   * fork and no flush (feature 054, FR-003).
   *
   * The caller's `em.transactional(...)` commits it atomically with the domain
   * write, so the audit row and the write live or die together. Passing an `em`
   * that has no transaction open is not an error and not a guarantee: the entry
   * is persisted into that unit of work and lands whenever it flushes.
   */
  recordWithin(em: EntityManager, input: RecordAuditInput): AuditLogEntry;

  /**
   * Entries matching a filter, newest first, capped (default 100, max 500).
   *
   * The admin audit viewer's read. An empty filter is every entry, which is why
   * the cap is not optional.
   */
  query(filter?: AuditLogFilter): Promise<AuditLogEntry[]>;

  /**
   * Every entry recorded under one action for a **set** of objects, oldest
   * first (issue #284).
   *
   * Deliberately uncapped, and that is the contract rather than an oversight: a
   * limit over a set does not bound the work evenly, it drops whichever objects
   * sort last, and an object whose history was silently truncated reads as an
   * object with no history. The caller bounds the population by passing the ids
   * on one page.
   */
  findByObjectIds(input: {
    action: string;
    objectType: string;
    objectIds: readonly string[];
  }): Promise<AuditLogEntry[]>;
}

/**
 * One entry, as the caller states it.
 *
 * The actor fields are the caller's to fill and are not derived here — a worker
 * or a system sweep legitimately has none. `recordAuditFromContext`
 * (`src/commands/`) is the helper that fills them from the ambient tenant
 * context for a request-shaped write.
 */
export interface RecordAuditInput {
  actorAdminUserId?: string | null;
  impersonatedCustomerAccountId?: string | null;
  action: string;
  objectType: string;
  objectId: string;
  stateBefore?: Record<string, unknown> | null;
  stateAfter?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/** The filter {@link AuditPort.query} takes. Every field is an equality match. */
export interface AuditLogFilter {
  actorAdminUserId?: string;
  impersonatedCustomerAccountId?: string;
  action?: string;
  objectType?: string;
  objectId?: string;
  limit?: number;
}
