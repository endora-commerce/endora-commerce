---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-pim-ergonode': minor
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
module now imports them from there. `@endora-commerce/mod-pim-ergonode` gains the `./contracts`
export and already declared `zod` as a peer dependency, so installing it pulls in nothing new.

`@endora-commerce/mod-pim-ergonode` also owns its thirteen error codes now: the root export gains
`pimErgonodeErrorCodes`, declared with `defineModuleErrorCodes`, and every raise site in the module
uses it instead of `ERROR_CODES.PIM_ERGONODE_*`. The codes' values on the wire do not change.
