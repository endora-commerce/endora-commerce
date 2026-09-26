---
'@endora-commerce/contracts': minor
---

`@endora-commerce/contracts` no longer exports the Akeneo PIM connector's schemas; the connector publishes its own

**If you import any `akeneo*`/`Akeneo*` symbol, `PIM_AKENEO_SETTING_CODES` or `PimAkeneoSettingCode`
from `@endora-commerce/contracts`, this release removes it.** Sixty-three exports go: the setting
codes, the connection, bootstrap and probe shapes, the full-delivery and live-record HMAC envelopes,
the import run and issue shapes, the lookup query and page shapes, the field-protection request and
product view, and every type inferred beside them. They are now on the module's own `./contracts`
subpath:

```diff
- import { akeneoConnectionDtoSchema, PIM_AKENEO_SETTING_CODES } from '@endora-commerce/contracts';
+ import { akeneoConnectionDtoSchema, PIM_AKENEO_SETTING_CODES } from '@endora-commerce/mod-pim-akeneo/contracts';
```

**`ERROR_CODES` also loses its seven `PIM_AKENEO_*` members**, because the enumeration is the
vocabulary of the codes this repository's own modules declare and the Akeneo connector is no longer
one of them: `PIM_AKENEO_NOT_CONFIGURED`, `PIM_AKENEO_CONNECTION_DISABLED`,
`PIM_AKENEO_BOOTSTRAP_INCOMPLETE`, `PIM_AKENEO_DELIVERY_ID_CONFLICT`, `PIM_AKENEO_CHANNEL_REQUIRED`,
`PIM_AKENEO_SECRET_REQUIRED` and `PIM_AKENEO_FIELD_KEY_INVALID`. The strings on the wire are
unchanged; code that compared against them takes `pimAkeneoErrorCodes` from
`@endora-commerce/mod-pim-akeneo` instead.

Nothing else in `@endora-commerce/contracts` changes. The two catalogue schemas the Akeneo shapes
compose — `apiAttributeTypeSchema` and `productLinkKindSchema` — stay where they are, and the
module now imports them from there.

`@endora-commerce/mod-pim-akeneo` itself is no longer released from this repository, from this
change on; its next version — with the `./contracts` export and a root `pimAkeneoErrorCodes`,
declared with `defineModuleErrorCodes` — is cut from the repository that now holds its source.
It already declared `zod` as a peer dependency, so installing it pulls in nothing new.
