---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-pim-pimcore': minor
---

`@endora-commerce/contracts` no longer exports the Pimcore PIM connector's schemas; the connector publishes its own

**If you import any `pimcore*`/`Pimcore*` symbol, `PIM_PIMCORE_SETTING_CODES` or
`PimPimcoreSettingCode` from `@endora-commerce/contracts`, this release removes it.** A hundred and
sixty-two exports go: the source vocabulary, the import run and issue shapes, the mapping-decision
vocabulary, the connection, bootstrap and probe shapes, the complete-record and full-delivery HMAC
envelopes, the lookup query and page shapes, the admin mapping, price-binding and field-protection
request and view shapes, the setting codes, and every type inferred beside them. They are now on
the module's own `./contracts` subpath:

```diff
- import { pimcoreConnectionDtoSchema, PIM_PIMCORE_SETTING_CODES } from '@endora-commerce/contracts';
+ import { pimcoreConnectionDtoSchema, PIM_PIMCORE_SETTING_CODES } from '@endora-commerce/mod-pim-pimcore/contracts';
```

Nothing else in `@endora-commerce/contracts` changes. The two catalogue schemas the Pimcore shapes
compose — `apiAttributeTypeSchema` and `productLinkKindSchema` — stay where they are, and the
module now imports them from there. `@endora-commerce/mod-pim-pimcore` gains the `./contracts`
export and already declared `zod` as a peer dependency, so installing it pulls in nothing new.

`@endora-commerce/mod-pim-pimcore` also owns its seventeen error codes now: the root export gains
`pimPimcoreErrorCodes`, declared with `defineModuleErrorCodes`, and every raise site in the module
uses it instead of `ERROR_CODES.PIM_PIMCORE_*`. The codes' values on the wire do not change.
