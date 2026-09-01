/**
 * Re-export shim — this file's implementation now lives in
 * `@endora-commerce/admin-kit/components` (feature 091, P9).
 *
 * The picker sat under `inventory`'s admin directory and was rendered by
 * `catalog`'s product Inventory tab and by `organizations`' fulfilment panel —
 * two `cross-module-imports` keys over a control that holds nothing of
 * `inventory`. It is a **published component and never was a zone**: its props
 * are `(value, onChange, warehouses, …)`, which is
 * `contracts/admin-component-contribution.md`'s Z1 question 1 verbatim, and
 * both consumers own the save. Its copy was already `core`'s in both shipped
 * languages, so R-1 §9.2 moved no key.
 *
 * Both consumers name the package subpath directly. The shim stays because the
 * old path is the spelling this module's own screens and any client tree may
 * already hold, and because a second resolution would be a second copy of the
 * component.
 *
 * **The forwarding is the identity, not a copy.** These names are the package's
 * own bindings; `admin/test/kit/admin-kit-identity.test.ts` asserts reference
 * equality across the seam, because a second component object passes every
 * structural comparison and still breaks at runtime.
 */
export { FulfilmentStrategyPicker } from '@endora-commerce/admin-kit/components';
export type {
  FulfilmentStrategyPickerProps,
  FulfilmentStrategyValue,
  FulfilmentWarehouseOption,
} from '@endora-commerce/admin-kit/components';
