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

/**
 * React's own form-replay bootstrap, which `renderToString` appends after the first
 * `<form>` whose `action` is a function. It is React's markup, not this component's, and
 * its minified body changes between React releases (19.2 → 19.3 rewrote it) — so a
 * snapshot that kept it would go red on a React upgrade with nothing of ours changed, as
 * `acceptance:storefront-scaffold` A8 measured in a scaffold that resolved React 19.3.
 */
function withoutReactFormReplay(html: string): string {
  return html.replace(/<script>[^<]*\$\$reactFormReplay[^<]*<\/script>/g, '');
}

describe('AddressForm through AddressFields', () => {
  it('renders the same markup as before', () => {
    const html = renderToString(<AddressForm action={async (s) => s} locale="en-US" returnTo="/addresses" />);
    expect(html).toContain('$$reactFormReplay');
    expect(withoutReactFormReplay(html)).toMatchSnapshot();
  });
});
