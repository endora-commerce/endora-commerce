import { OptimisticLockError } from '@mikro-orm/core';
import { isUuidShape } from '@endora-commerce/contracts';
import type { Command, CommandActor } from '@endora-commerce/platform/commands';
import { Organization, type OrganizationStatus } from '../entities/organization.entity.js';
import { moderationAuditState } from '../services/organization-audit-state.js';
import {
  OrganizationNotFoundError,
  OrganizationStatusGuardError,
  OrganizationVersionMismatchError,
} from '../services/organization-moderation-errors.js';

/**
 * The one shape of an Organization moderation transition — `organization.approved`,
 * `.rejected`, `.blocked`, `.unblocked` (feature 026; `specs/186-aggregate-ports/`
 * T026, research R-2).
 *
 * These were written by `OrganizationModerationService.transition`, which
 * committed the status change, *then* recorded the audit entry by hand, then
 * emitted `organization.status_changed.v1` — so a failed audit write left a
 * transition nobody had recorded, and no command hook could take part. As a
 * Command the status write and its one audit entry commit together, the event is
 * the Command's own (dispatched once, on commit, dropped on rollback), and the
 * actor is the ambient one: an administrator, or `system` for the auto-approval
 * of a newly registered Organization. The customer notice is sent by this
 * module's subscriber of the event, after the commit, so it goes out when the
 * transition runs as a child Command too (research R-16.4); the event's
 * `notifyCustomer` says whether it is wanted.
 *
 * The audit action strings are unchanged, so record histories and saved audit
 * filters keep reading them. The state is names and structure only — whether a
 * reason was given, never the reason (`specs/conventions/audit-state.md`, D-288).
 */
export interface ModerationCommandInput {
  readonly organizationId: string;
  /**
   * The `version` the caller read. The admin routes always send it; absent, the
   * transition applies to whatever version it reads (the auto-approval reads
   * the row itself). A mismatch is {@link OrganizationVersionMismatchError}.
   */
  readonly expectedVersion?: number;
}

interface TransitionSpec {
  readonly action: 'organization.approved' | 'organization.rejected' | 'organization.blocked' | 'organization.unblocked';
  readonly requireStatus: OrganizationStatus;
  readonly newStatus: OrganizationStatus;
  /** The operator's reason the event carries (#1620); never the audit entry. */
  readonly reason?: string | null;
  /**
   * Whether the customer is told of this transition — the event's
   * `notifyCustomer`, read by this module's notice subscriber
   * (`specs/186-aggregate-ports/` research R-16.4).
   */
  readonly notifyCustomer: boolean;
  readonly mutate: (org: Organization, actor: CommandActor) => void;
}

export function makeModerationTransitionCommand(
  spec: TransitionSpec,
  input: ModerationCommandInput,
): Command<Organization> {
  const { organizationId, expectedVersion } = input;
  return {
    action: spec.action,
    objectType: 'organization',
    objectId: organizationId,
    run: async ({ em, actor }) => {
      if (!isUuidShape(organizationId)) throw new OrganizationNotFoundError(organizationId);
      const org = await em.findOne(Organization, { id: organizationId, deletedAt: null });
      if (!org) throw new OrganizationNotFoundError(organizationId);
      if (expectedVersion !== undefined && org.version !== expectedVersion) {
        throw new OrganizationVersionMismatchError(org.id, expectedVersion, org.version);
      }
      if (org.status !== spec.requireStatus) {
        throw new OrganizationStatusGuardError(org.id, org.status, spec.requireStatus);
      }
      const before = moderationAuditState(org);
      const readVersion = org.version;
      spec.mutate(org, actor);
      try {
        await em.flush();
      } catch (err) {
        // Another write moved the row between this read and the flush.
        if (err instanceof OptimisticLockError) {
          throw new OrganizationVersionMismatchError(organizationId, expectedVersion ?? readVersion, -1);
        }
        throw err;
      }
      return { result: org, before, after: moderationAuditState(org) };
    },
    event: (org) => ({
      eventName: 'organization.status_changed.v1',
      payload: {
        eventId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        organizationId: org.id,
        newStatus: spec.newStatus,
        // The guard refused every other status, so this is the one it left.
        previousStatus: spec.requireStatus,
        reason: spec.reason ?? null,
        notifyCustomer: spec.notifyCustomer,
      },
    }),
  };
}
