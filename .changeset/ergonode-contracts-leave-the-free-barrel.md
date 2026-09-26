---
'@endora-commerce/contracts': minor
---

`@endora-commerce/contracts` no longer exports the Ergonode PIM connector's schemas; the connector publishes its own

**If you import any `ergonode*`/`Ergonode*` symbol, `PIM_ERGONODE_SETTING_CODES` or
`PimErgonodeSettingCode` from `@endora-commerce/contracts`, this release removes it.** Eighty-nine
exports go: the source vocabulary, the import run and issue shapes, the mapping-decision
vocabulary, the setting codes, the connection and connection-test shapes, the run list and detail
shapes, the attribute-mapping, price-binding, category-mapping and field-protection request and
view shapes, and every type inferred beside them. They are now on the module's own `./contracts`
subpath:

```diff
- import { ergonodeConnectionSchema, PIM_ERGONODE_SETTING_CODES } from '@endora-commerce/contracts';
+ import { ergonodeConnectionSchema, PIM_ERGONODE_SETTING_CODES } from '@endora-commerce/mod-pim-ergonode/contracts';
```

Nothing else in `@endora-commerce/contracts` changes. The two catalogue schemas the Ergonode shapes
compose — `apiAttributeTypeSchema` and `productLinkKindSchema` — stay where they are, and the
module now imports them from there.

**`ERROR_CODES` also loses its thirteen `PIM_ERGONODE_*` members**, because the enumeration is the
vocabulary of the codes this repository's own modules declare and the Ergonode connector is no longer
one of them: `PIM_ERGONODE_NOT_CONFIGURED`, `PIM_ERGONODE_CONNECTION_EXISTS`,
`PIM_ERGONODE_SCHEDULE_INVALID`, `PIM_ERGONODE_TREE_REQUIRED`,
`PIM_ERGONODE_IMPORT_ALREADY_RUNNING`, `PIM_ERGONODE_CONNECTION_DISABLED`,
`PIM_ERGONODE_TYPE_INCOMPATIBLE`, `PIM_ERGONODE_TARGET_ATTRIBUTE_NOT_FOUND`,
`PIM_ERGONODE_TARGET_ALREADY_MAPPED`, `PIM_ERGONODE_CURRENCY_INACTIVE`,
`PIM_ERGONODE_ATTRIBUTE_NOT_PRICE_TYPE`, `PIM_ERGONODE_BINDING_EXISTS` and
`PIM_ERGONODE_FIELD_PATH_INVALID`. The strings on the wire are unchanged; code that compared against
them takes `pimErgonodeErrorCodes` from `@endora-commerce/mod-pim-ergonode` instead.
`PRICE_LIST_NOT_FOUND`, which the connector raises and `price_lists` owns, stays.

`@endora-commerce/mod-pim-ergonode` itself is no longer released from this repository: it leaves for
the paid-modules repository in the same change, and its next version — with the `./contracts`
export and a root `pimErgonodeErrorCodes`, declared with `defineModuleErrorCodes` — is cut there.
It already declared `zod` as a peer dependency, so installing it pulls in nothing new.
