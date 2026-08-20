import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { SocialLinksPanel } from '../../components/account/SocialLinksPanel';
import type { MfaSocialLink } from '../../lib/api/mfa';

/**
 * Issue #194 — the account security page shows the identities linked to the
 * account and offers to sever one.
 *
 * The refusal is rendered from the server's verdict (`canUnlink`), never from
 * a guess this component makes: the account whose only link this is may have a
 * random password nobody knows, so the button that would remove its last way
 * in is replaced by the route that repairs the situation first. Since issue
 * #222 that route exists and works — password reset, not change-password,
 * because the holder cannot supply a current password they were never given.
 */
const GOOGLE: MfaSocialLink = {
  provider: 'google',
  email: 'buyer@example.com',
  linkedAt: '2026-05-01T10:00:00.000Z',
  canUnlink: true,
  unlinkBlockedReason: null,
};

const LAST_LINK: MfaSocialLink = { ...GOOGLE, canUnlink: false, unlinkBlockedReason: 'last_credential' };

async function noop(): Promise<void> {}

function render(links: MfaSocialLink[], locale = 'en-US'): string {
  return renderToString(
    <SocialLinksPanel links={links} locale={locale} unlinkAction={noop} />,
  );
}

describe('SocialLinksPanel', () => {
  it('lists a linked identity with its provider and the address it was linked under', () => {
    const html = render([GOOGLE]);
    expect(html).toContain('Google');
    expect(html).toContain('buyer@example.com');
    expect(html).toContain('Linked accounts');
  });

  it('offers the unlink when the server says the account keeps another credential', () => {
    const html = render([GOOGLE, { ...GOOGLE, provider: 'microsoft' }]);
    expect(html).toContain('Remove');
    expect(html).toContain('name="provider"');
    expect(html).toContain('value="google"');
    expect(html).toContain('value="microsoft"');
  });

  it('replaces the unlink with the reason and the step that lifts it', () => {
    const html = render([LAST_LINK]);
    expect(html).toContain(
      'This is the last sign-in identity linked to your account, and your account has no password on record',
    );
    expect(html).toContain('Set a password');
    // Password reset, not the change-password form: that form verifies the
    // current password, which is precisely what this holder does not have.
    // Pointing at it is what made the first version of this sentence an errand
    // (issue #194), and issue #222 is what makes the sentence true again.
    expect(html).toContain('/password-reset/request');
    expect(html).not.toContain('/account/password');
    // No form at all, not a disabled button: the control that would submit the
    // removal is what must be absent, and `provider` is only ever submitted by
    // that form.
    expect(html).not.toContain('name="provider"');
    expect(html).not.toContain('<button');
  });

  it('renders nothing at all when the account has no linked identity', () => {
    expect(render([])).toBe('');
  });

  it('ships the copy in Polish as well as English', () => {
    const html = render([LAST_LINK], 'pl-PL');
    expect(html).toContain('Powiązane konta');
    expect(html).toContain(
      'To ostatnia tożsamość logowania powiązana z Twoim kontem, a konto nie ma zapisanego hasła',
    );
    expect(html).toContain('Ustaw hasło');
  });
});
