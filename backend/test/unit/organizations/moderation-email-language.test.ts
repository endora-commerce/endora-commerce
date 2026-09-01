// `specs/093-backend-delivered-prose/` § Out of scope — the seam-B carve-out.
//
// `OrganizationModerationService.notifyCustomer` composed the approval and the
// rejection message as finished Polish sentences and handed them straight to
// `EmailMailerPort.send`: no code, no template, no language. A buyer on an
// English sales channel therefore received Polish, unconditionally, and unlike
// an operator a buyer has no admin panel to go and check the facts in.
//
// **This file asserts the language *selection*, not that a message was sent.**
// A test that only counted sends would have passed against the hard-coded
// Polish and asserted nothing. So the two transitions are driven three times
// each, over the real adapter (`makeTemplateEmail`) and the real content
// resolver, and what changes between the runs is one thing: the language the
// sales channel resolves to.
//
// The owner's ruling of 2026-09-01 fixes the two ends of the ladder: every
// module's messages are English by default, every module ships a Polish
// bundle, and a language that cannot be resolved falls back to English. The
// third case below is that ruling — `resolveLanguage` throwing must produce
// English, never the language the code happened to be written in.

import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CustomerAccountReadPort,
  EmailMailerPort,
  EmailMailerSendInput,
  TransactionalEmailSendInput,
  TransactionalSendOutcome,
} from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { makeTemplateEmail } from '../../../../packages/modules/transactional_emails/src/backend/services/template-email.js';
import { ContentResolver } from '../../../../packages/modules/transactional_emails/src/backend/services/content-resolver.js';
import {
  ORGANIZATION_APPROVED_DEFAULT,
  ORGANIZATION_REJECTED_DEFAULT,
} from '../../../../packages/modules/organizations/src/backend/email-templates/transactional-defaults.js';
import type { Organization } from '../../../../packages/modules/organizations/src/backend/entities/organization.entity.js';
import { OrganizationModerationService } from '../../../../packages/modules/organizations/src/backend/services/organization-moderation-service.js';

const CHANNEL = '00000000-0000-0000-0000-0000000000aa';
const BUYER = 'org-admin@buyer.example';
const ORG_NAME = 'Acme Sp. z o.o.';

/** The per-language default this module ships, keyed by the code it ships it under. */
const DEFAULTS: Record<string, { defaultSubject: Record<string, string>; defaultContent: Record<string, unknown>; languages: string[] }> = {
  organization_approved: ORGANIZATION_APPROVED_DEFAULT,
  organization_rejected: ORGANIZATION_REJECTED_DEFAULT,
};

interface RenderedSend {
  code: string;
  /** The language that reached the sender, i.e. what the seam resolved. */
  requestedLanguage: string;
  /** The language the content actually resolved in, after the fallback ladder. */
  resolvedLanguage: string;
  subject: string;
}

/**
 * A sender that renders through the **real** `ContentResolver` over this
 * module's own shipped defaults. Stubbing the subject here would have made the
 * test assert its own fixture; resolving it is what makes "which language did
 * the buyer get" a real question with a real answer.
 *
 * `findOne` answers `null` for every override row, so the resolver takes its
 * third tier — the module default — which is the tier a fresh install serves.
 */
function senderOverModuleDefaults(): {
  sent: RenderedSend[];
  send: (input: TransactionalEmailSendInput) => Promise<TransactionalSendOutcome>;
} {
  const resolver = new ContentResolver();
  const em = { async findOne(): Promise<null> { return null; } } as unknown as EntityManager;
  const sent: RenderedSend[] = [];
  return {
    sent,
    async send(input: TransactionalEmailSendInput): Promise<TransactionalSendOutcome> {
      const defaults = DEFAULTS[input.code];
      if (!defaults) return { status: 'no_definition' };
      const fallbackLanguage = defaults.languages[0];
      const resolved = await resolver.resolve(
        em,
        {
          defaultSubject: defaults.defaultSubject,
          defaultContent: defaults.defaultContent,
          languages: defaults.languages,
        } as never,
        {
          salesChannelId: input.salesChannelId,
          language: input.language,
          ...(fallbackLanguage ? { fallbackLanguage } : {}),
        },
      );
      sent.push({
        code: input.code,
        requestedLanguage: input.language,
        resolvedLanguage: resolved.language,
        subject: resolved.subject,
      });
      return { status: 'sent' };
    },
  };
}

