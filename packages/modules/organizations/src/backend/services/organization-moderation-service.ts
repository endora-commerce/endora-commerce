import type { EntityManager } from '@mikro-orm/postgresql';
import { OptimisticLockError } from '@mikro-orm/core';
import { Organization, type OrganizationStatus } from '../entities/organization.entity.js';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { CustomerAccountReadPort, EmailMailerPort } from '@endora-commerce/contracts';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import type { OrganizationEventBus } from './registration-service.js';

/**
 * OrganizationModerationService — owns every status transition on the
 * Organization entity (feature 026 US1 + US3).
 *
 * Lifecycle (see `data-model.md` §3 state diagram):
 *   pending_verification -> active   via approve()
 *   pending_verification -> rejected via reject(reason)
 *   active               -> blocked  via block(reason?)
 *   blocked              -> active   via unblock()
 *
 * Every transition is recorded to `audit_log_entries` with `before/after`
 * snapshots and the actor; emits `organization.status_changed.v1` so the
 * notifier + downstream consumers (pricing cache, sales-rep dashboards)
 * can react. Each write is gated by the Organization's `version` column
 * — mismatch raises `OrganizationVersionMismatchError` which routes map
 * to HTTP 409 with `currentVersion` in the body.
 *
 * The service also exposes `handleNewlyRegistered(orgId)` — invoked by
 * the registration-event subscriber so the moderation-mode setting
 * (`organizations.moderation.mode`) flips the new org straight to
 * `active` when the platform runs in `auto` mode. The subscriber is
 * wired in the composition root.
 *
 * Customer email notifications (approval, rejection) are sent via the
 * injected `mailer`. The recipient is the Organization's first
 * `organization_admin` Customer account, read through
 * `customer_accounts`' published port (feature 075, D-87).
 */
export interface ModerationActorContext {
  actorAdminUserId?: string | null;
  requestId?: string | null;
}

export interface ApproveOptions extends ModerationActorContext {
  expectedVersion: number;
}

export interface RejectOptions extends ModerationActorContext {
  expectedVersion: number;
  reason: string;
  notifyCustomerEmail?: boolean;
}

export interface BlockOptions extends ModerationActorContext {
  expectedVersion: number;
  reason?: string | null;
}

export interface UnblockOptions extends ModerationActorContext {
  expectedVersion: number;
}

