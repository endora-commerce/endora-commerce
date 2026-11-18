import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * `specs/180-off-platform-complaints/` T111 (D-18; design review R-2.3): the labelled,
 * server-renderable address fields extracted from `AddressForm`, which the returns form
 * reuses — and `AddressForm` renders the same markup through them as before.
 */
vi.mock('../../lib/dictionary/pickers/CountryPicker', () => ({
  CountryPicker: (props: Record<string, unknown>) => <select {...props} />,
}));

const { AddressFields } = await import('../../components/account/AddressFields');
const { AddressForm } = await import('../../components/account/AddressForm');

const t = tForLocale('en-US');

describe('AddressFields', () => {
  it('renders labelled inputs with autocomplete, under a name prefix', () => {
    const html = renderToString(
      <AddressFields t={t} idPrefix="ret-addr" namePrefix="returnAddress." company defaults={{ street: 'Prosta 1', city: 'Warszawa' }} />,
    );
    for (const [field, autocomplete] of [
      ['street', 'street-address'],
      ['postalCode', 'postal-code'],
      ['city', 'address-level2'],
      ['phone', 'tel'],
      ['company', 'organization'],
    ] as const) {
      expect(html).toMatch(new RegExp(`name="returnAddress\\.${field}"[^>]*autoComplete="${autocomplete}"|autoComplete="${autocomplete}"[^>]*name="returnAddress\\.${field}"`));
    }
    expect(html).toContain('name="returnAddress.country"');
    expect(html).toContain('for="ret-addr-street"');
    expect(html).toContain('value="Prosta 1"');
  });

  it('marks a field at fault and points to its message', () => {
    const html = renderToString(<AddressFields t={t} idPrefix="ret-addr" errors={{ city: 'Enter the city.' }} />);
    expect(html).toMatch(/aria-invalid="true"[^>]*aria-describedby="ret-addr-city-error"|aria-describedby="ret-addr-city-error"[^>]*aria-invalid="true"/);
    expect(html).toContain('id="ret-addr-city-error"');
    expect(html).toContain('Enter the city.');
  });
});

describe('AddressForm through AddressFields', () => {
  it('renders the same markup as before', () => {
    const html = renderToString(<AddressForm action={async (s) => s} locale="en-US" returnTo="/addresses" />);
    expect(html).toMatchSnapshot();
  });
});
