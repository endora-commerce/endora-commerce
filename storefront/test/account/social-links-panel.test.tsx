import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { SocialLinksPanel } from '../../components/account/SocialLinksPanel';
import type { MfaSocialLink } from '../../lib/api/mfa';

/**
 * Issue #194 — the account security page shows the identities linked to the
 * account and offers to sever one.
 *
 * The refusal is rendered from the server's verdict (`canUnlink`), never from
 * a guess this component makes: the account whose only link this is has a
 * random password nobody knows, so the button that would remove its last way
 * in is replaced by the route that repairs the situation first.
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

  it('states plainly that the last link cannot be removed, and offers no errand', () => {
    const html = render([LAST_LINK]);
    expect(html).toContain(
      'This is the last sign-in identity linked to your account, and it cannot be removed.',
    );
    expect(html).toContain('There is no way to remove it at the moment.');
    // The rule the server enforces counts links, so setting a password lifts
    // nothing. Telling the holder to set one would be an instruction with no
    // effect on the screen whose value is that its statements are true.
    expect(html).not.toContain('/account/password');
    expect(html).not.toContain('Set a password');
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
      'To ostatnia tożsamość logowania powiązana z Twoim kontem i nie można jej usunąć.',
    );
    expect(html).toContain('Obecnie nie ma możliwości usunięcia tego powiązania.');
  });
});