export class OrganizationModerationService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLogService: AuditPort,
    private readonly events: OrganizationEventBus,
    private readonly mailer: EmailMailerPort,
    /**
     * `customer_accounts`' published read, for the one question this service
     * asks it: who receives the approval or rejection message.
     */
    private readonly customerAccounts: CustomerAccountReadPort,
    /** Resolver for the moderation-mode setting. Returns 'auto' or 'manual'. */
    private readonly resolveModerationMode: () => Promise<'auto' | 'manual'>,
  ) {}

  /**
   * Invoked by the `organization.registered.v1` subscriber. When the
   * setting is `auto`, the freshly created org is approved immediately
   * (system actor = null adminUserId). When `manual`, this is a no-op
   * — the org stays in `pending_verification` until an admin acts.
   */
  async handleNewlyRegistered(organizationId: string): Promise<void> {
    let mode: 'auto' | 'manual' = 'manual';
    try {
      mode = await this.resolveModerationMode();
    } catch {
      // Settings not yet seeded or unreachable — degrade safely to manual.
    }
    if (mode !== 'auto') return;

    const em = this.emFactory();
    const org = await em.findOne(Organization, { id: organizationId, deletedAt: null });
    if (!org) return;
    if (org.status !== 'pending_verification') return;
    await this.approve(organizationId, {
      expectedVersion: org.version,
      actorAdminUserId: null,
    });
  }

  async approve(organizationId: string, options: ApproveOptions): Promise<Organization> {
    return this.transition({
      organizationId,
      expectedVersion: options.expectedVersion,
      requireStatus: 'pending_verification',
      mutate: (org) => {
        org.status = 'active';
        org.approvedAt = new Date();
        org.approvedByAdminUserId = options.actorAdminUserId ?? null;
      },
      action: 'organization.approved',
      actorAdminUserId: options.actorAdminUserId ?? null,
      requestId: options.requestId ?? null,
      eventNewStatus: 'active',
      afterCommit: async (org) => {
        await this.notifyCustomer(org, {
          subject: 'Twoja Organizacja została zweryfikowana',
          text: `Witaj,\n\nOrganizacja "${org.name}" została pomyślnie zweryfikowana i może teraz składać Zamówienia oraz Zapytania Ofertowe.\n\nDziękujemy.`,
          messageIdSuffix: 'approved',
        });
      },
    });
  }

  async reject(organizationId: string, options: RejectOptions): Promise<Organization> {
    if (!options.reason || options.reason.trim().length === 0) {
      throw new Error('OrganizationModerationService.reject: reason is required.');
    }
    return this.transition({
      organizationId,
      expectedVersion: options.expectedVersion,
      requireStatus: 'pending_verification',
      mutate: (org) => {
        org.status = 'rejected';
        org.rejectedAt = new Date();
        org.rejectedReason = options.reason;
      },
      action: 'organization.rejected',
      actorAdminUserId: options.actorAdminUserId ?? null,
      requestId: options.requestId ?? null,
      eventNewStatus: 'rejected',
      reason: options.reason,
      afterCommit: async (org) => {
        if (options.notifyCustomerEmail === false) return;
        await this.notifyCustomer(org, {
          subject: 'Rejestracja Organizacji odrzucona',
          text: `Witaj,\n\nNiestety, rejestracja Organizacji "${org.name}" została odrzucona z następującego powodu:\n\n${options.reason}\n\nW razie pytań prosimy o kontakt z administracją platformy.`,
          messageIdSuffix: 'rejected',
        });
      },
    });
  }

  async block(organizationId: string, options: BlockOptions): Promise<Organization> {
    return this.transition({
      organizationId,
      expectedVersion: options.expectedVersion,
      requireStatus: 'active',
      mutate: (org) => {
        org.status = 'blocked';
        org.blockedAt = new Date();
        org.blockedReason = options.reason ?? null;
      },
      action: 'organization.blocked',
      actorAdminUserId: options.actorAdminUserId ?? null,
      requestId: options.requestId ?? null,
      eventNewStatus: 'blocked',
      reason: options.reason ?? null,
    });
  }

  async unblock(organizationId: string, options: UnblockOptions): Promise<Organization> {
    return this.transition({
      organizationId,
      expectedVersion: options.expectedVersion,
      requireStatus: 'blocked',
      mutate: (org) => {
        org.status = 'active';
        org.blockedAt = null;
        org.blockedReason = null;
      },
      action: 'organization.unblocked',
      actorAdminUserId: options.actorAdminUserId ?? null,
      requestId: options.requestId ?? null,
      eventNewStatus: 'active',
    });
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async transition(input: TransitionInput): Promise<Organization> {
    const em = this.emFactory();
    const captured: {
      snapshotBefore: OrgSnapshot | null;
      snapshotAfter: OrgSnapshot | null;
      org: Organization | null;
    } = { snapshotBefore: null, snapshotAfter: null, org: null };

    try {
      await em.transactional(async (tem) => {
        const org = await tem.findOne(Organization, { id: input.organizationId, deletedAt: null });
        if (!org) {
          throw new OrganizationNotFoundError(input.organizationId);
        }
        if (org.version !== input.expectedVersion) {
          throw new OrganizationVersionMismatchError(org.id, input.expectedVersion, org.version);
        }
        if (org.status !== input.requireStatus) {
          throw new OrganizationStatusGuardError(org.id, org.status, input.requireStatus);
        }
        captured.snapshotBefore = snapshot(org);
        input.mutate(org);
        await tem.flush();
        captured.snapshotAfter = snapshot(org);
        captured.org = org;
      });
    } catch (err) {
      if (err instanceof OptimisticLockError) {
        throw new OrganizationVersionMismatchError(input.organizationId, input.expectedVersion, -1);
      }
      throw err;
    }

    const { snapshotBefore, snapshotAfter, org: approvedOrg } = captured;

    // Audit + event + email run AFTER the DB commit so a downstream failure
    // never poisons the status transition. We accept best-effort semantics
    // for those (mailer is idempotent via messageId).
    await this.auditLogService.record({
      actorAdminUserId: input.actorAdminUserId,
      action: input.action,
      objectType: 'organization',
      objectId: input.organizationId,
      stateBefore: snapshotBefore ? { ...snapshotBefore } : null,
      stateAfter: snapshotAfter ? { ...snapshotAfter } : null,
      requestId: input.requestId,
    });

    this.events.emit('organization.status_changed.v1', {
      eventId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      organizationId: input.organizationId,
      newStatus: input.eventNewStatus,
    });

    if (input.afterCommit && approvedOrg) {
      try {
        await input.afterCommit(approvedOrg);
      } catch {
        // Customer email is best-effort. The transition has already happened.
      }
    }

    return approvedOrg!;
  }

  private async notifyCustomer(
    org: Organization,
    input: { subject: string; text: string; messageIdSuffix: string },
  ): Promise<void> {
    /**
     * Feature 075 (D-87) — `customer_accounts`' port, where this was a
     * `getConnection().getKnex().raw('select "email" from "customer_accounts" …')`.
     * Raw SQL names no import specifier, so the reach compiled and returned
     * rows while every boundary check read clean.
     *
     * **The system scope is load-bearing and is not incidental to the port.**
     * `CustomerAccount` is `@OrgScoped`, so the read carries the acting
     * admin's tenant filter, and a moderator with an `allowed-set` context has
     * by definition not been assigned the organisation they are approving —
     * it is still `pending_verification`. Filtered, the lookup would find no
     * recipient and the approval mail would silently not go out. The raw
     * statement crossed organisations by bypassing the filter entirely and
     * telling nobody; `withSystemScope` crosses them the sanctioned way
     * (Constitution XI, FR-005), with a reason and one audit record.
     *
     * `listByOrganization` orders by role then creation date, so the first
     * `organization_admin` in the result is the row the `order by
     * "created_at" asc limit 1` picked.
     */
    const members = await withSystemScope(
      'organizations: notify the moderated organisation of its status change',
      () => this.customerAccounts.listByOrganization(org.id, { activeOnly: true }),
    );
    const recipient = members.find((m) => m.role === 'organization_admin')?.email;
    if (!recipient) return;
    const outcome = await this.mailer.send({
      messageId: `organization.${input.messageIdSuffix}.${org.id}.${org.version}`,
      to: recipient,
      subject: input.subject,
      text: input.text,
      meta: { organizationId: org.id, kind: input.messageIdSuffix },
    });
    if (outcome.status !== 'sent') {
      // The moderation transition has committed and this notification runs
      // after it, so the non-send is named rather than raised — D-59's record
      // is what survives to answer "was the customer told".
      console.warn('[organizations] the moderation e-mail was not sent', {
        organizationId: org.id,
        kind: input.messageIdSuffix,
        reason: outcome.reason,
      });
    }
  }
}

