/**
 * Re-export shim — this file's implementation now lives in
 * `@endora-commerce/admin-kit/components` (feature 091, batch 8).
 *
 * The picker read `dictionaries`' own admin API client, and `taxes` and
 * `inventory` each imported it across a module boundary. The exit is P2's: it
 * names the endpoint and `DictionaryCountriesPageResponse`, both of which every
 * consumer already compiles, and depends on no module's code.
 *
 * **Its copy is `core`'s now** (R-1): the three `countryPicker.*` keys moved
 * from this module's bundle into `_i18n`'s under the same spelling, so nothing
 * an operator reads changes in either shipped language.
 *
 * **The forwarding is the identity, not a copy** —
 * `admin/test/kit/admin-kit-identity.test.ts` asserts reference equality.
 */
export { CountryPicker } from '@endora-commerce/admin-kit/components';
export type { CountryPickerProps } from '@endora-commerce/admin-kit/components';
