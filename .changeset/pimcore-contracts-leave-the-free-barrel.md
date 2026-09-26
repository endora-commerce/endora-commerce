---
'@endora-commerce/contracts': minor
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

**`ERROR_CODES` also loses its seventeen `PIM_PIMCORE_*` members**, because the enumeration is the
vocabulary of the codes this repository's own modules declare and the Pimcore connector is no longer
one of them: `PIM_PIMCORE_ALLOWLIST_INVALID`, `PIM_PIMCORE_ATTRIBUTE_NOT_PRICE_TYPE`,
`PIM_PIMCORE_BINDING_EXISTS`, `PIM_PIMCORE_BOOTSTRAP_INCOMPLETE`, `PIM_PIMCORE_CONNECTION_DISABLED`,
`PIM_PIMCORE_CONNECTION_EXISTS`, `PIM_PIMCORE_CURRENCY_INACTIVE`, `PIM_PIMCORE_FIELD_PATH_INVALID`,
`PIM_PIMCORE_IMPORT_ALREADY_RUNNING`, `PIM_PIMCORE_NOT_CONFIGURED`, `PIM_PIMCORE_OTHER_PIM_ENABLED`,
`PIM_PIMCORE_PRODUCT_FOLDER_REQUIRED`, `PIM_PIMCORE_PUSH_AUTH_REJECTED`, `PIM_PIMCORE_ROOT_REQUIRED`,
`PIM_PIMCORE_TARGET_ALREADY_MAPPED`, `PIM_PIMCORE_TARGET_ATTRIBUTE_NOT_FOUND` and
`PIM_PIMCORE_TYPE_INCOMPATIBLE`. The strings on the wire are unchanged; code that compared against
them takes `pimPimcoreErrorCodes` from `@endora-commerce/mod-pim-pimcore` instead.

Nothing else in `@endora-commerce/contracts` changes. The two catalogue schemas the Pimcore shapes
compose — `apiAttributeTypeSchema` and `productLinkKindSchema` — stay where they are, and the
module now imports them from there.

`@endora-commerce/mod-pim-pimcore` itself is no longer released from this repository: it leaves for
the paid-modules repository in the same change, and its next version — with the `./contracts`
export and a root `pimPimcoreErrorCodes`, declared with `defineModuleErrorCodes` — is cut there.
It already declared `zod` as a peer dependency, so installing it pulls in nothing new.
