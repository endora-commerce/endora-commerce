---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-pim-akeneo': minor
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

Nothing else in `@endora-commerce/contracts` changes. The two catalogue schemas the Akeneo shapes
compose — `apiAttributeTypeSchema` and `productLinkKindSchema` — stay where they are, and the
module now imports them from there. `@endora-commerce/mod-pim-akeneo` gains the `./contracts`
export and already declared `zod` as a peer dependency, so installing it pulls in nothing new.
