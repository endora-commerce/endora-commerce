import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SupportedLanguage } from '@endora-commerce/contracts';
import { Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { InvitationService } from '../../../../packages/modules/organizations/src/backend/services/invitation-service.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { customerAccountPortsFor } from '../../helpers/customer-account-ports.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';
import { dropOrganizationRoleCache, seedCustomRole } from '../../contract/organizations/organization-role-fixtures.js';

/**
 * T178 / FR-043 — InvitationService dispatches an invitation email through
 * the injected Mailer. We assert the address, subject, accept link and the
 * idempotent messageId so a retry would be deduplicated by ConsoleMailer
 * in production.
 *
 * `specs/170-organization-roles/` WP-03 (T055; #667, FR-008, US 5.1a): the
 * role the e-mail names is the role's own label — a predefined role's name in
 * the language the template e-mail is sent in (the system-default channel's,
 * as `templateEmailPort` resolves it), a custom role's name verbatim — never
 * a hard-coded English string. The in-code fallback builder is English, so it
 * shows the English label.
 */

interface TemplateSend {
  code: string;
  variables: Record<string, unknown>;
}

type InvitationServiceDeps = ConstructorParameters<typeof InvitationService>[0];

describe('InvitationService dispatches invitation email', () => {
  let h: BackendServerHandle;
  let organization: Organization;

  const translate = (key: string, language: SupportedLanguage, params?: Record<string, string | number>) =>
    (
      h.container.cradle as unknown as {
        adminI18nService: {
          translate(moduleId: string, key: string, language: string, params?: Record<string, string | number>): Promise<string>;
        };
      }
    ).adminI18nService.translate('organizations', key, language, params);

  function service(options: {
    mailer?: InMemoryMailer;
    templateSends?: TemplateSend[];
    language?: SupportedLanguage;
  }): InvitationService {
    const templateSends = options.templateSends;
    return new InvitationService({
      emFactory: h.em,
      accounts: customerAccountPortsFor(h.em),
      commandBus: (h.container.cradle as unknown as { commandBus: InvitationServiceDeps['commandBus'] }).commandBus,
      ...(options.mailer ? { mailer: options.mailer } : {}),
      acceptBaseUrl: 'https://shop.test.example',
      ...(templateSends
        ? {
            templateEmail: {
              async trySend(input: TemplateSend) {
                templateSends.push(input);
                return true;
              },
            },
          }
        : {}),
      translate,
      resolveEmailLanguage: async () => options.language ?? 'en',
    });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    organization = await h.em().findOneOrFail(Organization, { id: TEST_ORGANIZATION_ID });
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

  const actor = () => ({ customerAccountId: TEST_CUSTOMER_ID, organizationId: organization.id });

  it('emails the invitee with an accept link built from the configured storefront base URL', async () => {
    const mailer = new InMemoryMailer();
    const result = await service({ mailer }).invite(actor(), { email: 'recipient@invitation-mail-test.example' });

    expect(mailer.sent).toHaveLength(1);
    const sent = mailer.sent[0]!;
    expect(sent.to).toBe('recipient@invitation-mail-test.example');
    expect(sent.subject).toContain(organization.name);
    expect(sent.text).toContain(`https://shop.test.example/invitations/${result.rawToken}/accept`);
    expect(sent.text).toContain('as Member.');
    expect(sent.messageId).toBe(`invitation:${result.invitation.id}`);
    expect(sent.meta?.['kind']).toBe('organization_invitation');
    expect(sent.meta?.['organizationRoleId']).toBe(await predefinedRoleIdOf(h.em(), TEST_ORGANIZATION_ID, 'member'));
  });

  it('names a predefined role in the Polish label when the e-mail is Polish', async () => {
    const templateSends: TemplateSend[] = [];
    await service({ templateSends, language: 'pl' }).invite(actor(), { email: 'polish@invitation-mail-test.example' });
    expect(templateSends).toHaveLength(1);
    expect(templateSends[0]!.code).toBe('organization_invitation');
    expect(templateSends[0]!.variables['roleLabel']).toBe(await translate('organizationRoles.member.name', 'pl'));
    expect(templateSends[0]!.variables['roleLabel']).not.toBe('Member');
  });

  it('names a predefined role in English when the e-mail is English', async () => {
    const templateSends: TemplateSend[] = [];
    await service({ templateSends, language: 'en' }).invite(actor(), {
      email: 'english@invitation-mail-test.example',
      roleId: await predefinedRoleIdOf(h.em(), TEST_ORGANIZATION_ID, 'administrator'),
    });
    expect(templateSends[0]!.variables['roleLabel']).toBe('Administrator');
  });

  it('names a custom role by its own name, in either language and in the fallback builder', async () => {
    const roleId = await seedCustomRole(h.em(), {
      organizationId: TEST_ORGANIZATION_ID,
      name: 'Kupiec terenowy',
      permissions: [],
    });
    dropOrganizationRoleCache(h, TEST_ORGANIZATION_ID);

    const templateSends: TemplateSend[] = [];
    await service({ templateSends, language: 'pl' }).invite(actor(), { email: 'custom-pl@invitation-mail-test.example', roleId });
    expect(templateSends[0]!.variables['roleLabel']).toBe('Kupiec terenowy');

    const mailer = new InMemoryMailer();
    await service({ mailer }).invite(actor(), { email: 'custom-fallback@invitation-mail-test.example', roleId });
    expect(mailer.sent[0]!.text).toContain('as Kupiec terenowy.');
    expect(mailer.sent[0]!.text).not.toContain('Organization Admin');
  });

  it('omits the email send when no Mailer is wired (back-compat path)', async () => {
    const result = await service({}).invite(actor(), { email: 'silent@invitation-mail-test.example' });

    expect(result.invitation.id).toBeTruthy();
    expect(result.rawToken).toBeTruthy();
  });
});
