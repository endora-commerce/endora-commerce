---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-ksef': minor
---

`@endora-commerce/contracts` no longer exports the KSeF module's schemas; the module publishes its own

**If you import any `ksef*`/`Ksef*` symbol, `KSEF_SETTING_CODES`, `KSEF_ENVIRONMENTS` or another
`KSEF_*` constant from `@endora-commerce/contracts` or from its `./ksef` subpath, this release
removes it.** Forty-four exports go: the environment, credential and submission vocabularies, the
credential, connection-test and submission request and response shapes, the submit job payload,
the setting codes, and every type inferred beside them. They are now on the module's own
`./contracts` subpath:

```diff
- import { KSEF_SETTING_CODES, ksefSubmissionDtoSchema } from '@endora-commerce/contracts';
+ import { KSEF_SETTING_CODES, ksefSubmissionDtoSchema } from '@endora-commerce/mod-ksef/contracts';
```

Nothing else in `@endora-commerce/contracts` changes. The KSeF state the free tier records —
`ksefReferenceNumber` and `ksefProcessedAt` on the invoice, and `invoice_ledger`'s KSeF routing —
stays in the free contracts, and `invoice.issued.v1` / `invoice.corrected.v1` stay in the invoices
contract.

`@endora-commerce/mod-ksef` gains the `./contracts` export. It already declared `zod` as a peer
dependency, so installing it pulls in nothing new.
