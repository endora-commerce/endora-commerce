import { createHash } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CustomerAccountMemberWritePort, CustomerAccountReadPort } from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { describe, expect, it } from 'vitest';

import { EmailVerificationToken } from '../entities/email-verification-token.entity.js';
import { Organization, type OrganizationStatus } from '../entities/organization.entity.js';
import { EmailVerificationService } from './email-verification-service.js';

/**
 * Issue #1893 — verifying the address activated the Organization unconditionally, so under
 * `manual` moderation a self-registered organization traded as soon as its first user clicked
 * the link, before an operator decided; with a 48-hour token it even revived a rejected or a
 * blocked one. Verification now stamps the account and consumes the token only: moderation is
 * the status's one writer (`status-write-paths.test.ts`).
 */

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_ID = '22222222-2222-2222-2222-222222222222';
const RAW_TOKEN = 'raw-token';

function harness(status: OrganizationStatus): {
  service: EmailVerificationService;
  organization: Organization;
  token: EmailVerificationToken;
  stamped: string[];
  emitted: string[];
  audited: unknown[];
} {
  const organization = { id: ORG_ID, status, version: 1 } as unknown as Organization;
  const token = {
    tokenHash: createHash('sha256').update(RAW_TOKEN, 'utf8').digest('hex'),
    customerAccountId: ACCOUNT_ID,
    consumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
  } as unknown as EmailVerificationToken;
  const audited: unknown[] = [];
  const em = {
    findOne: async (entity: unknown) => {
      if (entity === EmailVerificationToken) return token;
      if (entity === Organization) return organization;
      return null;
    },
    async flush(): Promise<void> {},
  };
  const stamped: string[] = [];
  const emitted: string[] = [];
  const service = new EmailVerificationService(
    () => em as unknown as EntityManager,
    { emit: (name: string) => emitted.push(name) } as never,
    {
      read: {
        async findById() {
          return { id: ACCOUNT_ID, organizationId: ORG_ID };
        },
      } as unknown as CustomerAccountReadPort,
      write: {
        async markEmailVerified(id: string) {
          stamped.push(id);
        },
      } as unknown as CustomerAccountMemberWritePort,
    },
    {
      recordWithin: (_em: unknown, entry: unknown) => {
        audited.push(entry);
      },
    } as unknown as AuditPort,
  );
  return { service, organization, token, stamped, emitted, audited };
}

describe('EmailVerificationService.verify — the Organization status (issue #1893)', () => {
  it('leaves a pending organization pending: the operator, not the link, approves it', async () => {
    const h = harness('pending_verification');

    const result = await h.service.verify(RAW_TOKEN);

    expect(result).toMatchObject({ organizationId: ORG_ID, customerAccountId: ACCOUNT_ID });
    expect(h.organization.status).toBe('pending_verification');
    expect(h.stamped).toEqual([ACCOUNT_ID]);
    expect(h.token.consumedAt).toBeInstanceOf(Date);
    expect(h.emitted).toEqual(['organization.verified.v1']);
    // The audit entry records the verification, not a status change it did not make.
    expect(h.audited).toEqual([
      expect.objectContaining({
        action: 'organization.email_verified',
        stateBefore: null,
        stateAfter: { customerAccountId: ACCOUNT_ID },
      }),
    ]);
  });

  it.each(['rejected', 'blocked', 'active'] as const)('does not move a %s organization', async (status) => {
    const h = harness(status);

    await h.service.verify(RAW_TOKEN);

    expect(h.organization.status).toBe(status);
  });
});
