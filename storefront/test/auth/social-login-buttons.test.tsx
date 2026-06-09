import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { SocialLoginButtons } from '../../components/SocialLoginButtons';

/**
 * Feature 042 / US4 — storefront federated sign-in buttons link to the backend
 * OAuth start endpoint with the sanitized `next` carried through.
 */
describe('SocialLoginButtons', () => {
  it('renders Google + Microsoft links to the backend start endpoints', () => {
    const html = renderToString(
      <SocialLoginButtons backendBaseUrl="http://api.example" next="/account/orders" />,
    );
    expect(html).toContain('Continue with Google');
    expect(html).toContain('Continue with Microsoft');
    expect(html).toContain(
      'http://api.example/api/v1/auth/customer/oauth/google/start?next=%2Faccount%2Forders',
    );
    expect(html).toContain('/api/v1/auth/customer/oauth/microsoft/start');
  });
});