function fakeOrganization(status: 'pending_verification'): Organization {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: ORG_NAME,
    version: 3,
    status,
    approvedAt: null,
    approvedByAdminUserId: null,
    blockedAt: null,
    blockedReason: null,
    rejectedAt: null,
    rejectedReason: null,
  } as unknown as Organization;
}

interface Harness {
  service: OrganizationModerationService;
  organization: Organization;
  /** What the transactional sender rendered, per send. */
  templated: RenderedSend[];
  /** What reached the raw transport — the `no_definition` fallback tier. */
  raw: EmailMailerSendInput[];
}

/**
 * `channelLanguage` is what the sales channel resolves to. `null` means the
 * resolution itself fails, which is the ruled "absent" case.
 */
function harness(options: { channelLanguage: string | null; senderWired?: boolean }): Harness {
  const organization = fakeOrganization('pending_verification');
  const em = {
    async transactional<T>(cb: (tem: unknown) => Promise<T>): Promise<T> {
      return cb(em);
    },
    async findOne(): Promise<Organization> {
      return organization;
    },
    async flush(): Promise<void> {},
  };

  const sender = senderOverModuleDefaults();
  const raw: EmailMailerSendInput[] = [];
  const mailer: EmailMailerPort = {
    async send(input) {
      raw.push(input);
      return { status: 'sent' };
    },
  };

  const templateEmail = makeTemplateEmail({
    getSender: () => (options.senderWired === false ? undefined : sender),
    resolveScopeSalesChannelId: async () => CHANNEL,
    resolveLanguage: async () => {
      if (options.channelLanguage === null) throw new Error('the channel could not be read');
      return options.channelLanguage;
    },
  });

  const service = new OrganizationModerationService(
    () => em as unknown as EntityManager,
    { async record(): Promise<void> {} } as unknown as AuditPort,
    { emit: (): void => {} } as never,
    mailer,
    {
      async listByOrganization() {
        return [{ role: 'organization_admin', email: BUYER }];
      },
    } as unknown as CustomerAccountReadPort,
    async () => 'manual',
    templateEmail,
  );

  return { service, organization, templated: sender.sent, raw };
}

