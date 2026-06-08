import type { ReactNode } from 'react';

/**
 * Federated sign-in buttons (feature 042, US4). Anchor links to the backend
 * OAuth `start` endpoint (absolute URL — the OAuth dance runs in the browser).
 * The backend gates disabled providers, so a click on an unconfigured provider
 * returns to the login screen with a message.
 */
export function SocialLoginButtons({
  backendBaseUrl,
  next,
}: {
  backendBaseUrl: string;
  next: string;
}): ReactNode {
  const href = (provider: 'google' | 'microsoft'): string =>
    `${backendBaseUrl}/api/v1/auth/customer/oauth/${provider}/start?next=${encodeURIComponent(next)}`;
  return (
    <div className="b2b-auth__social">
      <a className="b2b-auth__social-btn" href={href('google')} data-provider="google">
        Continue with Google
      </a>
      <a className="b2b-auth__social-btn" href={href('microsoft')} data-provider="microsoft">
        Continue with Microsoft
      </a>
    </div>
  );
}
