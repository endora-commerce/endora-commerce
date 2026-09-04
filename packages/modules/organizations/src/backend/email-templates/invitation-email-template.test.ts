import { describe, expect, it } from 'vitest';
import { buildInvitationEmail } from './invitation.js';

/**
 * T178 — pure template builder. The renderer is keyboard-only because
 * production composition wires whatever Mailer transport it likes.
 */

describe('buildInvitationEmail', () => {
  const base = {
    invitationId: 'inv-123',
    rawToken: 'tok-abc',
    inviteeEmail: 'invitee@example.com',
    inviterName: 'Jane Doe',
    organizationName: 'Acme Polska',
    role: 'regular_user' as const,
    expiresAt: new Date('2026-05-09T00:00:00.000Z'),
    acceptBaseUrl: 'https://shop.example.com',
  };

  it('renders subject, accept link, role label and expiry date', () => {
    const out = buildInvitationEmail(base);
    expect(out.to).toBe('invitee@example.com');
    expect(out.subject).toBe("You're invited to join Acme Polska");
    expect(out.text).toContain('Jane Doe invited you to join "Acme Polska"');
    expect(out.text).toContain('as Member.');
    expect(out.text).toContain('https://shop.example.com/invitations/tok-abc/accept');
    expect(out.text).toContain('expires 2026-05-09');
  });

  it('uses an Org Admin role label when role is organization_admin', () => {
    const out = buildInvitationEmail({ ...base, role: 'organization_admin' });
    expect(out.text).toContain('as Organization Admin.');
    expect(out.meta?.['role']).toBe('organization_admin');
  });

  it('strips a trailing slash from the base URL when building the accept link', () => {
    const out = buildInvitationEmail({ ...base, acceptBaseUrl: 'https://shop.example.com/' });
    expect(out.text).toContain('https://shop.example.com/invitations/tok-abc/accept');
    expect(out.meta?.['acceptUrl']).toBe('https://shop.example.com/invitations/tok-abc/accept');
  });

  it('uses the invitation id as the idempotent messageId', () => {
    const out = buildInvitationEmail(base);
    expect(out.messageId).toBe('invitation:inv-123');
  });
});
