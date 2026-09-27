---
'@endora-commerce/contracts': minor
---

`@endora-commerce/contracts` no longer exports the Infakt connector's schemas; the connector publishes its own

**If you import any `infakt*`/`Infakt*` symbol or an `INFAKT_*` constant from
`@endora-commerce/contracts` or from its `./infakt` subpath, this release removes it.** Thirty-three
exports go: the environment and setting codes, the permission and credential codes, the delivery
messages, the API hosts and paths, the service-line, webhook-event and connection request and
response shapes, `InfaktHttpPort`, and every type inferred beside them. They are now on the
module's own `./contracts` subpath:

```diff
- import { INFAKT_SETTING_CODES, infaktConnectionDtoSchema } from '@endora-commerce/contracts';
+ import { INFAKT_SETTING_CODES, infaktConnectionDtoSchema } from '@endora-commerce/mod-infakt/contracts';
```

Nothing else in `@endora-commerce/contracts` changes; the invoice ledger's own vendor-neutral
contract stays where it is.

`@endora-commerce/mod-infakt` gains the `./contracts` export. It already declared `zod` as a peer
dependency, so installing it pulls in nothing new.

`@endora-commerce/mod-infakt` also owns its two error codes now: the root export gains
`infaktErrorCodes`, declared with `defineModuleErrorCodes`, and the webhook's raise site uses it
instead of `ERROR_CODES.INFAKT_WEBHOOK_UNAUTHORIZED`. The codes' values on the wire do not change.

The `mod-infakt` half of this change is released from the paid-modules repository, which the module left for
(feature 134); this repository no longer versions `@endora-commerce/mod-infakt`.
