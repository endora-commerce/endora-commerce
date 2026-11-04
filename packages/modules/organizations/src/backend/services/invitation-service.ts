import { createHash, randomBytes } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  normalizeEmailAddress,
  type CustomerAccountMemberWritePort,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
  type EmailMailerPort,
  type SupportedLanguage,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { Organization } from '../entities/organization.entity.js';
import { OrganizationInvitation } from '../entities/organization-invitation.entity.js';
import type { OrganizationRole } from '../entities/organization-role.entity.js';
import { recordAuditFromContext, type Command } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { currentSalesChannel } from '@endora-commerce/platform/kernel';
import { storefrontPagePathFor } from '@endora-commerce/contracts';
import { buildInvitationEmail } from '../email-templates/invitation.js';
import { makeCreateOrganizationInvitationCommand } from '../commands/organization-invitation-create.command.js';
import { makeRevokeOrganizationInvitationCommand } from '../commands/organization-invitation-revoke.command.js';
import { noopOrgTemplateEmail, type OrgTemplateEmail } from './org-template-email.js';
import type { OrganizationsTranslate } from './organizations-prose.js';
import {
  emitCustomerAccountCreated,
  type OrganizationEventBus,
} from './registration-service.js';

/**
 * InvitationService (T173, FR-043).
 *
 * Rules:
 *   - An Organization's administrator invites by email and, optionally, a role
 *     **id** of that Organization — its *Member* role when none is named
 *     (`specs/170-organization-roles/` WP-03, FR-005). Existing
 *     CustomerAccount with that email rejects with
 *     EMAIL_ALREADY_IN_ORGANIZATION (same org) or
 *     EMAIL_BELONGS_TO_ANOTHER_ORGANIZATION (different org).
 *   - A personal Organization cannot invite (feature 051) — refused first,
 *     before the role is resolved (owner ruling PR-3, R-34).
 *   - One pending invitation per (org, email) — partial unique index in
 *     migration 005 enforces this.
 *   - Creating and revoking run as the `organization_invitation.create` /
 *     `.revoke` Commands (Principle XIII; FR-065).
 *   - acceptByToken: anonymous flow that needs password + first/last name.
 *     Creates the CustomerAccount with the role the invitation names, marks
 *     the invitation consumed.
 *   - Pending means neither accepted, revoked nor expired (FR-010a, PR-7).
 */

const INVITATION_TTL_DAYS = 14;

/** The predefined roles' English names — the in-code fallback e-mail is English. */
const PREDEFINED_ROLE_ENGLISH_NAMES: Readonly<Record<'administrator' | 'member', string>> = {
  administrator: 'Administrator',
  member: 'Member',
};

export interface InvitationResult {
  invitation: OrganizationInvitation;
  rawToken: string;
}

/**
 * `customer_accounts`' published read and write (feature 075, Phase C).
 *
 * An invitation is this module's row; the member it creates is that module's.
 * The membership pre-checks used to be `em.findOne`/`em.count` on its entity
 * and the accept used to `em.create` one, with a `hashPassword` imported from
 * `auth`.
 *
 * With `customer_accounts` off every invitation path fails closed — inviting a
 * member the platform cannot see, or accepting into an account it cannot
 * create, are both incoherent rather than degraded.
 */
export interface InvitationAccountPorts {
  read: CustomerAccountReadPort;
  write: CustomerAccountMemberWritePort;
}

export interface InvitationServiceDeps {
  readonly emFactory: () => EntityManager;
  readonly accounts: InvitationAccountPorts;
  /** Runs the two invitation Commands (Principle XIII). */
  readonly commandBus: { run<T>(command: Command<T>): Promise<T> };
  readonly mailer?: EmailMailerPort | null;
  /** Storefront base used when building the redemption link. */
  readonly acceptBaseUrl?: string;
  readonly events?: OrganizationEventBus;
  readonly templateEmail?: OrgTemplateEmail;
  /** The invitation accept's audit row (the accept is anonymous and not a Command). */
  readonly auditLog?: AuditPort;
  /**
   * This module's bundle, for the role label the template e-mail shows
   * (#667, FR-008). Absent, the English label.
   */
  readonly translate?: OrganizationsTranslate;
  /**
   * The language the template e-mail is written in — the system-default sales
   * channel's, which is what `templateEmailPort` resolves (the invitee's own
   * language is not known). Absent, English.
   */
  readonly resolveEmailLanguage?: () => Promise<SupportedLanguage>;
}

