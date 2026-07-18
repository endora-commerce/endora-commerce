import { createHash, randomBytes, randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { hashPassword } from '../../auth/services/password-hasher.js';
import { Organization } from '../entities/organization.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import { OrganizationInvitation } from '../entities/organization-invitation.entity.js';
import type { Mailer } from '../../email/services/mailer.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';
import { buildInvitationEmail } from '../email-templates/invitation.js';
import { noopOrgTemplateEmail, type OrgTemplateEmail } from './org-template-email.js';
import {
  emitCustomerAccountCreated,
  type OrganizationEventBus,
} from './registration-service.js';

/**
 * InvitationService (T173, FR-043).
 *
 * Rules:
 *   - Org Admin invites by email + role. Existing CustomerAccount with that
 *     email rejects with EMAIL_ALREADY_IN_ORGANIZATION (same org) or
 *     EMAIL_BELONGS_TO_ANOTHER_ORGANIZATION (different org).
 *   - One pending invitation per (org, email) — partial unique index in
 *     migration 005 enforces this.
 *   - acceptByToken: anonymous flow that needs password + first/last name.
 *     Creates the CustomerAccount with role from the invitation, marks the
 *     invitation consumed.
 *   - revoke: soft-clears the pending invitation.
 */

const INVITATION_TTL_DAYS = 14;

export interface InvitationResult {
  invitation: OrganizationInvitation;
  rawToken: string;
}

export interface InvitationServiceOptions {
  /** Storefront base used when building the redemption link. */
  acceptBaseUrl?: string;
}

export class InvitationService {
  private readonly mailer: Mailer | null;
  private readonly acceptBaseUrl: string;

  private readonly templateEmail: OrgTemplateEmail;

  constructor(
    private readonly emFactory: () => EntityManager,
    mailer?: Mailer | null,
    options?: InvitationServiceOptions,
    private readonly events?: OrganizationEventBus,
    templateEmail?: OrgTemplateEmail,
    private readonly auditLog?: AuditLogService,
  ) {
    this.mailer = mailer ?? null;
    this.acceptBaseUrl = options?.acceptBaseUrl ?? 'https://storefront.local';
    this.templateEmail = templateEmail ?? noopOrgTemplateEmail;
  }

  async invite(
    actor: { organizationId: string; customerAccountId?: string | null },
    input: { email: string; role?: 'organization_admin' | 'regular_user' },
  ): Promise<InvitationResult> {
    const em = this.emFactory();
    const role = input.role ?? 'regular_user';
    const lowercaseEmail = input.email.toLowerCase();

    // Feature 051 — a personal (B2C) organization is single-member by
    // definition; it cannot invite additional members.
    const actorOrg = await em.findOne(Organization, { id: actor.organizationId });
    if (actorOrg?.isPersonal) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'A personal (individual) account cannot invite members.',
      );
    }

    // Pre-check existing membership.
    const existingByEmail = await em.findOne(CustomerAccount, { email: lowercaseEmail });
    if (existingByEmail) {
      if (existingByEmail.organizationId === actor.organizationId) {
        throw new HttpError(
          409,
          ERROR_CODES.EMAIL_ALREADY_IN_ORGANIZATION,
          'This email already belongs to a member of your organization.',
        );
      }
      throw new HttpError(
        409,
        ERROR_CODES.EMAIL_BELONGS_TO_ANOTHER_ORGANIZATION,
        'This email belongs to a member of another organization.',
      );
    }

    const rawToken = randomBytes(32).toString('base64url');
    const invitation = em.create(OrganizationInvitation, {
      organizationId: actor.organizationId,
      invitedByCustomerAccountId: actor.customerAccountId ?? null,
      email: lowercaseEmail,
      role,
      tokenHash: sha256Hex(rawToken),
      expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1_000),
    });
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action: 'organization.invite',
        objectType: 'organization',
        objectId: actor.organizationId,
        stateBefore: null,
        stateAfter: { email: lowercaseEmail, role },
      });
    }
    try {
      await em.persistAndFlush(invitation);
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) {
        throw new HttpError(
          409,
          ERROR_CODES.EMAIL_ALREADY_IN_ORGANIZATION,
          'A pending invitation for this email already exists.',
        );
      }
      throw err;
    }

    if (this.mailer || this.templateEmail !== noopOrgTemplateEmail) {
      const organization = await em.findOne(Organization, { id: actor.organizationId });
      const inviter = actor.customerAccountId
        ? await em.findOne(CustomerAccount, { id: actor.customerAccountId })
        : null;
      const inviterName = inviter
        ? [inviter.firstName, inviter.lastName].filter(Boolean).join(' ').trim() || inviter.email
        : 'Platform support';
      const organizationName = organization?.name ?? 'your organization';
      const message = buildInvitationEmail({
        invitationId: invitation.id,
        rawToken,
        inviteeEmail: invitation.email,
        inviterName,
        organizationName,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        acceptBaseUrl: this.acceptBaseUrl,
      });
      const acceptUrl = (message.meta as { acceptUrl?: string } | undefined)?.acceptUrl ?? '';
      const sentViaTemplate = await this.templateEmail.trySend({
        code: 'organization_invitation',
        to: invitation.email,
        messageId: message.messageId,
        variables: {
          organizationName,
          inviterName,
          roleLabel: invitation.role === 'organization_admin' ? 'Organization Admin' : 'Member',
          acceptUrl,
          expiresOn: invitation.expiresAt.toISOString().slice(0, 10),
        },
        meta: message.meta,
      });
      if (!sentViaTemplate && this.mailer) await this.mailer.send(message);
    }

    return { invitation, rawToken };
  }

  /**
   * Lists every pending invitation on the actor's organization. "Pending"
   * means not yet consumed and not revoked; expired rows are intentionally
   * still surfaced so the admin can see what needs cleaning up.
   */
  async listPending(actor: { organizationId: string }): Promise<OrganizationInvitation[]> {
    const em = this.emFactory();
    return em.find(
      OrganizationInvitation,
      {
        organizationId: actor.organizationId,
        consumedAt: null,
        revokedAt: null,
      },
      { orderBy: { createdAt: 'desc' } },
    );
  }

  async revoke(
    actor: { organizationId: string },
    invitationId: string,
  ): Promise<void> {
    const em = this.emFactory();
    const invitation = await em.findOne(OrganizationInvitation, {
      id: invitationId,
      organizationId: actor.organizationId,
    });
    if (!invitation) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Invitation not found.');
    }
    if (invitation.consumedAt || invitation.revokedAt) return;

    if (invitation.role === 'organization_admin') {
      const adminCount = await em.count(CustomerAccount, {
        organizationId: actor.organizationId,
        role: 'organization_admin',
        deletedAt: null,
      });
      if (adminCount === 0) {
        const otherPending = await em.count(OrganizationInvitation, {
          organizationId: actor.organizationId,
          role: 'organization_admin',
          consumedAt: null,
          revokedAt: null,
          id: { $ne: invitation.id },
        });
        if (otherPending === 0) {
          throw new HttpError(
            409,
            ERROR_CODES.CANNOT_REVOKE_LAST_ADMIN_INVITE,
            'Cannot revoke the only pending administrator invitation while the organization has no active administrator.',
          );
        }
      }
    }

    invitation.revokedAt = new Date();
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action: 'organization.invite_revoke',
        objectType: 'organization',
        objectId: invitation.organizationId,
        stateBefore: { email: invitation.email, role: invitation.role },
        stateAfter: null,
      });
    }
    await em.flush();
  }

  async acceptByToken(
    rawToken: string,
    input: { password: string; firstName: string; lastName: string },
  ): Promise<{ customerAccount: CustomerAccount }> {
    const em = this.emFactory();
    const tokenHash = sha256Hex(rawToken);
    const invitation = await em.findOne(OrganizationInvitation, { tokenHash });
    if (!invitation || invitation.consumedAt || invitation.revokedAt) {
      throw new HttpError(
        400,
        ERROR_CODES.TOKEN_INVALID_OR_EXPIRED,
        'Invitation is invalid or has already been consumed.',
      );
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw new HttpError(
        400,
        ERROR_CODES.TOKEN_INVALID_OR_EXPIRED,
        'Invitation has expired.',
      );
    }

    // FR-041: at most one CustomerAccount per email installation-wide.
    const existing = await em.findOne(CustomerAccount, { email: invitation.email });
    if (existing) {
      throw new HttpError(
        409,
        ERROR_CODES.EMAIL_ALREADY_REGISTERED,
        'An account with this email already exists.',
      );
    }
    const organization = await em.findOne(Organization, { id: invitation.organizationId });
    if (!organization) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization no longer exists.');
    }

    const passwordHash = await hashPassword(input.password);
    const customer = em.create(CustomerAccount, {
      organizationId: invitation.organizationId,
      email: invitation.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      role: invitation.role,
      emailVerifiedAt: new Date(), // accepting an invitation implies confirmed email
    });
    invitation.consumedAt = new Date();
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action: 'organization.invite_accept',
        objectType: 'organization',
        objectId: invitation.organizationId,
        stateBefore: null,
        stateAfter: { email: invitation.email, role: invitation.role, customerAccountId: customer.id },
      });
    }
    await em.persistAndFlush([customer, invitation]);

    if (this.events) {
      emitCustomerAccountCreated(this.events, customer.id, invitation.organizationId);
    }

    return { customerAccount: customer };
  }

  /**
   * Latest unconsumed token id — exposed only by the test probe so
   * integration tests can complete the accept step without the email.
   */
  async latestUnconsumedTokenInvitationId(): Promise<string | null> {
    const em = this.emFactory();
    const row = await em.findOne(
      OrganizationInvitation,
      { consumedAt: null, revokedAt: null },
      { orderBy: { createdAt: 'desc' } },
    );
    return row?.id ?? null;
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// silence unused — randomUUID may be needed by callers later
void randomUUID;
