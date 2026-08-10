import { createHash, randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Organization } from '../entities/organization.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import { EmailVerificationToken } from '../entities/email-verification-token.entity.js';
import type { OrganizationEventBus } from './registration-service.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';

/**
 * Email verification flow (T118).
 *
 * Consumes a raw token, looks up the matching EmailVerificationToken row by
 * sha256 hash, marks it consumed (one-shot), sets CustomerAccount.emailVerifiedAt,
 * and transitions the Organization to `active`. Emits organization.verified.v1.
 */
export class EmailVerificationService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly events: OrganizationEventBus,
    private readonly auditLog?: AuditLogService,
  ) {}

  async verify(rawToken: string): Promise<{
    organizationId: string;
    customerAccountId: string;
    verifiedAt: Date;
  }> {
    const em = this.emFactory();
    const tokenHash = sha256Hex(rawToken);
    const token = await em.findOne(EmailVerificationToken, { tokenHash });
    if (!token) {
      throw new HttpError(
        400,
        ERROR_CODES.TOKEN_INVALID_OR_EXPIRED,
        'Verification token is invalid or expired.',
      );
    }
    if (token.consumedAt) {
      throw new HttpError(
        400,
        ERROR_CODES.TOKEN_INVALID_OR_EXPIRED,
        'Verification token has already been consumed.',
      );
    }
    if (token.expiresAt.getTime() <= Date.now()) {
      throw new HttpError(
        400,
        ERROR_CODES.TOKEN_INVALID_OR_EXPIRED,
        'Verification token has expired.',
      );
    }

    const customer = await em.findOne(CustomerAccount, { id: token.customerAccountId });
    if (!customer) {
      throw new HttpError(
        400,
        ERROR_CODES.TOKEN_INVALID_OR_EXPIRED,
        'Associated account was removed.',
      );
    }
    // Feature 026 US2 — Customer may have no Organization (post-026 schema).
    // Verification through this flow always carries an org today
    // (RegistrationService.registerOrganization always creates the pair),
    // but guard defensively in case a no-org Customer ever lands here.
    if (!customer.organizationId) {
      throw new HttpError(
        400,
        ERROR_CODES.TOKEN_INVALID_OR_EXPIRED,
        'Verification flow requires an Organization.',
      );
    }
    const organization = await em.findOne(Organization, { id: customer.organizationId });
    if (!organization) {
      throw new HttpError(
        400,
        ERROR_CODES.TOKEN_INVALID_OR_EXPIRED,
        'Associated organization was removed.',
      );
    }

    const now = new Date();
    customer.emailVerifiedAt = now;
    organization.status = 'active';
    token.consumedAt = now;
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action: 'organization.email_verified',
        objectType: 'organization',
        objectId: organization.id,
        stateBefore: { status: 'pending' },
        stateAfter: { status: 'active', customerAccountId: customer.id },
      });
    }
    await em.flush();

    this.events.emit('organization.verified.v1', {
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      organizationId: organization.id,
      customerAccountId: customer.id,
    });

    return {
      organizationId: organization.id,
      customerAccountId: customer.id,
      verifiedAt: now,
    };
  }

  /**
   * Test-only helper used by the `/api/v1/_test/latest-verification-token`
   * probe — exposes the most recent UNCONSUMED, unexpired token so integration
   * tests can complete the verification step without touching Mailhog.
   *
   * Returns null if no such token exists. Callers gate this behind an env
   * check so the probe is never exposed outside of tests.
   */
  async latestUnconsumedTokenId(): Promise<string | null> {
    const em = this.emFactory();
    const row = await em.findOne(
      EmailVerificationToken,
      { consumedAt: null },
      { orderBy: { createdAt: 'desc' } },
    );
    return row?.id ?? null;
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
