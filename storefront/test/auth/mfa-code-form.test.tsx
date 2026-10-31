import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MfaCodeForm } from '../../components/MfaCodeForm';

/**
 * Feature 042 / US1 — storefront interaction test for the second-step code
 * screen. Verifies the form renders the code field + verify action and surfaces
 * an error message when present — in the page's language (issue #85).
 */
describe('MfaCodeForm', () => {
  const noop = (): void => {};

  it('renders the code field and verify button', () => {
    const html = renderToString(<MfaCodeForm action={noop} next="/account" locale="en-US" />);
    expect(html).toContain('Two-step verification');
    expect(html).toContain('Authentication code');
    expect(html).toContain('name="code"');
    expect(html).toContain('one-time-code');
    expect(html).toContain('value="/account"'); // hidden next field
    expect(html).toContain('Verify');
    expect(html).not.toMatch(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/);
  });

  it('renders in Polish', () => {
    const html = renderToString(<MfaCodeForm action={noop} next="/account" locale="pl-PL" />);
    expect(html).toContain('Weryfikacja dwuetapowa');
    expect(html).toContain('Wpisz 6-cyfrowy kod z aplikacji uwierzytelniającej lub kod odzyskiwania.');
    expect(html).toContain('Kod uwierzytelniający');
    expect(html).toContain('Zweryfikuj');
    expect(html).not.toContain('Two-step verification');
  });

  it('renders an error when provided', () => {
    const html = renderToString(
      <MfaCodeForm action={noop} next="/account" locale="en-US" error="The code is invalid or expired." />,
    );
    expect(html).toContain('The code is invalid or expired.');
  });

  it('omits the error block when there is no error', () => {
    const html = renderToString(<MfaCodeForm action={noop} next="/account" locale="en-US" />);
    expect(html).not.toContain('b2b-auth__error');
  });
});
