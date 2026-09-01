/**
 * Re-export shim — this file's implementation now lives in
 * `@endora-commerce/admin-kit/components` (feature 091, batch 8).
 *
 * The sibling of `CountryPicker`, on identical terms: `credit_limits` and
 * `delivery_methods` each imported it across a module boundary, it read this
 * module's admin API client, and it now names the endpoint and
 * `DictionaryCurrenciesPageResponse` instead. Its three `currencyPicker.*` keys
 * are `_i18n`'s under the same spelling (R-1).
 *
 * **The forwarding is the identity, not a copy** —
 * `admin/test/kit/admin-kit-identity.test.ts` asserts reference equality.
 */
export { CurrencyPicker } from '@endora-commerce/admin-kit/components';
export type { CurrencyPickerProps } from '@endora-commerce/admin-kit/components';
