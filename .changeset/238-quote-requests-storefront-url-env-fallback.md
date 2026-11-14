---
'@endora-commerce/mod-quote-requests': patch
---

The buyer e-mails about a quote request now link to the request whenever the channel's storefront
address resolves: the channel's `sales_channels.storefront_url` setting, then the
`STOREFRONT_BASE_URL` environment variable when the setting is empty, blank, not registered or not
readable for the channel. This is how the setting defines itself and how `seo` and `product_feeds`
already read it. Before, an empty setting meant no link even with `STOREFRONT_BASE_URL` set. With
neither configured the e-mail still carries no link; no local development address is ever guessed.
