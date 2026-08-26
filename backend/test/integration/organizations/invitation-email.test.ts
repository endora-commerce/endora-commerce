import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { InvitationService } from '../../../../packages/modules/organizations/src/backend/services/invitation-service.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { customerAccountPortsFor } from '../../helpers/customer-account-ports.js';

/**
 * T178 / FR-043 — InvitationService dispatches an invitation email through
 * the injected Mailer. We assert the address, subject, accept link and the
 * idempotent messageId so a retry would be deduplicated by ConsoleMailer
 * in production.
 */

describe('InvitationService dispatches invitation email', () => {
  let h: BackendServerHandle;
  let admin: CustomerAccount;
  let organization: Organization;

  beforeAll(async () => {
    h = await setupBackendServer();
    admin = await h.em().findOneOrFail(CustomerAccount, { role: 'organization_admin' });
    organization = await h.em().findOneOrFail(Organization, { id: admin.organizationId! });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await h
      .em()
      .getConnection()
      .execute(
        "delete from organization_invitations where email like '%@invitation-mail-test.example'",
      );
  });

  it('emails the invitee with an accept link built from the configured storefront base URL', async () => {
    const mailer = new InMemoryMailer();
    const service = new InvitationService(h.em, customerAccountPortsFor(h.em), mailer, {
      acceptBaseUrl: 'https://shop.test.example',
    });

    const result = await service.invite(
      { customerAccountId: admin.id, organizationId: organization.id },
      { email: 'recipient@invitation-mail-test.example', role: 'regular_user' },
    );

    expect(mailer.sent).toHaveLength(1);
    const sent = mailer.sent[0]!;
    expect(sent.to).toBe('recipient@invitation-mail-test.example');
    expect(sent.subject).toContain(organization.name);
    expect(sent.text).toContain(`https://shop.test.example/invitations/${result.rawToken}/accept`);
    expect(sent.text).toContain('as Member.');
    expect(sent.messageId).toBe(`invitation:${result.invitation.id}`);
    expect(sent.meta?.['kind']).toBe('organization_invitation');
    expect(sent.meta?.['role']).toBe('regular_user');
  });

  it('omits the email send when no Mailer is wired (back-compat path)', async () => {
    const service = new InvitationService(h.em, customerAccountPortsFor(h.em)); // no mailer

    const result = await service.invite(
      { customerAccountId: admin.id, organizationId: organization.id },
      { email: 'silent@invitation-mail-test.example' },
    );

    expect(result.invitation.id).toBeTruthy();
    expect(result.rawToken).toBeTruthy();
  });
});
