---
'@endora-commerce/mod-autopay': minor
'@endora-commerce/mod-comparisons': minor
'@endora-commerce/mod-credentials': minor
'@endora-commerce/mod-dictionaries': minor
'@endora-commerce/mod-google-tag-manager': minor
'@endora-commerce/mod-ksef': minor
'@endora-commerce/mod-meta-ads': minor
'@endora-commerce/mod-paypal': minor
'@endora-commerce/mod-payu': minor
'@endora-commerce/mod-quick-order': minor
'@endora-commerce/mod-search': minor
'@endora-commerce/mod-stripe': minor
'@endora-commerce/mod-taxes': minor
'@endora-commerce/mod-tpay': minor
---

Fourteen more modules become workspace packages (feature 080, T040b batch three):
`autopay`, `comparisons`, `credentials`, `dictionaries`, `google_tag_manager`,
`ksef`, `meta_ads`, `paypal`, `payu`, `quick_order`, `search`, `stripe`, `taxes`
and `tpay`. Each ships `dist` and resolves through its own `exports` map — the
root for its manifest, `./backend` for `registerModule` plus the `entities`
array, `./migrations` for its migration classes — exactly as the twenty-nine
packages before them.

**For a consumer of `@endora-commerce/mod-ksef`, one export is new and
load-bearing.** `KsefUnavailableError` is now published by name on `./backend`:

```ts
import { KsefUnavailableError } from '@endora-commerce/mod-ksef/backend';
```

Anything implementing `KsefApiClientPort` — an overlay's client, a test double,
a second gateway — must throw **that** class for an outage.
`classifySubmissionError` decides "retry" from `instanceof`, so a caller holding
a constructor of its own, or the class from a relative import into this
package's source, gets its outage classified as `UNEXPECTED`: the submission is
parked for an operator instead of queued for the sweep, silently. There is no
behaviour change for a caller that already throws the module's own class.

Nothing else in any of the fourteen changed shape. The move is a relocation:
same entities, same migrations, same class names, same tables. The committed
migration registry's `(moduleId, className)` declaration sequence and its
computed execution sequence are byte-identical to the merge base — 158 entries,
`declaration=2db29d89…`, `execution=c794685f…` — because packaging changes no
manifest `dependencies` and the order is a function of those.
