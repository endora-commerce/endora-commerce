import { describe, expect, it } from 'vitest';
import { buildInvitationEmail } from './invitation.js';

/**
 * T178 — pure template builder. The renderer is keyboard-only because
 * production composition wires whatever Mailer transport it likes.
 *
 * `specs/170-organization-roles/` WP-03 (T055; #667, FR-008, US 5.1a): the
 * role is shown with the role's own label — the caller resolves it, a
 * predefined role's translated name or a custom role's name verbatim — and the
 * builder never spells a role itself.
 */

describe('buildInvitationEmail', () => {
  const base = {
    invitationId: 'inv-123',
    rawToken: 'tok-abc',
    inviteeEmail: 'invitee@example.com',
    inviterName: 'Jane Doe',
    organizationName: 'Acme Polska',
    roleLabel: 'Member',
    organizationRoleId: '00000000-0000-4000-8000-000000000170',
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

  it('shows the label it is given, a custom role’s name verbatim', () => {
    const out = buildInvitationEmail({ ...base, roleLabel: 'Zakupowiec — Główny' });
    expect(out.text).toContain('as Zakupowiec — Główny.');
    expect(out.text).not.toContain('Organization Admin');
  });

  it('names the role by id in the delivery metadata, not by the legacy enum', () => {
    const out = buildInvitationEmail(base);
    expect(out.meta?.['organizationRoleId']).toBe(base.organizationRoleId);
    expect(out.meta).not.toHaveProperty('role');
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
