---
'@endora-commerce/mod-pim-connector': major
'@endora-commerce/mod-pim-unopim': patch
---

Stop republishing `@endora-commerce/contracts` symbols out of the two PIM packages.

**Removed from `@endora-commerce/mod-pim-connector/backend`:**
`canonicalisePimFieldPath` and `isValidPimFieldPath`, together with the
`src/backend/services/field-path.ts` file that re-exported them. Both are, and
have always been, `@endora-commerce/contracts`' own exports — the canonical
implementation is `packages/contracts/src/pim-field-path.ts`, beside
`pimFieldPathSchema` — and the module package added nothing but a second
spelling of them.

```diff
-import { canonicalisePimFieldPath } from '@endora-commerce/mod-pim-connector/backend';
+import { canonicalisePimFieldPath } from '@endora-commerce/contracts';
```

Nothing in this repository took either name from the module package:
`pim_unopim`'s field-protection service and the unit test both already import
them from `@endora-commerce/contracts` directly.

**`@endora-commerce/mod-pim-unopim`** drops `export type
{ UnopimPassportStatus };` from `src/backend/services/unopim-client.port.ts`.
That file is internal — the `./backend` barrel republishes only
`UnoPimClientPort` from it — so no published surface changes; the type was
imported for the sole purpose of being re-exported and no consumer named it
there. `UnopimPassportStatus` is unchanged in `@endora-commerce/contracts`.

Both removals exist because a bare re-export is what the D-168 entity-surface
analysis cannot follow: it reported `unresolvable-reexport` for each package,
which is *"whether this barrel publishes an entity class by name is unknown"*
rather than *"it does not"*. Neither re-export was load-bearing, so the answer
is now known.