export class InvitationService {
  private readonly mailer: EmailMailerPort | null;
  private readonly acceptBaseUrl: string;
  private readonly templateEmail: OrgTemplateEmail;

  constructor(private readonly deps: InvitationServiceDeps) {
    this.mailer = deps.mailer ?? null;
    this.acceptBaseUrl = deps.acceptBaseUrl ?? 'https://storefront.local';
    this.templateEmail = deps.templateEmail ?? noopOrgTemplateEmail;
  }

  async invite(
    actor: { organizationId: string; customerAccountId?: string | null },
    input: { email: string; roleId?: string },
  ): Promise<InvitationResult> {
    const em = this.deps.emFactory();
    // This module keeps a row of its own on the same address, so it folds it
    // the same way the account table does rather than by a private rule.
    const invitedEmail = normalizeEmailAddress(input.email);

    // Feature 051 — a personal (B2C) organization is single-member by
    // definition; it cannot invite additional members. First, before the role
    // is resolved (owner ruling PR-3): its administrator is answered by the
    // Organization's kind, whatever role id it sent.
    const actorOrg = await em.findOne(Organization, { id: actor.organizationId });
    if (actorOrg?.isPersonal) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'A personal (individual) account cannot invite members.',
      );
    }

    // Pre-check existing membership.
    const existingByEmail = await this.deps.accounts.read.findByEmail(invitedEmail);
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
    const { invitation, role } = await this.deps.commandBus.run(
      makeCreateOrganizationInvitationCommand({
        organizationId: actor.organizationId,
        invitedByCustomerAccountId: actor.customerAccountId ?? null,
        email: invitedEmail,
        roleId: input.roleId,
        tokenHash: sha256Hex(rawToken),
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1_000),
      }),
    );

    if (this.mailer || this.templateEmail !== noopOrgTemplateEmail) {
      const organization = actorOrg ?? (await em.findOne(Organization, { id: actor.organizationId }));
      const inviter = actor.customerAccountId
        ? await this.deps.accounts.read.findById(actor.customerAccountId)
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
        // The in-code builder writes English, so it shows the English label.
        roleLabel: await this.roleLabel(role, 'en'),
        organizationRoleId: invitation.organizationRoleId,
        expiresAt: invitation.expiresAt,
        acceptBaseUrl: this.acceptBaseUrl,
        // Feature 167 — the invitee's language is not known: the channel default.
        pagePath: (path) => storefrontPagePathFor({ path, channel: currentSalesChannel() }),
      });
      const acceptUrl = (message.meta as { acceptUrl?: string } | undefined)?.acceptUrl ?? '';
      const sentViaTemplate = await this.templateEmail.trySend({
        code: 'organization_invitation',
        to: invitation.email,
        messageId: message.messageId,
        variables: {
          organizationName,
          inviterName,
          // #667 — the role's own label, in the language the template is sent in.
          roleLabel: await this.roleLabel(role, await this.emailLanguage()),
          acceptUrl,
          expiresOn: invitation.expiresAt.toISOString().slice(0, 10),
        },
        meta: message.meta,
      });
      if (!sentViaTemplate && this.mailer) {
        const outcome = await this.mailer.send(message);
        // Only the transport's refusal is named here. `logged` (issue #186) is the
        // console driver saying no mail server is configured: it has already
        // written the message to the log itself, and the delivery record says so.
        if (outcome.status === 'suppressed') {
          // This method answers the invitation, not the message, so the
          // non-send is named rather than returned — and since D-59 the same
          // fact is a row an operator can read after the log has rotated.
          console.warn('[organizations] the invitation e-mail was not sent', {
            invitationId: invitation.id,
            reason: outcome.reason,
          });
        }
      }
    }

    return { invitation, rawToken };
  }

  /**
   * Lists every pending invitation on the actor's organization: neither
   * accepted, revoked nor expired — the acceptance path's own test of expiry
   * (FR-010a, owner ruling PR-7, research R-37). An expired invitation cannot
   * be accepted, so listing it would tell the administrator a colleague is
   * about to join who cannot.
   */
  async listPending(actor: { organizationId: string }): Promise<OrganizationInvitation[]> {
    const em = this.deps.emFactory();
    return em.find(
      OrganizationInvitation,
      {
        organizationId: actor.organizationId,
        consumedAt: null,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      },
      { orderBy: { createdAt: 'desc' } },
    );
  }

  async revoke(
    actor: { organizationId: string },
    invitationId: string,
  ): Promise<void> {
    await this.deps.commandBus.run(
      makeRevokeOrganizationInvitationCommand(
        { accounts: this.deps.accounts.read },
        { organizationId: actor.organizationId, invitationId },
      ),
    );
  }

  /** A role's label (FR-008): a predefined role's name in `language`, a custom role's own name. */
  private async roleLabel(
    role: Pick<OrganizationRole, 'kind' | 'name'>,
    language: SupportedLanguage,
  ): Promise<string> {
    if (role.kind === 'custom') return role.name ?? '';
    const english = PREDEFINED_ROLE_ENGLISH_NAMES[role.kind];
    if (!this.deps.translate) return english;
    const key = `organizationRoles.${role.kind}.name`;
    const text = await this.deps.translate(key, language);
    return text === key || text === `organizations.${key}` ? english : text;
  }

  private async emailLanguage(): Promise<SupportedLanguage> {
    return this.deps.resolveEmailLanguage ? this.deps.resolveEmailLanguage() : 'en';
  }

  /**
   * The account insert and the invitation's `consumedAt` were one flush until
   * feature 075's Phase C, and they are two units of work now: the account is
   * `customer_accounts`' row, the invitation is this module's, and no port
   * parameter may be a unit of work (D-78). The two modules share no foreign
   * key between *these* two rows, so D-78's second answer does not apply and
   * the seam is split rather than declared.
   *
   * The account is created **first**, deliberately. If the consume then fails,
   * the buyer has the account they just set a password for and can sign in;
   * what is left behind is a pending invitation an org admin can revoke. The
   * other order loses the account instead, which is the half that cannot be
   * recovered from the screen the buyer is looking at.
   */
  async acceptByToken(
    rawToken: string,
    input: { password: string; firstName: string; lastName: string },
  ): Promise<{ customerAccount: CustomerAccountRecord }> {
    const em = this.deps.emFactory();
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

    // FR-041: at most one CustomerAccount per email installation-wide. The
    // owner re-checks inside `create`; this one keeps the invitation
    // unconsumed when the address is already taken.
    const existing = await this.deps.accounts.read.findByEmail(invitation.email);
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

    const customer = await this.deps.accounts.write.create({
      organizationId: invitation.organizationId,
      email: invitation.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      // The role the invitation names (`specs/170-organization-roles/`
      // data-model §3).
      organizationRoleId: invitation.organizationRoleId,
      // Accepting an invitation implies a confirmed address: it was delivered
      // to that address.
      emailVerified: true,
    });
    invitation.consumedAt = new Date();
    if (this.deps.auditLog) {
      recordAuditFromContext(this.deps.auditLog, em, {
        action: 'organization.invite_accept',
        objectType: 'organization',
        objectId: invitation.organizationId,
        stateBefore: null,
        stateAfter: {
          email: invitation.email,
          organizationRoleId: invitation.organizationRoleId,
          customerAccountId: customer.id,
        },
      });
    }
    await em.flush();

    if (this.deps.events) {
      emitCustomerAccountCreated(this.deps.events, customer.id, invitation.organizationId);
    }

    return { customerAccount: customer };
  }

  /**
   * Latest unconsumed token id — exposed only by the test probe so
   * integration tests can complete the accept step without the email.
   */
  async latestUnconsumedTokenInvitationId(): Promise<string | null> {
    const em = this.deps.emFactory();
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
