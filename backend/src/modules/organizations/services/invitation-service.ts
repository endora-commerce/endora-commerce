import { createHash, randomBytes, randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { hashPassword } from '../../auth/services/password-hasher.js';
import { Organization } from '../entities/organization.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import { OrganizationInvitation } from '../entities/organization-invitation.entity.js';

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

export class InvitationService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async invite(
    actor: { customerAccountId: string; organizationId: string },
    input: { email: string; role?: 'organization_admin' | 'regular_user' },
  ): Promise<InvitationResult> {
    const em = this.emFactory();
    const role = input.role ?? 'regular_user';
    const lowercaseEmail = input.email.toLowerCase();

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
      invitedByCustomerAccountId: actor.customerAccountId,
      email: lowercaseEmail,
      role,
      tokenHash: sha256Hex(rawToken),
      expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1_000),
    });
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

    return { invitation, rawToken };
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
    invitation.revokedAt = new Date();
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
    await em.persistAndFlush([customer, invitation]);

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