describe('organizations — the moderation e-mails are sent in the recipient\'s language', () => {
  it('sends the approval in Polish when the sales channel resolves to pl-PL', async () => {
    const h = harness({ channelLanguage: 'pl-PL' });
    await h.service.approve(h.organization.id, { expectedVersion: 3 });

    expect(h.templated).toHaveLength(1);
    expect(h.templated[0]?.code).toBe('organization_approved');
    expect(h.templated[0]?.requestedLanguage).toBe('pl-PL');
    expect(h.templated[0]?.resolvedLanguage).toBe('pl-PL');
    expect(h.templated[0]?.subject).toBe('Twoja Organizacja została zweryfikowana');
    expect(h.raw, 'the raw transport must not be reached once the template handled it').toHaveLength(0);
  });

  it('sends the same approval in English when the sales channel resolves to en-US', async () => {
    const h = harness({ channelLanguage: 'en-US' });
    await h.service.approve(h.organization.id, { expectedVersion: 3 });

    expect(h.templated).toHaveLength(1);
    expect(h.templated[0]?.requestedLanguage).toBe('en-US');
    expect(h.templated[0]?.subject).toBe('Your organization has been verified');
  });

  it('falls back to English when the channel language cannot be resolved (owner ruling, 2026-09-01)', async () => {
    const h = harness({ channelLanguage: null });
    await h.service.approve(h.organization.id, { expectedVersion: 3 });

    expect(h.templated).toHaveLength(1);
    expect(h.templated[0]?.requestedLanguage).toBe('en-US');
    expect(h.templated[0]?.subject).toBe('Your organization has been verified');
  });

  it('sends the rejection in the channel language and carries the reason', async () => {
    const pl = harness({ channelLanguage: 'pl-PL' });
    await pl.service.reject(pl.organization.id, { expectedVersion: 3, reason: 'Brak numeru NIP.' });
    expect(pl.templated[0]?.code).toBe('organization_rejected');
    expect(pl.templated[0]?.subject).toBe('Rejestracja Organizacji odrzucona');

    const en = harness({ channelLanguage: 'en-US' });
    await en.service.reject(en.organization.id, { expectedVersion: 3, reason: 'No tax id.' });
    expect(en.templated[0]?.subject).toBe('Organization registration rejected');
  });

  it('passes the values the sentence interpolates rather than a composed sentence', async () => {
    const seen: TransactionalEmailSendInput[] = [];
    const organization = fakeOrganization('pending_verification');
    const em = {
      async transactional<T>(cb: (tem: unknown) => Promise<T>): Promise<T> {
        return cb(em);
      },
      async findOne(): Promise<Organization> {
        return organization;
      },
      async flush(): Promise<void> {},
    };
    const templateEmail = makeTemplateEmail({
      getSender: () => ({
        async send(input: TransactionalEmailSendInput): Promise<TransactionalSendOutcome> {
          seen.push(input);
          return { status: 'sent' };
        },
      }),
      resolveScopeSalesChannelId: async () => CHANNEL,
      resolveLanguage: async () => 'pl-PL',
    });
    const service = new OrganizationModerationService(
      () => em as unknown as EntityManager,
      { async record(): Promise<void> {} } as unknown as AuditPort,
      { emit: (): void => {} } as never,
      { async send() { return { status: 'sent' as const }; } },
      {
        async listByOrganization() {
          return [{ role: 'organization_admin', email: BUYER }];
        },
      } as unknown as CustomerAccountReadPort,
      async () => 'manual',
      templateEmail,
    );

    await service.reject(organization.id, { expectedVersion: 3, reason: 'Brak numeru NIP.' });

    expect(seen[0]?.variables).toMatchObject({
      organizationName: ORG_NAME,
      reason: 'Brak numeru NIP.',
    });
    expect(seen[0]?.to).toBe(BUYER);
  });

  it('shipped defaults carry both languages, with English as the fallback tier', () => {
    for (const [code, defaults] of Object.entries(DEFAULTS)) {
      expect(defaults.languages[0], `${code} must fall back to English`).toBe('en-US');
      expect(Object.keys(defaults.defaultSubject).sort()).toEqual(['en-US', 'pl-PL']);
      const languages = (defaults.defaultContent as { languages: Record<string, unknown> }).languages;
      expect(Object.keys(languages).sort()).toEqual(['en-US', 'pl-PL']);
    }
  });

  it('still reaches the buyer in English when the code has no template at all', async () => {
    // The `no_definition` tier. A verification e-mail that silently fails to
    // send is worse than one in the wrong language, so the in-code builder
    // stays — in English, which the ruling makes the default rather than the
    // language this module happened to be written in.
    const h = harness({ channelLanguage: 'pl-PL', senderWired: false });
    await h.service.approve(h.organization.id, { expectedVersion: 3 });

    expect(h.templated).toHaveLength(0);
    expect(h.raw).toHaveLength(1);
    expect(h.raw[0]?.to).toBe(BUYER);
    expect(h.raw[0]?.subject).toBe('Your organization has been verified');
    expect(h.raw[0]?.text).toContain(ORG_NAME);
  });
});