interface TransitionInput {
  organizationId: string;
  expectedVersion: number;
  requireStatus: OrganizationStatus;
  mutate: (org: Organization) => void;
  action: string;
  actorAdminUserId: string | null;
  requestId: string | null;
  eventNewStatus: string;
  reason?: string | null;
  afterCommit?: (org: Organization) => Promise<void>;
}

interface OrgSnapshot {
  id: string;
  status: OrganizationStatus;
  approvedAt: string | null;
  approvedByAdminUserId: string | null;
  blockedAt: string | null;
  blockedReason: string | null;
  rejectedAt: string | null;
  rejectedReason: string | null;
  version: number;
}

function snapshot(org: Organization): OrgSnapshot {
  return {
    id: org.id,
    status: org.status,
    approvedAt: org.approvedAt ? org.approvedAt.toISOString() : null,
    approvedByAdminUserId: org.approvedByAdminUserId ?? null,
    blockedAt: org.blockedAt ? org.blockedAt.toISOString() : null,
    blockedReason: org.blockedReason ?? null,
    rejectedAt: org.rejectedAt ? org.rejectedAt.toISOString() : null,
    rejectedReason: org.rejectedReason ?? null,
    version: org.version,
  };
}

export class OrganizationNotFoundError extends Error {
  constructor(public readonly organizationId: string) {
    super(`Organization ${organizationId} not found.`);
    this.name = 'OrganizationNotFoundError';
  }
}

export class OrganizationVersionMismatchError extends Error {
  constructor(
    public readonly organizationId: string,
    public readonly expectedVersion: number,
    public readonly currentVersion: number,
  ) {
    super(
      `Organization ${organizationId} version mismatch (expected ${expectedVersion}, currently ${currentVersion}).`,
    );
    this.name = 'OrganizationVersionMismatchError';
  }
}

export class OrganizationStatusGuardError extends Error {
  constructor(
    public readonly organizationId: string,
    public readonly currentStatus: OrganizationStatus,
    public readonly requiredStatus: OrganizationStatus,
  ) {
    super(
      `Organization ${organizationId} is in status '${currentStatus}', cannot perform an action that requires '${requiredStatus}'.`,
    );
    this.name = 'OrganizationStatusGuardError';
  }
}
