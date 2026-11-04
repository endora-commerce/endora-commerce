import type { EmailMailerSendInput } from '@endora-commerce/contracts';

/**
 * Invitation email template (T178 / FR-043).
 *
 * Pure builder — takes the raw token (returned by InvitationService.invite)
 * plus the surrounding context, returns the EmailMailerSendInput an Org Admin
 * can dispatch via any Mailer. Kept template-y on purpose: production can
 * swap in an HTML renderer by widening Mailer; today the plain-text body
 * is enough for the SMTP transport and the in-memory test mailer alike.
 */

export interface BuildInvitationEmailInput {
  invitationId: string;
  rawToken: string;
  inviteeEmail: string;
  inviterName: string;
  organizationName: string;
  /**
   * The role's own label (`specs/170-organization-roles/` WP-03; #667,
   * FR-008): a predefined role's name in this e-mail's language, a custom
   * role's name verbatim. The builder never spells a role itself.
   */
  roleLabel: string;
  /** The role the invitation names, for the delivery metadata. */
  organizationRoleId: string;
  expiresAt: Date;
  /** Storefront base URL used to build the redemption link. */
  acceptBaseUrl: string;
  /** Puts the storefront language prefix on the page path (feature 167, FR-034); absent: the logical path. */
  pagePath?: (path: string) => string;
}

export function buildInvitationEmail(input: BuildInvitationEmailInput): EmailMailerSendInput {
  const path = `/invitations/${input.rawToken}/accept`;
  const acceptUrl = `${trimSlash(input.acceptBaseUrl)}${input.pagePath ? input.pagePath(path) : path}`;
  const roleLabel = input.roleLabel;
  const expiresOn = input.expiresAt.toISOString().slice(0, 10);

  const text = [
    `Hi,`,
    ``,
    `${input.inviterName} invited you to join "${input.organizationName}" on the B2B platform`,
    `as ${roleLabel}.`,
    ``,
    `Accept the invitation here (link expires ${expiresOn}):`,
    acceptUrl,
    ``,
    `If you did not expect this email, you can safely ignore it — the link will`,
    `expire on its own and no account will be created.`,
  ].join('\n');

  return {
    messageId: `invitation:${input.invitationId}`,
    to: input.inviteeEmail,
    subject: `You're invited to join ${input.organizationName}`,
    text,
    meta: {
      kind: 'organization_invitation',
      invitationId: input.invitationId,
      organizationName: input.organizationName,
      organizationRoleId: input.organizationRoleId,
      expiresAt: input.expiresAt.toISOString(),
      acceptUrl,
    },
  };
}

function trimSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
