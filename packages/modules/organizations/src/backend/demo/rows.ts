/**
 * The organisation this module's demo data creates (feature 113, T222).
 *
 * One place holding the data, imported by both bodies: `seed.ts` creates this
 * row and `reset.ts` withdraws exactly it, by the `taxId` it is keyed on
 * (contract §2.5) — the column the installation declares unique, and the one the
 * instance composition already resolves the demo organisation by.
 *
 * The values are the host seed's verbatim, moved rather than rewritten. The
 * frozen copy the parity comparison read them against is deleted with that
 * comparison (T226); what holds them now is
 * `test/integration/demo/demo-shop.test.ts`' recorded delta.
 *
 * ## What is not here
 *
 * The demo **buyer** and the demo **credit limit**. Both are another module's
 * row against this one's and are therefore composition steps (§5.1):
 * `customer_accounts.organization_id` is `NOT NULL`, so the buyer cannot even be
 * created before it has an organisation, and a grant is `credit_limits`' row
 * whose whole content is a reference to this one.
 *
 * ## §2.6 and the address
 *
 * `Organization.name` is a `varchar(255)` and `registeredAddress` a JSONB
 * snapshot of four scalars, so the per-language shape §2.6 asks for has nowhere
 * to go and putting it there would be a migration this feature does not take
 * (contract §8). None of these values is prose in any case: a company name, a
 * street, a city and a NIP are operator content that reads the same in both
 * shipped languages.
 */

/** The demo organisation, in `Organization`'s own field names. */
export const DEMO_ORGANIZATION = {
  name: 'Acme B2B (demo)',
  taxId: 'PL5210000099',
  status: 'active',
  vatStatus: 'vat_payer',
  registeredAddress: {
    street: 'ul. Demo 1',
    city: 'Warszawa',
    postalCode: '00-001',
    country: 'PL',
  },
} as const;
