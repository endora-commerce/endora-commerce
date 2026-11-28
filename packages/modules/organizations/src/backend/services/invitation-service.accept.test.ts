/**
 * `specs/193-admin-form-extensions/` T088, WP-E1 half (D-300.3, D-300.10): the
 * invitation acceptance is a buyer's own storefront write, run anonymously, so
 * it asks the account owner to create the invitee as buyer self-service — the
 * `customer_account.create` Command it runs then skips a deployment's
 * tightened field rule. The owner honouring the flag is WP-E3's half.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CustomerAccountCreateInput, CustomerAccountRecord } from '@endora-commerce/contracts';
import { Organization } from '../entities/organization.entity.js';
import { OrganizationInvitation } from '../entities/organization-invitation.entity.js';
import { InvitationService } from './invitation-service.js';

const ORG_ID = '00000000-0000-4000-8000-000000193d01';
const ROLE_ID = '00000000-0000-4000-8000-000000193d02';
const ACCOUNT_ID = '00000000-0000-4000-8000-000000193d03';
const TOKEN = 'invitation-token-193';

function service(created: CustomerAccountCreateInput[]): InvitationService {
  const invitation = {
    organizationId: ORG_ID,
    email: 'invitee@example.test',
    organizationRoleId: ROLE_ID,
    tokenHash: createHash('sha256').update(TOKEN, 'utf8').digest('hex'),
    consumedAt: null,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
  };
  const em = {
    findOne: async (entity: unknown) =>
      entity === OrganizationInvitation ? invitation : entity === Organization ? { id: ORG_ID } : null,
    flush: async () => undefined,
  } as unknown as EntityManager;
  return new InvitationService({
    emFactory: () => em,
    commandBus: { run: async () => undefined as never },
    accounts: {
      read: { findByEmail: async () => null } as never,
      write: {
        create: async (input: CustomerAccountCreateInput) => {
          created.push(input);
          return { id: ACCOUNT_ID, organizationId: ORG_ID } as CustomerAccountRecord;
        },
      } as never,
    },
  });
}

describe('InvitationService.acceptByToken — buyer self-service (193 T088)', () => {
  it('creates the invitee as a buyer self-service write', async () => {
    const created: CustomerAccountCreateInput[] = [];
    await service(created).acceptByToken(TOKEN, { password: 'a-very-strong-password', firstName: 'Ada', lastName: 'Lovelace' });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ organizationId: ORG_ID, organizationRoleId: ROLE_ID, emailVerified: true, buyerSelfService: true });
  });
});
