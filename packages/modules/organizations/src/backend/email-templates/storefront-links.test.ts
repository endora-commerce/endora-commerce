import { describe, expect, it } from 'vitest';
import { buildInvitationEmail } from './invitation.js';
import { buildVerificationEmail } from './verification.js';

/**
 * Feature 167 (US6, FR-034) — the organization e-mails link storefront pages under the
 * language prefix: the caller passes the channel's path composer (`storefrontPagePathFor`),
 * and without one the logical path is kept.
 */
const enPrefix = (path: string): string => `/en${path}`;

describe('organization e-mail links', () => {
  it('the verification link is the prefixed /verify page', () => {
    const message = buildVerificationEmail({
      customerAccountId: 'c-1',
      rawToken: 'a/b',
      recipientEmail: 'a@example.com',
      organizationName: 'Acme',
      storefrontBaseUrl: 'https://shop.example.com/',
      pagePath: enPrefix,
    });
    expect((message.meta as { verifyUrl: string }).verifyUrl).toBe('https://shop.example.com/en/verify?token=a%2Fb');
    expect(message.text).toContain('https://shop.example.com/en/verify?token=a%2Fb');
  });

  it('the invitation link is the prefixed accept page', () => {
    const message = buildInvitationEmail({
      invitationId: 'i-1',
      rawToken: 'tok',
      inviteeEmail: 'b@example.com',
      inviterName: 'Ann',
      organizationName: 'Acme',
      roleLabel: 'Member',
      organizationRoleId: '00000000-0000-4000-8000-000000000170',
      expiresAt: new Date('2026-11-05T00:00:00Z'),
      acceptBaseUrl: 'https://shop.example.com',
      pagePath: enPrefix,
    });
    expect((message.meta as { acceptUrl: string }).acceptUrl).toBe('https://shop.example.com/en/invitations/tok/accept');
  });

  it('keeps the logical path without a composer', () => {
    const message = buildVerificationEmail({
      customerAccountId: 'c-1',
      rawToken: 't',
      recipientEmail: 'a@example.com',
      organizationName: 'Acme',
      storefrontBaseUrl: 'https://shop.example.com',
    });
    expect((message.meta as { verifyUrl: string }).verifyUrl).toBe('https://shop.example.com/verify?token=t');
  });
});
