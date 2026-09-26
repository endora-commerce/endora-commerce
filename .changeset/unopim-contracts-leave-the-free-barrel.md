---
'@endora-commerce/contracts': minor
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

**`ERROR_CODES` also loses its twelve `PIM_UNOPIM_*` members**, because the enumeration is the
vocabulary of the codes this repository's own modules declare and the UnoPim connector is no longer
one of them: `PIM_UNOPIM_NOT_CONFIGURED`, `PIM_UNOPIM_CONNECTION_EXISTS`,
`PIM_UNOPIM_SCHEDULE_INVALID`, `PIM_UNOPIM_IMPORT_ALREADY_RUNNING`,
`PIM_UNOPIM_CONNECTION_DISABLED`, `PIM_UNOPIM_TYPE_INCOMPATIBLE`,
`PIM_UNOPIM_TARGET_ATTRIBUTE_NOT_FOUND`, `PIM_UNOPIM_TARGET_ALREADY_MAPPED`,
`PIM_UNOPIM_CURRENCY_INACTIVE`, `PIM_UNOPIM_ATTRIBUTE_NOT_PRICE_TYPE`,
`PIM_UNOPIM_BINDING_EXISTS` and `PIM_UNOPIM_FIELD_PATH_INVALID`. The strings on the wire are
unchanged; code that compared against them takes `pimUnopimErrorCodes` from
`@endora-commerce/mod-pim-unopim` instead.

`@endora-commerce/mod-pim-unopim` itself is no longer released from this repository: it leaves for
the paid-modules repository in the same change, and its next version — with the `./contracts`
export and a root `pimUnopimErrorCodes`, declared with `defineModuleErrorCodes` — is cut there.
It already declared `zod` as a peer dependency, so installing it pulls in nothing new.
