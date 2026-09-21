---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-invoice-ledger': patch
---

`@endora-commerce/contracts` no longer exports wFirma's schemas or its two error codes

**If you import any `wfirma*` or `WFIRMA_*` symbol from `@endora-commerce/contracts`, this
release removes it.** Twenty-six exports go — `WFIRMA_SETTING_CODES`, `WFIRMA_READ_PERMISSION`,
`WFIRMA_WRITE_PERMISSION`, `WFIRMA_INSTANCE_CREDENTIAL_CODE`, `WFIRMA_DELIVERY_MESSAGES`,
`WFIRMA_HOST`, the eight `WFIRMA_*_PATH` endpoint constants, `WFIRMA_WEBHOOK_EVENT_IDS`,
`wfirmaWebhookEventIdSchema`, `wfirmaWebhookEventDescriptorSchema`, `wfirmaConnectionDtoSchema`,
`wfirmaConnectionUpsertBodySchema`, `wfirmaConnectionTestResponseSchema`, `WfirmaHttpPort` and
each inferred type beside them. They are now on `@endora-commerce/mod-wfirma`'s own
`./contracts` subpath:

```diff
- import { wfirmaConnectionDtoSchema, WFIRMA_HOST } from '@endora-commerce/contracts';
+ import { wfirmaConnectionDtoSchema, WFIRMA_HOST } from '@endora-commerce/mod-wfirma/contracts';
```

**And `ERROR_CODES` loses two members**, `WFIRMA_CONNECTION_FAILED` and
`WFIRMA_WEBHOOK_NOT_FOUND`. That half is not tidying and has a rule behind it: an `ERROR_CODES`
member that no installed manifest declares routes nowhere, so an operator reads the raising
code's own English instead of a translated sentence — `check:error-translations`'
`undeclared-enum-member`, which is what a code whose only declarant has left looks like. The two
codes are declared by `@endora-commerce/mod-wfirma`'s manifest and translated in its own
`i18n/` bundles, which is where they now live in full.

**Why, and why it is not an accident of tidying.** `@endora-commerce/contracts` is a free
package. A schema describing wFirma's REST API is only usable by an instance that installs the
wFirma module, so shipping it here asked every consumer to carry per-vendor contract for an
integration most of them will never run — and, once a vendor module is published from somewhere
else, put the schema and the code it describes under two owners. The module now carries both.
This is the same split `@endora-commerce/mod-inpost` and `@endora-commerce/mod-dhl-parcel` took
in the `0.10` line; `@endora-commerce/mod-wfirma` is the third package to use the `./contracts`
subpath and the first outside the carrier family.

`minor` rather than `major`: no package in this repository leaves `0.x` before the move to
public npmjs, and in a `0.x` series a minor already takes every caret dependent out of range,
which is the whole consumer-facing meaning of a break.

`@endora-commerce/mod-invoice-ledger` is a patch and nothing it publishes changes behaviour: a
doc comment on `InvoiceLedgerDeliveryAttempt.remoteVendorNumber` named one vendor for a field
every vendor writes, and its registry test stated a two-member vendor family whose second member
was a module this repository no longer holds. Both now say what they mean without naming a
vendor, which is D-256's rule for this module read one comment further than D-256 reached.
