---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-stripe': minor
'@endora-commerce/mod-tpay': minor
'@endora-commerce/mod-payu': minor
'@endora-commerce/mod-autopay': minor
'@endora-commerce/mod-paypal': minor
---

`@endora-commerce/contracts` no longer exports the five payment gateways' schemas; a gateway integration publishes its own

**If you import any `stripe*`/`Stripe*`, `tpay*`/`Tpay*`, `payu*`/`Payu*`, `autopay*`/`Autopay*`
or `paypal*`/`Paypal*` symbol from `@endora-commerce/contracts`, this release removes it.** One
hundred and thirty exports go, across five vendors — 23 for Stripe, 31 for TPay, 33 for PayU, 20
for Autopay and 23 for PayPal. Each vendor's config, config-update, method-rule, method-update,
method-list, mode and display-mode schemas, its saved-card and BLIK-alias shapes where it has
them, its storefront config and its pay/create/capture request and response shapes, together with
every type inferred beside them. They are now on each module's own `./contracts` subpath:

```diff
- import { stripeConfigSchema, stripeMethodListSchema } from '@endora-commerce/contracts';
+ import { stripeConfigSchema, stripeMethodListSchema } from '@endora-commerce/mod-stripe/contracts';
```

**Two removals are worth calling out by name, because neither reads as a gateway symbol.**
`countryCodeSchema` — the unprefixed ISO-3166-1 alpha-2 schema — was declared in `stripe.ts` and
reached the barrel from there, so it leaves with Stripe and is now
`@endora-commerce/mod-stripe/contracts`' export. Nothing in this repository imported it outside
that file, but its name says nothing about Stripe, so a consumer that found it on the barrel has
no way of guessing where it went without this paragraph. `AUTOPAY_GATEWAY_ID_BY_METHOD`, the
method-to-GatewayID map, moves with Autopay for the same reason it existed: it is Autopay's wire
vocabulary, not the platform's.

**Why, and why it is not an accident of tidying.** `@endora-commerce/contracts` is a free
package. A schema describing Stripe's or PayU's API is only usable by an instance that installs
that gateway, so shipping it here asked every consumer to carry per-vendor contract for
integrations most of them will never run — and, once a gateway module is published from somewhere
else, put the schema and the code it describes under two owners. Each module now carries both.
This is the same split `@endora-commerce/mod-inpost`, `@endora-commerce/mod-dhl-parcel` and
`@endora-commerce/mod-wfirma` took before them; these five are the fourth through eighth packages
to use the `./contracts` subpath, and the first payment family to.

The five gateway packages are a **minor** because each gains a published subpath — `./contracts`,
rendered into its `exports` map by `manifests:generate` — which is additive and nothing else about
them changes. `@endora-commerce/contracts` is a minor rather than a `major`: no package in this
repository leaves `0.x` before the move to public npmjs, and in a `0.x` series a minor already
takes every caret dependent out of range, which is the whole consumer-facing meaning of a break.

**One duplication is created deliberately and is not solved here.** A published
`@endora-commerce/contracts` older than this release still exports all 130 symbols, so an
instance holding both it and a new gateway package resolves two copies of the same Zod schemas
until a new `contracts` is cut. They are structurally identical and neither is compared against
the other by identity anywhere, so the duplication is latent; it ends with the next `contracts`
release, exactly as it does for the three packages that took this split before.
