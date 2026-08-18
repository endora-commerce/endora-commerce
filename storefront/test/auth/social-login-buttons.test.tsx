import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { SocialLoginButtons } from '../../components/SocialLoginButtons';
import type { FederatedProvider } from '../../lib/federated-sign-in';

/**
 * Feature 042 / US4 — federated sign-in links carry the sanitized `next`.
 * Issue #193 — and they render *only* for a provider the platform can actually
 * complete a sign-in with, divider and all.
 */
const BOTH: readonly FederatedProvider[] = ['google', 'microsoft'];

function render(props: {
  modulePresent: boolean | undefined;
  availableProviders: readonly FederatedProvider[] | undefined;
  locale?: string;
}): string {
  return renderToString(
    <SocialLoginButtons
      backendBaseUrl="http://api.example"
      next="/account/orders"
      locale={props.locale ?? 'en-US'}
      modulePresent={props.modulePresent}
      availableProviders={props.availableProviders}
    />,
  );
}

describe('SocialLoginButtons', () => {
  it('renders both providers with the start endpoint and the carried `next`', () => {
    const html = render({ modulePresent: true, availableProviders: BOTH });
    expect(html).toContain('Continue with Google');
    expect(html).toContain('Continue with Microsoft');
    expect(html).toContain(
      'http://api.example/api/v1/auth/customer/oauth/google/start?next=%2Faccount%2Forders',
    );
    expect(html).toContain('/api/v1/auth/customer/oauth/microsoft/start');
  });

  it('renders only the enabled provider when the other one is not available', () => {
    const html = render({ modulePresent: true, availableProviders: ['google'] });
    expect(html).toContain('Continue with Google');
    expect(html).not.toContain('Continue with Microsoft');
    expect(html).not.toContain('microsoft');
  });

  it('keeps the divider for a single provider — it marks the mode change', () => {
    // A lone bordered button directly under the filled submit reads as a second
    // step of the same form; the rule is what makes it an alternative route.
    const html = render({ modulePresent: true, availableProviders: ['google'] });
    expect(html).toContain('b2b-auth__social-divider');
  });

  it('renders nothing at all — divider included — when no provider is available', () => {
    // The default deployment: both settings are `false`.
    const html = render({ modulePresent: true, availableProviders: [] });
    expect(html).toBe('');
  });

  it('renders nothing when mfa is switched off, whatever the provider read said', () => {
    const html = render({ modulePresent: false, availableProviders: BOTH });
    expect(html).toBe('');
  });

  it('renders nothing while presence is still unresolved', () => {
    // The loading gap: never a provisional button, never a reserved skeleton.
    // The only transition this screen can make is "nothing → buttons", and it
    // happens below the submit button, so no target moves under a cursor.
    const html = render({ modulePresent: undefined, availableProviders: BOTH });
    expect(html).toBe('');
  });

  it('renders nothing while the provider read is still unresolved', () => {
    const html = render({ modulePresent: true, availableProviders: undefined });
    expect(html).toBe('');
  });

  it('labels the group and hides the decorative rule from assistive tech', () => {
    const html = render({ modulePresent: true, availableProviders: BOTH });
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Other sign-in options"');
    expect(html).toContain('aria-hidden="true"');
  });

  it('ships the copy in Polish as well as English', () => {
    const html = render({
      modulePresent: true,
      availableProviders: BOTH,
      locale: 'pl-PL',
    });
    expect(html).toContain('Kontynuuj przez Google');
    expect(html).toContain('Kontynuuj przez Microsoft');
    expect(html).toContain('Inne sposoby logowania');
  });
});
