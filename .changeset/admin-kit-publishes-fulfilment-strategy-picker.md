---
'@endora-commerce/admin-kit': minor
---

`@endora-commerce/admin-kit/components` gains `FulfilmentStrategyPicker` (feature 091, P9).

The control sat under `inventory`'s admin directory and was rendered by `catalog`'s product
Inventory tab and by `organizations`' fulfilment panel. It is a **published component and
never was a zone contribution**: its props are a value in and a value back, and both
consumers own the save (`contracts/admin-component-contribution.md` §10.2, Z1 question 1).

**Exported symbols.** `FulfilmentStrategyPicker`, and the three types
`FulfilmentStrategyPickerProps`, `FulfilmentStrategyValue` and `FulfilmentWarehouseOption`.

```ts
import {
  FulfilmentStrategyPicker,
  type FulfilmentStrategyValue,
  type FulfilmentWarehouseOption,
} from '@endora-commerce/admin-kit/components';
```

```tsx
<FulfilmentStrategyPicker
  value={value}            // { strategy: FulfilmentStrategy | null; warehouseOrder: string[] }
  onChange={setValue}      // every edit, including the ordering, arrives here
  warehouses={warehouses}  // { id, code, name }[] — the caller's list
  allowInherit             // optional: offers an "inherit" option that maps to a null strategy
  disabled={saving}        // optional
  idPrefix="org-fulfilment" // optional: disambiguates element ids when two pickers share a page
/>
```

**Nothing about the component changed** — same props, same behaviour, same element ids. It
keeps no state of its own: the parent owns `value` and the warehouse list, and owns the
PATCH.

**No key moves and no bundle changes.** The component already read `useTranslation('core')`
and every `fulfilment.*` key it renders was already `@endora-commerce/mod-i18n`'s in both
shipped languages, so ruling R-1 §9.2 — a translation namespace is module knowledge — costs
this publication nothing. A consumer supplying its own bundle needs the fourteen
`fulfilment.*` keys under `core`, which is where they already are.

`admin/src/modules/inventory/components/FulfilmentStrategyPicker.tsx` stays as a re-export
shim over the package's own bindings, so the old spelling and the subpath name one module
record.
