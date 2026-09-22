---
'@endora-commerce/mod-paypal': patch
'@endora-commerce/mod-payu': patch
'@endora-commerce/mod-stripe': patch
---

The inline payment step is a storefront fragment, and the docs say so

Three published pages told an operator that this module's inline checkout UI renders at
`/checkout/pay`, a route the reference storefront served. `specs/134-paid-module-extraction/`
T041, under ruling **O-1(b)**, moves every gateway's checkout UI out of the public storefront
as a fragment the shop copies into its own scaffolded storefront (D-195 makes that storefront a
scaffolded instance the shop owns), so the route exists once the fragment is copied in and not
before.

Each page now says which of those two it is describing. No code, no route and no setting
changed; this is documentation catching up with where the file lives.

- `paypal/docs/paypal.md` — the Smart Payment Buttons display mode.
- `payu/docs/payu.md` — step 4 of the Google Pay walkthrough.
- `stripe/README.md` — the inline display mode's fallback step.
