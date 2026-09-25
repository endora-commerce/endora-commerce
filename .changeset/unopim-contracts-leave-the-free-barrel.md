---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-pim-unopim': minor
---

`@endora-commerce/contracts` no longer exports the UnoPim PIM connector's schemas; the connector publishes its own

**If you import any `unopim*`/`Unopim*` symbol, `PIM_UNOPIM_SETTING_CODES`, `PimUnopimSettingCode`
or the `PIM_UNOPIM_{READ,WRITE}_PERMISSION` constants from `@endora-commerce/contracts`, this
release removes it.** One hundred and five exports go: the permission and setting codes, the
connection, mapping, price-binding and field-protection request and response shapes, the import run
and issue shapes, the webhook event, and every type inferred beside them. They are now on the
module's own `./contracts` subpath:

```diff
- import { unopimConnectionSchema, PIM_UNOPIM_SETTING_CODES } from '@endora-commerce/contracts';
+ import { unopimConnectionSchema, PIM_UNOPIM_SETTING_CODES } from '@endora-commerce/mod-pim-unopim/contracts';
```

Nothing else in `@endora-commerce/contracts` changes. The catalogue and PIM-connector schemas the
UnoPim shapes compose — `apiAttributeTypeSchema`, `productLinkKindSchema`, `pimFieldPathSchema` and
the `pimImport*` schemas — stay where they are, and the module now imports them from there.

`@endora-commerce/mod-pim-unopim` gains the `./contracts` export. It already declared `zod` as a
peer dependency, so installing it pulls in nothing new.

`@endora-commerce/mod-pim-unopim` also owns its twelve error codes now: the root export gains
`pimUnopimErrorCodes`, declared with `defineModuleErrorCodes`, and every raise site in the module
uses it instead of `ERROR_CODES.PIM_UNOPIM_*`. The codes' values on the wire do not change.
